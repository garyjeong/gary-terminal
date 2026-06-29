import React, { useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { Sidebar } from './components/sidebar/Sidebar.js';
import { MainColumn } from './components/MainColumn.js';
import { CheatSheet } from './components/CheatSheet.js';
import { ResumeDialog } from './components/ResumeDialog.js';
import { PermissionDialog } from './components/PermissionDialog.js';
import { NewSessionDialog, resolveModelFlag, resolveEffortFlag } from './components/NewSessionDialog.js';
import { useStore, makeAgent } from './store.js';
import { PermissionServer } from './claude/permissionServer.js';
import { useSystemStats } from './hooks/useSystemStats.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { useAltScreen } from './hooks/useAltScreen.js';
import { ClaudeSession } from './claude/session.js';
import { SessionManager } from './claude/sessionManager.js';
import type { Agent } from './types.js';
import { scanSkills } from './data/skills.js';
import { fetchMcpList } from './data/mcp.js';
import { aggregateUsageHistory } from './data/usageHistory.js';
import { fetchClaudeUsage } from './data/claudeUsage.js';
import { fetchCodexUsage } from './data/codexUsage.js';
import { enumerateSlashCommands } from './data/slashCommands.js';
import { loadSessions, upsertSession } from './data/sessionStore.js';
import { scanFilesSync } from './data/fileSearch.js';

// ---------------------------------------------------------------------------
// AGENTS.md loader — reads AGENTS.md from cwd if present.
// CLAUDE.md is already auto-loaded by the claude CLI; AGENTS.md is not.
// ---------------------------------------------------------------------------
function loadAgentsMd(): string | undefined {
  try {
    const path = `${process.cwd()}/AGENTS.md`;
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
  } catch {
    // ignore read errors
  }
  return undefined;
}

const LIVE_AGENT_ID = 'live';
const REFERENCE_SECTIONS_RING = ['skills', 'mcp', 'codex'] as const;

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  // Session infrastructure (stable refs, not state)
  const managerRef = useRef<SessionManager>(new SessionManager());
  const sessionCountRef = useRef(0);
  // Map of agentId → wireSession unsub for sessions spawned via Ctrl+N.
  // Used by closeCurrentSession to clean up listeners and flush timers.
  const sessionUnsubsRef = useRef<Map<string, () => void>>(new Map());
  const permServerRef = useRef<PermissionServer>(new PermissionServer());
  const settingsFileRef = useRef<string>('');

  // Store selectors
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusMode = useStore((state) => state.ui.focusMode);
  const referenceCursor = useStore((state) => state.ui.referenceCursor);
  const mcpLoading = useStore((state) => state.references.mcpLoading);
  // modeStack drives overlay key routing — overlays keep it in sync on open/close
  const modeStack = useStore((state) => state.ui.modeStack);
  const agentFilter = useStore((state) => state.ui.agentFilter);

  // Filtered agents for navigation in the agents panel.
  // When a filter is active, ↑↓ navigates within the filtered subset only.
  const filteredAgents = React.useMemo(() => {
    if (agentFilter === 'all') return agents;
    if (agentFilter === 'active') return agents.filter((a) => a.status !== 'done');
    if (agentFilter === 'blocked') return agents.filter((a) => a.status === 'blocked');
    return agents;
  }, [agents, agentFilter]);

  // Store actions (stable references from Zustand)
  const setFocusedAgent = useStore((state) => state.setFocusedAgent);
  const setFocusMode = useStore((state) => state.setFocusMode);
  const cycleFocusRegion = useStore((state) => state.cycleFocusRegion);
  const toggleReference = useStore((state) => state.toggleReference);
  const toggleCheatSheet = useStore((state) => state.toggleCheatSheet);
  const scrollConversation = useStore((state) => state.scrollConversation);
  const setReferenceCursor = useStore((state) => state.setReferenceCursor);
  const openResumeDialog = useStore((state) => state.openResumeDialog);
  const closeResumeDialog = useStore((state) => state.closeResumeDialog);
  const moveResumeSelection = useStore((state) => state.moveResumeSelection);
  const cycleAgentFilter = useStore((state) => state.cycleAgentFilter);
  const openPermissionDialog = useStore((state) => state.openPermissionDialog);
  const closePermissionDialog = useStore((state) => state.closePermissionDialog);
  const openNewSessionDialog = useStore((state) => state.openNewSessionDialog);
  const closeNewSessionDialog = useStore((state) => state.closeNewSessionDialog);
  const moveNewSessionRow = useStore((state) => state.moveNewSessionRow);
  const cycleNewSessionOption = useStore((state) => state.cycleNewSessionOption);
  const toggleCopyMode = useStore((state) => state.toggleCopyMode);
  const togglePaneCollapse = useStore((state) => state.togglePaneCollapse);
  const copyMode = useStore((state) => state.ui.copyMode);

  useSystemStats();
  // Pass stopAll as cleanup so SIGTERM/SIGINT set stopped=true on all sessions
  // before their child processes are reaped — preventing exit-143 error messages.
  useAltScreen(() => managerRef.current.stopAll());

  // -------------------------------------------------------------------------
  // Copy-mode: alt-screen exit/restore
  //
  // When copyMode becomes true, Ink has already re-rendered (spinner stopped,
  // stats frozen). We then exit alt-screen and dump the focused conversation as
  // plain text so the user can select/copy via mouse in the main buffer (with
  // scrollback). On exit, we re-enter alt-screen and the next Ink render
  // restores the full TUI.
  //
  // The re-enter write is also done synchronously in the Ctrl+Y handler (input
  // side) BEFORE toggling state, so Ink's next render goes to alt-screen.
  // The effect write is a harmless second clear that ensures cursor position.
  // -------------------------------------------------------------------------
  const hasBeenInCopyModeRef = useRef(false);

  useEffect(() => {
    if (!process.stdout.isTTY) return;

    if (copyMode) {
      hasBeenInCopyModeRef.current = true;

      // Exit alt-screen → switch to main buffer (with scrollback)
      process.stdout.write('\x1b[?1049l');

      // Dump the focused conversation as plain text
      const state = useStore.getState();
      const agent = state.agents.find((a) => a.id === state.focusedAgentId);
      const msgs = agent?.messages ?? [];
      const streaming = agent?.streamingText ?? '';

      process.stdout.write('\n');
      process.stdout.write('\x1b[1;33m┌─ COPY MODE ────────────────────────────────────────────────────────┐\x1b[0m\n');
      process.stdout.write('\x1b[1;33m│  텍스트를 마우스로 선택 → 복사하세요.                              │\x1b[0m\n');
      process.stdout.write('\x1b[1;33m│  Ctrl+Y 로 gary-terminal 로 복귀.                                  │\x1b[0m\n');
      process.stdout.write('\x1b[1;33m└────────────────────────────────────────────────────────────────────┘\x1b[0m\n\n');

      for (const msg of msgs) {
        if (msg.role === 'user') {
          process.stdout.write(`\x1b[36m[you]\x1b[0m ${msg.content}\n\n`);
        } else if (msg.role === 'assistant') {
          process.stdout.write(`${msg.content}\n\n`);
        } else if (msg.role === 'tool' || msg.role === 'codex') {
          const prefix = msg.role === 'codex' ? '▸ codex' : `● ${msg.toolName ?? 'Tool'}`;
          process.stdout.write(`\x1b[33m${prefix}:\x1b[0m ${msg.content}\n\n`);
        }
      }
      if (streaming) {
        process.stdout.write(`${streaming}\n\n`);
      }

      process.stdout.write('\x1b[1;33m── Ctrl+Y 로 복귀 ──────────────────────────────────────────────────\x1b[0m\n');

    } else if (hasBeenInCopyModeRef.current) {
      // Re-enter alt-screen and clear so Ink renders cleanly on top
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
    }
  }, [copyMode]);

  // -------------------------------------------------------------------------
  // wireSession: subscribe to a session's events and delegate to the store
  // reducer (applySessionEvent). text_delta is buffered for 80ms before
  // being flushed — all other events are forwarded immediately.
  // -------------------------------------------------------------------------
  const wireSession = useCallback((agentId: string, session: ClaudeSession): (() => void) => {
    let textBuffer = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushTextBuffer(): void {
      if (textBuffer) {
        useStore.getState().applySessionEvent(agentId, { type: 'text_delta', text: textBuffer });
        textBuffer = '';
      }
      flushTimer = null;
    }

    const unsub = session.onEvent((evt) => {
      if (evt.type === 'text_delta') {
        // Buffer text; flush every 80ms to avoid per-character re-renders.
        textBuffer += evt.text;
        if (flushTimer === null) {
          flushTimer = setTimeout(flushTextBuffer, 80);
        }
      } else if (evt.type === 'message_complete') {
        // Flush any buffered text before committing the message.
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (textBuffer) {
          useStore.getState().applySessionEvent(agentId, { type: 'text_delta', text: textBuffer });
          textBuffer = '';
        }
        useStore.getState().applySessionEvent(agentId, evt);
      } else {
        // Persist session metadata on init so it appears in the resume dialog.
        if (evt.type === 'init') {
          const agent = useStore.getState().agents.find((a) => a.id === agentId);
          upsertSession({
            sessionId: evt.sessionId,
            title: agent?.title ?? agentId,
            cwd: process.cwd(),
            model: evt.model,
            lastActiveAt: new Date().toISOString(),
          });
        }
        useStore.getState().applySessionEvent(agentId, evt);
      }
    });

    // Return a wrapper that also clears the 80ms flush timer so no zombie
    // store updates fire after the session has been torn down.
    return () => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      unsub();
    };
  }, []); // empty deps — all store access via getState()

  // -------------------------------------------------------------------------
  // Refresh monitoring data (skills, MCP, usage history)
  // -------------------------------------------------------------------------
  const refreshMonitoring = useCallback((skipMcpIfLoading = true) => {
    const store = useStore.getState();

    // Skills (fast)
    store.setSkillsLoading(true);
    scanSkills()
      .then((skills) => {
        useStore.getState().setSkills(skills);
      })
      .catch(() => {/* ignore */})
      .finally(() => {
        useStore.getState().setSkillsLoading(false);
      });

    // Usage history (medium speed)
    store.setUsageHistoryLoading(true);
    aggregateUsageHistory()
      .then((history) => {
        useStore.getState().setUsageHistory(history);
      })
      .catch(() => {/* ignore */})
      .finally(() => {
        useStore.getState().setUsageHistoryLoading(false);
      });

    // Claude rate-limit usage (OAuth API, 60s cache)
    store.setClaudeUsageLoading(true);
    fetchClaudeUsage()
      .then((usage) => {
        useStore.getState().setClaudeUsage(usage);
      })
      .catch(() => {/* ignore */})
      .finally(() => {
        useStore.getState().setClaudeUsageLoading(false);
      });

    // Codex usage (sqlite, fast)
    store.setCodexUsageLoading(true);
    fetchCodexUsage()
      .then((usage) => {
        useStore.getState().setCodexUsage(usage);
      })
      .catch(() => {/* ignore */})
      .finally(() => {
        useStore.getState().setCodexUsageLoading(false);
      });

    // Slash commands (fast, fire and forget)
    enumerateSlashCommands(process.cwd())
      .then((commands) => {
        useStore.getState().setSlashCommands(commands);
      })
      .catch(() => {/* ignore */});

    // MCP (slow, ~20s)
    if (skipMcpIfLoading && store.references.mcpLoading) return;
    store.setMcpLoading(true);
    fetchMcpList()
      .then((mcp) => {
        useStore.getState().setMcp(mcp);
      })
      .catch(() => {/* ignore */})
      .finally(() => {
        useStore.getState().setMcpLoading(false);
      });
  }, []);

  // -------------------------------------------------------------------------
  // Bootstrap live session on mount — runs exactly once.
  // wireSession and refreshMonitoring are both useCallback(fn, []) so their
  // refs are stable; capturing them at mount time is safe and intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // -------------------------------------------------------------------------
  useEffect(() => {
    const session = managerRef.current.create(LIVE_AGENT_ID);
    const unsub = wireSession(LIVE_AGENT_ID, session);
    const store = useStore.getState();
    store.registerSessionSend(LIVE_AGENT_ID, (text) => session.sendMessage(text));
    store.registerSessionInterrupt(LIVE_AGENT_ID, () => session.interrupt());

    // Inject AGENTS.md for the live session as well
    const agentsMdContent = loadAgentsMd();
    if (agentsMdContent) {
      store.setAgentsMdLoaded(LIVE_AGENT_ID, true);
    }

    // Start permission server, then start session with settingsPath
    permServerRef.current.start().then(() => {
      const settingsPath = `/tmp/gary-terminal-perm-${process.pid}.json`;
      settingsFileRef.current = settingsPath;
      permServerRef.current.writeSettingsFile(settingsPath);
      permServerRef.current.setOnRequest((req) => {
        useStore.getState().openPermissionDialog(req.toolName, req.toolInput, req.toolUseId);
      });
      session.start({ appendSystemPrompt: agentsMdContent, settingsPath });
    }).catch(() => {
      // Permission server failed — session still works, just no TUI permission dialog
      session.start({ appendSystemPrompt: agentsMdContent });
    });

    // Scan files for @ file picker (capped at 5000; non-blocking via setTimeout)
    setTimeout(() => {
      try {
        const { files, truncated } = scanFilesSync(process.cwd());
        useStore.getState().setFileList(files, truncated);
      } catch {
        // ignore scan errors (e.g. permission denied)
      }
    }, 0);

    // Fire initial monitoring scans
    refreshMonitoring(false);

    return () => {
      unsub();
      managerRef.current.stopAll();
      permServerRef.current.stop();
      // Clean up temp settings file
      try { if (settingsFileRef.current) unlinkSync(settingsFileRef.current); } catch { /* ignore */ }
    };
  }, []); // [] — live session must be created exactly once, never re-spawned

  // -------------------------------------------------------------------------
  // Internal helper: create and wire a new session for an already-added agent.
  // Reads AGENTS.md from cwd and injects it via --append-system-prompt if found.
  // -------------------------------------------------------------------------
  const _startSession = useCallback(
    (agentId: string, opts?: { resumeSessionId?: string; model?: string; effort?: string }) => {
      // Load AGENTS.md once per session start (sync read — fast, happens once)
      const agentsMdContent = loadAgentsMd();

      const store = useStore.getState();
      const session = managerRef.current.create(agentId);
      const unsub = wireSession(agentId, session);
      sessionUnsubsRef.current.set(agentId, unsub);
      store.registerSessionSend(agentId, (text) => session.sendMessage(text));
      store.registerSessionInterrupt(agentId, () => session.interrupt());

      // Track AGENTS.md status on the agent for UI display
      if (agentsMdContent) {
        store.setAgentsMdLoaded(agentId, true);
      }

      session.start({
        resumeSessionId: opts?.resumeSessionId,
        appendSystemPrompt: agentsMdContent,
        settingsPath: settingsFileRef.current,
        model: opts?.model,
        effort: opts?.effort,
      });
    },
    [wireSession],
  );

  // -------------------------------------------------------------------------
  // Spawn a new claude session — called from the NewSessionDialog on Enter
  // -------------------------------------------------------------------------
  const spawnNewSession = useCallback((opts?: { model?: string; effort?: string }) => {
    sessionCountRef.current++;
    const agentId = `session-${sessionCountRef.current}`;
    const title = `세션 ${sessionCountRef.current}`;
    const newAgent: Agent = makeAgent(agentId, title, { requestedModel: opts?.model, effort: opts?.effort });

    const store = useStore.getState();
    store.addAgent(newAgent);
    store.setFocusedAgent(agentId);
    _startSession(agentId, opts);
  }, [_startSession]);

  // -------------------------------------------------------------------------
  // Spawn a resumed session (Ctrl+O dialog → Enter)
  // -------------------------------------------------------------------------
  const spawnResumeSession = useCallback(
    (resumeSessionId: string, resumedTitle: string) => {
      sessionCountRef.current++;
      const agentId = `session-${sessionCountRef.current}`;
      const title = `↩ ${resumedTitle}`;
      const newAgent: Agent = makeAgent(agentId, title, { isResume: true });

      const store = useStore.getState();
      store.addAgent(newAgent);
      store.setFocusedAgent(agentId);
      _startSession(agentId, { resumeSessionId });
    },
    [_startSession],
  );

  // -------------------------------------------------------------------------
  // Close focused session (Ctrl+W) — not available for the default live agent
  // -------------------------------------------------------------------------
  const closeCurrentSession = useCallback(() => {
    const store = useStore.getState();
    const currentId = store.focusedAgentId;
    if (currentId === LIVE_AGENT_ID) return; // protect the default session
    // Unsubscribe event listener and clear any pending flushTimer.
    sessionUnsubsRef.current.get(currentId)?.();
    sessionUnsubsRef.current.delete(currentId);
    managerRef.current.destroy(currentId);
    store.unregisterSessionSend(currentId);
    store.unregisterSessionInterrupt(currentId);
    store.removeAgent(currentId);
  }, []);

  // -------------------------------------------------------------------------
  // Input handling — 2-level focus model
  // -------------------------------------------------------------------------

  useInput((input, key) => {
    // Derive the current routing mode from the stack top.
    // 'base' = stack empty → normal select/active routing.
    const topMode = modeStack[modeStack.length - 1] ?? 'base';

    // ── Overlay: permission dialog ─────────────────────────────────────────
    if (topMode === 'permission') {
      if (input === 'y') {
        const { toolUseId } = useStore.getState().permissionDialog;
        permServerRef.current.resolvePermission(toolUseId, 'allow');
        closePermissionDialog();
        return;
      }
      if (key.escape || input === 'n') {
        const { toolUseId } = useStore.getState().permissionDialog;
        permServerRef.current.resolvePermission(toolUseId, 'deny');
        closePermissionDialog();
        return;
      }
      return; // swallow all other keys
    }

    // ── Overlay: resume dialog ─────────────────────────────────────────────
    // Stack top === 'resume': route to dialog actions, swallow everything else.
    if (topMode === 'resume') {
      if (key.escape) { closeResumeDialog(); return; }
      if (key.upArrow) { moveResumeSelection(-1); return; }
      if (key.downArrow) { moveResumeSelection(1); return; }
      if (key.return) {
        const { sessions, selectedIndex } = useStore.getState().resumeDialog;
        const selected = sessions[selectedIndex];
        if (selected) {
          closeResumeDialog();
          spawnResumeSession(selected.sessionId, selected.title);
        }
        return;
      }
      return; // swallow all other keys while dialog is open
    }

    // ── Overlay: cheatsheet ────────────────────────────────────────────────
    // Stack top === 'cheatsheet': only ? or Esc closes it; everything else consumed.
    if (topMode === 'cheatsheet') {
      if (key.escape || input === '?') { toggleCheatSheet(); return; }
      return;
    }

    // ── Overlay: new session options dialog ────────────────────────────────
    if (topMode === 'newsession') {
      if (key.escape) { closeNewSessionDialog(); return; }
      if (key.upArrow || key.downArrow) { moveNewSessionRow(key.downArrow ? 1 : -1); return; }
      if (key.leftArrow) { cycleNewSessionOption(-1); return; }
      if (key.rightArrow) { cycleNewSessionOption(1); return; }
      if (key.return) {
        const { modelIdx, effortIdx } = useStore.getState().newSessionDialog;
        const model = resolveModelFlag(modelIdx);
        const effort = resolveEffortFlag(effortIdx);
        closeNewSessionDialog();
        spawnNewSession({ model, effort });
        return;
      }
      return; // swallow all other keys
    }

    // ── Overlay: slash autocomplete ────────────────────────────────────────
    // InputPane's own useInput (isActive: isFocused) owns all slash popup keys
    // (↑↓ nav, Esc close, Tab apply, Enter via TextInput.onSubmit).
    // App.tsx yields entirely so there is no double-handling.
    if (topMode === 'slash') {
      return;
    }

    // ── Overlay: file autocomplete ─────────────────────────────────────────
    // Same pattern as slash — InputPane owns all keys while file popup is open.
    if (topMode === 'file') {
      return;
    }

    // ── Overlay: copy mode ─────────────────────────────────────────────────
    // Re-enter alt-screen synchronously BEFORE toggling state so Ink's next
    // render goes to alt-screen rather than the main (static) buffer.
    if (topMode === 'copy') {
      if (key.ctrl && input === 'y') {
        if (process.stdout.isTTY) {
          process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
        }
        toggleCopyMode();
        return;
      }
      return; // swallow all other keys while in copy mode
    }

    // ── Base mode (no overlay) ─────────────────────────────────────────────

    // Global shortcuts — active in both select and active mode.
    // Ctrl+C always quits regardless of focus.
    if (key.ctrl && input === 'c') {
      managerRef.current.stopAll();
      exit();
      return;
    }
    // q and ? are single-char shortcuts that collide with typing —
    // suppress them when the input pane is active so users can type freely.
    const inputIsActive = focusRegion === 'input' && focusMode === 'active';
    if (input === 'q' && !inputIsActive) {
      managerRef.current.stopAll();
      exit();
      return;
    }
    if (key.ctrl && input === 'n') { openNewSessionDialog(); return; }
    if (key.ctrl && input === 'o') { openResumeDialog(loadSessions()); return; }
    if (key.ctrl && input === 'w') { closeCurrentSession(); return; }
    if (key.ctrl && input === 'r') { refreshMonitoring(!mcpLoading); return; }
    if (key.ctrl && input === 'f') { cycleAgentFilter(); return; }
    if (key.ctrl && input === 'y') { toggleCopyMode(); return; }
    if (key.ctrl && input === 'k') { togglePaneCollapse('keybindings'); return; }
    if (key.ctrl && input === 'x') {
      const store = useStore.getState();
      const agent = store.agents.find((a) => a.id === store.focusedAgentId);
      if (agent?.status === 'running') {
        store.dispatchOp(store.focusedAgentId, { type: 'interrupt' });
      }
      return;
    }
    if (input === '?' && !inputIsActive) { toggleCheatSheet(); return; }

    // ── SELECT mode: navigate between panels ──────────────────────────────
    if (focusMode === 'select') {
      if (key.downArrow || key.rightArrow) { cycleFocusRegion('down'); return; }
      if (key.upArrow || key.leftArrow) { cycleFocusRegion('up'); return; }
      if (key.return) { setFocusMode('active'); return; }
      return;
    }

    // ── ACTIVE mode: route keys per-panel ─────────────────────────────────

    // Esc: exit to select mode.
    // (When slash popup is open topMode==='slash' and we returned above, so
    //  InputPane's useInput closes the popup — we never reach here in that case.)
    if (key.escape) {
      setFocusMode('select');
      return;
    }

    // ↑ / ↓ routing per panel
    if (key.upArrow || key.downArrow) {
      if (focusRegion === 'agents') {
        const currentIndex = filteredAgents.findIndex((a) => a.id === focusedAgentId);
        if (key.upArrow && currentIndex > 0) {
          setFocusedAgent(filteredAgents[currentIndex - 1]!.id);
        } else if (key.downArrow && currentIndex < filteredAgents.length - 1) {
          setFocusedAgent(filteredAgents[currentIndex + 1]!.id);
        }
        return;
      }
      if (focusRegion === 'reference') {
        const currentIdx = REFERENCE_SECTIONS_RING.indexOf(referenceCursor);
        if (key.downArrow) {
          const nextIdx = (currentIdx + 1) % REFERENCE_SECTIONS_RING.length;
          setReferenceCursor(REFERENCE_SECTIONS_RING[nextIdx]!);
        } else {
          const prevIdx = (currentIdx - 1 + REFERENCE_SECTIONS_RING.length) % REFERENCE_SECTIONS_RING.length;
          setReferenceCursor(REFERENCE_SECTIONS_RING[prevIdx]!);
        }
        return;
      }
      if (focusRegion === 'conversation') {
        scrollConversation(key.upArrow ? 5 : -5);
        return;
      }
      if (focusRegion === 'input') {
        // Only bounce to select mode when input has text AND we're not navigating
        // command history. When empty (or in history-nav mode), InputPane handles
        // ↑↓ for command history — App.tsx must not also bounce.
        const { inputIsEmpty, inputHistoryNavigating } = useStore.getState();
        if (!inputIsEmpty && !inputHistoryNavigating) {
          setFocusMode('select');
          cycleFocusRegion(key.downArrow ? 'down' : 'up');
        }
        return;
      }
    }

    // ← / → : collapse / expand the cursored reference section (active mode)
    if (focusRegion === 'reference' && (key.leftArrow || key.rightArrow)) {
      const collapsed = useStore.getState().ui.referenceCollapsed[referenceCursor];
      if (key.rightArrow && collapsed) toggleReference(referenceCursor);       // → expand
      else if (key.leftArrow && !collapsed) toggleReference(referenceCursor);  // ← collapse
      return;
    }

    // Space: toggle reference section when reference panel is active
    if (input === ' ' && focusRegion === 'reference') {
      toggleReference(referenceCursor);
      return;
    }

    // PgUp/PgDn and Ctrl+U/D: conversation scroll
    if (focusRegion === 'conversation') {
      if (key.pageUp || (key.ctrl && input === 'u')) { scrollConversation(5); return; }
      if (key.pageDown || (key.ctrl && input === 'd')) { scrollConversation(-5); return; }
    }
  });

  // ③ Small terminal guard
  const MIN_COLS = 70;
  const MIN_ROWS = 20;
  if (columns < MIN_COLS || rows < MIN_ROWS) {
    return (
      <Box
        flexDirection="column"
        width={columns}
        height={rows}
        alignItems="center"
        justifyContent="center"
      >
        <Text color="yellow" bold>터미널을 더 크게 해주세요</Text>
        <Text color="gray">현재: {columns}×{rows} | 최소: {MIN_COLS}×{MIN_ROWS}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexDirection="row" flexGrow={1}>
        <Sidebar />
        <MainColumn />
      </Box>
      <CheatSheet />
      <ResumeDialog />
      <PermissionDialog />
      <NewSessionDialog />
    </Box>
  );
}
