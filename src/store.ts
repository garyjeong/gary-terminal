import { create } from 'zustand';
import type { Agent, AgentStatus, AgentUsage, Message, ToolCallState, SubagentInfo } from './types.js';
import type { SkillInfo } from './data/skills.js';
import type { McpInfo } from './data/mcp.js';
import type { UsageHistory } from './data/usageHistory.js';
import type { ClaudeUsage } from './data/claudeUsage.js';
import type { CodexUsage } from './data/codexUsage.js';
import { filterSlashCommands } from './data/slashCommands.js';
import type { SlashCommand } from './data/slashCommands.js';
import { filterFiles } from './data/fileSearch.js';
import type { SessionEvent } from './claude/session.js';
import type { SessionMeta } from './data/sessionStore.js';
import type { KeyMode } from './keymap.js';

// ---------------------------------------------------------------------------
// Op types
// ---------------------------------------------------------------------------
export type AgentOp =
  | { type: 'submit'; text: string }
  | { type: 'interrupt' }
  | { type: 'clear' }
  | { type: 'compact' };

// ---------------------------------------------------------------------------
// Tool input summariser (moved from App.tsx — used by applySessionEvent)
// ---------------------------------------------------------------------------
function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash') {
    const cmd = String(input['command'] ?? input['cmd'] ?? '');
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
  }
  if (name === 'Write' || name === 'Edit') {
    return String(input['file_path'] ?? input['path'] ?? '');
  }
  if (name === 'Read') {
    return String(input['file_path'] ?? '');
  }
  const str = JSON.stringify(input);
  return str.length > 60 ? str.slice(0, 57) + '...' : str;
}

type FocusRegion = 'agents' | 'reference' | 'conversation' | 'input';
type FocusMode = 'select' | 'active';
/** Agent list filter in the AgentSwitcher panel. */
export type AgentFilter = 'all' | 'active' | 'blocked';

interface AppState {
  agents: Agent[];
  focusedAgentId: string;
  ui: {
    focusRegion: FocusRegion;
    focusMode: FocusMode;
    referenceCollapsed: { skills: boolean; mcp: boolean; codex: boolean };
    referenceCursor: 'skills' | 'mcp' | 'codex';
    showCheatSheet: boolean;
    /** True when the focused session is idle / waiting for user input */
    waiting: boolean;
    /**
     * Mode stack for overlay key routing.
     * Stack top owns key routing exclusively; base routing applies when empty.
     * Overlays push on open and pop on close — always kept in sync with the
     * corresponding open flags (slashAutocomplete.open, resumeDialog.open, showCheatSheet).
     */
    modeStack: KeyMode[];
    /**
     * Agent list filter applied in the AgentSwitcher panel.
     * - 'all'     : show all agents
     * - 'active'  : show running / waiting / blocked agents (not done)
     * - 'blocked' : show only blocked agents (permission-prompt waiting)
     */
    agentFilter: AgentFilter;
    /**
     * Copy mode: freezes periodic re-renders (spinner, system stats) so the
     * user can select and copy text from the terminal. While active, the app
     * exits the alt-screen buffer and dumps the conversation as plain text to
     * the main buffer (with scrollback).
     */
    copyMode: boolean;
    /**
     * Per-panel collapse state for sidebar panels that are not in the
     * focus-region ring. Default: keybindings=true (collapsed) to save rows.
     */
    paneCollapsed: { keybindings: boolean };
  };
  system: {
    cpu: number;
    mem: number;
    ctx: number;
    net: { rxKBs: number; txKBs: number };
    disk: { usedPct: number };
    cpuHistory: number[];
    memHistory: number[];
    netRxHistory: number[];
    netTxHistory: number[];
  };
  usage: {
    /** Legacy global display; individual agent usage is in agent.usage */
    tokens: string;
    cost: string;
    todo: { done: number; total: number; items: string[] };
  };

  /**
   * Per-agent send functions keyed by agentId.
   * Stored outside Agent objects because functions aren't serialisable /
   * cause Zustand re-render issues when embedded in arrays.
   */
  sessionSends: Record<string, (text: string) => void>;
  sessionInterrupts: Record<string, () => void>;
  dispatchOp: (agentId: string, op: AgentOp) => void;
  registerSessionInterrupt: (agentId: string, fn: () => void) => void;
  unregisterSessionInterrupt: (agentId: string) => void;

  // ② Conversation scroll: 0 = tail (bottom), positive = messages skipped from end
  conversationScrollOffset: number;

  references: {
    skills: SkillInfo[];
    mcp: McpInfo[];
    mcpLoading: boolean;
    skillsLoading: boolean;
  };

  usageHistory: UsageHistory | null;
  usageHistoryLoading: boolean;

  claudeUsage: ClaudeUsage | null;
  claudeUsageLoading: boolean;

  codexUsage: CodexUsage | null;
  codexUsageLoading: boolean;

  slashAutocomplete: {
    open: boolean;
    query: string;
    selectedIndex: number;
    commands: SlashCommand[];
    filteredCommands: SlashCommand[];
  };

  fileAutocomplete: {
    open: boolean;
    query: string;
    selectedIndex: number;
    /** All scanned file paths (relative, populated once on startup). */
    allFiles: string[];
    filteredFiles: string[];
    /** True when the 5000-file cap was reached during scan. */
    truncated: boolean;
  };

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Reducer: apply a single SessionEvent to the agent's store state.
   * Replaces the giant switch in wireSession — App.tsx delegates here.
   * text_delta text is appended inline; App.tsx still buffers for 80ms.
   */
  applySessionEvent: (agentId: string, evt: SessionEvent) => void;

  // Navigation / UI
  setFocusedAgent: (id: string) => void;
  setFocusRegion: (region: FocusRegion) => void;
  setFocusMode: (mode: FocusMode) => void;
  cycleFocusRegion: (direction: 'up' | 'down') => void;
  toggleReference: (section: 'skills' | 'mcp' | 'codex') => void;
  toggleCheatSheet: () => void;
  setReferenceCursor: (cursor: 'skills' | 'mcp' | 'codex') => void;
  setWaiting: (waiting: boolean) => void;
  updateSystemStats: (cpu: number, mem: number, net?: { rxKBs: number; txKBs: number }, disk?: { usedPct: number }) => void;
  /** Push a KeyMode onto the mode stack (idempotent — no-op if already present at top). */
  pushMode: (mode: KeyMode) => void;
  /** Pop the top KeyMode off the stack. */
  popMode: () => void;
  /** Cycle agent filter: all → active → blocked → all */
  cycleAgentFilter: () => void;
  /** Toggle copy mode on/off (manages modeStack automatically). */
  toggleCopyMode: () => void;
  /** Toggle a sidebar panel collapse state (keybindings etc). */
  togglePaneCollapse: (pane: 'keybindings') => void;

  // Multi-session management
  addAgent: (agent: Agent) => void;
  removeAgent: (agentId: string) => void;
  registerSessionSend: (agentId: string, send: (text: string) => void) => void;
  unregisterSessionSend: (agentId: string) => void;

  // Per-agent state
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  setAgentSessionInfo: (agentId: string, model: string, sessionId: string) => void;
  addMessage: (agentId: string, message: Message) => void;
  appendStreamingForAgent: (agentId: string, text: string) => void;
  commitStreamingForAgent: (agentId: string) => void;
  updateAgentUsage: (agentId: string, costUsd: number, inputTokens: number, outputTokens: number) => void;
  addToolCallToAgent: (agentId: string, toolCall: ToolCallState) => void;
  updateToolCallInAgent: (agentId: string, toolUseId: string, status: 'done' | 'error', result?: string) => void;
  /** Update toolStatus on the message linked to toolCallId */
  updateMessageToolStatus: (agentId: string, toolCallId: string, status: 'ok' | 'error') => void;
  /** Mark that AGENTS.md was loaded for this agent's session */
  setAgentsMdLoaded: (agentId: string, loaded: boolean) => void;

  // ② Scroll actions
  scrollConversation: (delta: number) => void;
  resetConversationScroll: () => void;

  // Monitoring data actions
  setSkills: (skills: SkillInfo[]) => void;
  setSkillsLoading: (loading: boolean) => void;
  setMcp: (mcp: McpInfo[]) => void;
  setMcpLoading: (loading: boolean) => void;
  setUsageHistory: (history: UsageHistory) => void;
  setUsageHistoryLoading: (loading: boolean) => void;

  setClaudeUsage: (usage: ClaudeUsage | null) => void;
  setClaudeUsageLoading: (loading: boolean) => void;

  setCodexUsage: (usage: CodexUsage | null) => void;
  setCodexUsageLoading: (loading: boolean) => void;

  // Slash autocomplete actions
  setSlashCommands: (commands: SlashCommand[]) => void;
  openSlashAutocomplete: (query: string) => void;
  closeSlashAutocomplete: () => void;
  setSlashQuery: (query: string) => void;
  moveSlashSelection: (delta: number) => void;

  // File autocomplete actions
  setFileList: (files: string[], truncated: boolean) => void;
  openFileAutocomplete: (query: string) => void;
  closeFileAutocomplete: () => void;
  setFileQuery: (query: string) => void;
  moveFileSelection: (delta: number) => void;

  // Resume dialog
  resumeDialog: {
    open: boolean;
    selectedIndex: number;
    sessions: SessionMeta[];
  };
  openResumeDialog: (sessions: SessionMeta[]) => void;
  closeResumeDialog: () => void;
  moveResumeSelection: (delta: number) => void;

  // Permission dialog
  permissionDialog: {
    open: boolean;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
  };
  openPermissionDialog: (toolName: string, toolInput: Record<string, unknown>, toolUseId: string) => void;
  closePermissionDialog: () => void;

  // New session options dialog (Ctrl+N)
  newSessionDialog: {
    open: boolean;
    /** 'model' row focused or 'effort' row focused */
    focusRow: 'model' | 'effort';
    modelIdx: number;
    effortIdx: number;
  };
  openNewSessionDialog: () => void;
  closeNewSessionDialog: () => void;
  moveNewSessionRow: (delta: number) => void;
  cycleNewSessionOption: (delta: number) => void;

  // ── Input history ────────────────────────────────────────────────────────
  /** Last 50 user-sent messages, oldest first, most recent last. */
  inputHistory: string[];
  /** True when the input field is currently empty (for App.tsx bounce guard). */
  inputIsEmpty: boolean;
  /** True while user is navigating command history (suppresses panel-bounce on ↓). */
  inputHistoryNavigating: boolean;

  addInputHistory: (text: string) => void;
  setInputIsEmpty: (empty: boolean) => void;
  setInputHistoryNavigating: (navigating: boolean) => void;
}

// ---------------------------------------------------------------------------
// Initial state helpers
// ---------------------------------------------------------------------------

function makeAgent(id: string, title: string, opts?: { requestedModel?: string; effort?: string }): Agent {
  return {
    id,
    title,
    status: 'waiting',
    messages: [],
    streamingText: '',
    sessionModel: '',
    sessionId: '',
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    toolCalls: [],
    contextTokens: 0,
    contextWindow: 0,
    subagents: [],
    agentsMdLoaded: false,
    requestedModel: opts?.requestedModel,
    effort: opts?.effort,
  };
}

const LIVE_AGENT: Agent = makeAgent('live', 'claude session');

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>()((set, get) => ({
  agents: [LIVE_AGENT],
  focusedAgentId: 'live',
  ui: {
    focusRegion: 'input',
    focusMode: 'active',
    referenceCollapsed: { skills: true, mcp: true, codex: true },
    referenceCursor: 'skills',
    showCheatSheet: false,
    waiting: true,
    modeStack: [],
    agentFilter: 'all' as AgentFilter,
    copyMode: false,
    paneCollapsed: { keybindings: true },
  },
  system: {
    cpu: 0,
    mem: 0,
    ctx: 68,
    net: { rxKBs: 0, txKBs: 0 },
    disk: { usedPct: 0 },
    cpuHistory: [],
    memHistory: [],
    netRxHistory: [],
    netTxHistory: [],
  },
  usage: {
    tokens: '0',
    cost: '$0.0000',
    todo: {
      done: 0,
      total: 0,
      items: [],
    },
  },

  sessionSends: {},
  sessionInterrupts: {},
  conversationScrollOffset: 0,

  references: {
    skills: [],
    mcp: [],
    mcpLoading: false,
    skillsLoading: false,
  },

  usageHistory: null,
  usageHistoryLoading: false,

  claudeUsage: null,
  claudeUsageLoading: false,

  codexUsage: null,
  codexUsageLoading: false,

  slashAutocomplete: {
    open: false,
    query: '',
    selectedIndex: 0,
    commands: [],
    filteredCommands: [],
  },

  fileAutocomplete: {
    open: false,
    query: '',
    selectedIndex: 0,
    allFiles: [],
    filteredFiles: [],
    truncated: false,
  },

  resumeDialog: {
    open: false,
    selectedIndex: 0,
    sessions: [],
  },

  permissionDialog: {
    open: false,
    toolName: '',
    toolInput: {},
    toolUseId: '',
  },

  newSessionDialog: {
    open: false,
    focusRow: 'model',
    modelIdx: 0,
    effortIdx: 0,
  },

  inputHistory: [],
  inputIsEmpty: true,
  inputHistoryNavigating: false,

  // ── Session event reducer ────────────────────────────────────────────────

  applySessionEvent: (agentId: string, evt: SessionEvent) => {
    switch (evt.type) {
      case 'init':
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? { ...a, sessionModel: evt.model, sessionId: evt.sessionId, status: 'waiting' }
              : a,
          ),
          ui:
            state.focusedAgentId === agentId
              ? { ...state.ui, waiting: true }
              : state.ui,
        }));
        break;

      case 'text_delta':
        if (!evt.text) break;
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? { ...a, streamingText: a.streamingText + evt.text, status: 'running' }
              : a,
          ),
          ui:
            state.focusedAgentId === agentId
              ? { ...state.ui, waiting: false }
              : state.ui,
        }));
        break;

      case 'message_complete':
        set((state) => {
          const agent = state.agents.find((a) => a.id === agentId);
          if (!agent?.streamingText) return state;
          const newMessage: Message = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: agent.streamingText,
          };
          return {
            agents: state.agents.map((a) =>
              a.id === agentId
                ? { ...a, messages: [...a.messages, newMessage], streamingText: '' }
                : a,
            ),
            conversationScrollOffset:
              agentId === state.focusedAgentId ? 0 : state.conversationScrollOffset,
          };
        });
        break;

      case 'usage':
        if (evt.costUsd > 0 || evt.inputTokens > 0 || evt.contextTokens > 0) {
          set((state) => {
            const updatedAgents = state.agents.map((a) => {
              if (a.id !== agentId) return a;
              const prev: AgentUsage = a.usage;
              return {
                ...a,
                usage: {
                  inputTokens: prev.inputTokens + evt.inputTokens,
                  outputTokens: prev.outputTokens + evt.outputTokens,
                  costUsd: prev.costUsd + evt.costUsd,
                },
                contextTokens: evt.contextTokens,
                contextWindow: evt.contextWindow > 0 ? evt.contextWindow : a.contextWindow,
              };
            });
            const totalCost = updatedAgents.reduce((sum, a) => sum + a.usage.costUsd, 0);
            const totalTokens = updatedAgents.reduce(
              (sum, a) => sum + a.usage.inputTokens + a.usage.outputTokens,
              0,
            );
            const tokensDisplay =
              totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens);
            return {
              agents: updatedAgents,
              usage: {
                ...state.usage,
                cost: `$${totalCost.toFixed(4)}`,
                tokens: tokensDisplay,
              },
            };
          });
        }
        break;

      case 'waiting':
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId ? { ...a, status: 'waiting' } : a,
          ),
          ui:
            state.focusedAgentId === agentId
              ? { ...state.ui, waiting: evt.state }
              : state.ui,
        }));
        break;

      // Fine-grained status from hook/notification events in the stream.
      case 'status':
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId ? { ...a, status: evt.status } : a,
          ),
          ui:
            state.focusedAgentId === agentId
              ? {
                  ...state.ui,
                  // 'waiting' UI flag: true when session is idle or blocked,
                  // false when actively running.
                  waiting: evt.status === 'waiting' || evt.status === 'blocked',
                }
              : state.ui,
        }));
        break;

      case 'tool_use': {
        const toolCall: ToolCallState = {
          id: evt.id,
          name: evt.name,
          input: evt.input,
          status: 'running',
          isCodex: evt.isCodex,
        };
        const toolMessage: Message = {
          id: `tool-${evt.id}`,
          role: evt.isCodex ? 'codex' : 'tool',
          content: summarizeToolInput(evt.name, evt.input),
          toolName: evt.name,
          toolStatus: 'running',
          toolCallId: evt.id,
        };
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  toolCalls: [...a.toolCalls, toolCall],
                  messages: [...a.messages, toolMessage],
                }
              : a,
          ),
          conversationScrollOffset:
            agentId === state.focusedAgentId ? 0 : state.conversationScrollOffset,
        }));
        break;
      }

      case 'tool_result':
        set((state) => ({
          agents: state.agents.map((a) => {
            if (a.id !== agentId) return a;
            return {
              ...a,
              toolCalls: a.toolCalls.map((tc) =>
                tc.id === evt.toolUseId
                  ? { ...tc, status: evt.isError ? ('error' as const) : ('done' as const), result: evt.content }
                  : tc,
              ),
              messages: a.messages.map((msg) =>
                msg.toolCallId === evt.toolUseId
                  ? { ...msg, toolStatus: evt.isError ? ('error' as const) : ('ok' as const) }
                  : msg,
              ),
            };
          }),
        }));
        break;

      case 'subagent_start': {
        const newSubagent: SubagentInfo = {
          id: evt.id,
          agentType: evt.agentType,
          status: 'running',
          parentToolUseId: evt.parentToolUseId,
        };
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? { ...a, subagents: [...a.subagents, newSubagent] }
              : a,
          ),
        }));
        break;
      }

      case 'subagent_stop':
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  subagents: a.subagents.map((s) =>
                    s.id === evt.id ? { ...s, status: 'done' as const } : s,
                  ),
                }
              : a,
          ),
        }));
        break;

      case 'user_replay':
        // skip — user message already added on submit
        break;

      case 'error':
        set((state) => ({
          agents: state.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  messages: [
                    ...a.messages,
                    {
                      id: `err-${Date.now()}`,
                      role: 'assistant' as const,
                      content: `[오류] ${evt.message}`,
                    },
                  ],
                }
              : a,
          ),
          conversationScrollOffset:
            agentId === state.focusedAgentId ? 0 : state.conversationScrollOffset,
        }));
        break;
    }
  },

  // ── Navigation / UI ──────────────────────────────────────────────────────

  setFocusedAgent: (id: string) =>
    set({ focusedAgentId: id, conversationScrollOffset: 0 }),

  setFocusRegion: (region: FocusRegion) =>
    set((state) => ({ ui: { ...state.ui, focusRegion: region } })),

  setFocusMode: (mode: FocusMode) =>
    set((state) => ({ ui: { ...state.ui, focusMode: mode } })),

  cycleFocusRegion: (direction: 'up' | 'down') =>
    set((state) => {
      const ring = ['agents', 'reference', 'conversation', 'input'] as const;
      const currentIndex = ring.indexOf(state.ui.focusRegion);
      const base = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex =
        direction === 'down'
          ? (base + 1) % ring.length
          : (base - 1 + ring.length) % ring.length;
      return { ui: { ...state.ui, focusRegion: ring[nextIndex]! } };
    }),

  toggleReference: (section: 'skills' | 'mcp' | 'codex') =>
    set((state) => ({
      ui: {
        ...state.ui,
        referenceCollapsed: {
          ...state.ui.referenceCollapsed,
          [section]: !state.ui.referenceCollapsed[section],
        },
      },
    })),

  toggleCheatSheet: () =>
    set((state) => {
      const isShowing = state.ui.showCheatSheet;
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      // Push on open, pop on close (only if 'cheatsheet' is actually on top)
      const newStack: KeyMode[] = isShowing
        ? (top === 'cheatsheet' ? state.ui.modeStack.slice(0, -1) : state.ui.modeStack)
        : (state.ui.modeStack.includes('cheatsheet') ? state.ui.modeStack : [...state.ui.modeStack, 'cheatsheet']);
      return { ui: { ...state.ui, showCheatSheet: !isShowing, modeStack: newStack } };
    }),

  setReferenceCursor: (cursor: 'skills' | 'mcp' | 'codex') =>
    set((state) => ({ ui: { ...state.ui, referenceCursor: cursor } })),

  setWaiting: (waiting: boolean) =>
    set((state) => ({ ui: { ...state.ui, waiting } })),

  updateSystemStats: (cpu: number, mem: number, net?: { rxKBs: number; txKBs: number }, disk?: { usedPct: number }) =>
    set((state) => {
      const HIST = 40;
      const push = (arr: number[], val: number): number[] =>
        arr.length >= HIST ? [...arr.slice(-(HIST - 1)), val] : [...arr, val];
      return {
        system: {
          ...state.system,
          cpu,
          mem,
          net: net ?? state.system.net,
          disk: disk ?? state.system.disk,
          cpuHistory: push(state.system.cpuHistory, cpu),
          memHistory: push(state.system.memHistory, mem),
          netRxHistory: net ? push(state.system.netRxHistory, net.rxKBs) : state.system.netRxHistory,
          netTxHistory: net ? push(state.system.netTxHistory, net.txKBs) : state.system.netTxHistory,
        },
      };
    }),

  pushMode: (mode: KeyMode) =>
    set((state) => {
      // Idempotent: don't push if already at top
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      if (top === mode) return state;
      return { ui: { ...state.ui, modeStack: [...state.ui.modeStack, mode] } };
    }),

  popMode: () =>
    set((state) => ({
      ui: { ...state.ui, modeStack: state.ui.modeStack.slice(0, -1) },
    })),

  cycleAgentFilter: () =>
    set((state) => {
      const order: AgentFilter[] = ['all', 'active', 'blocked'];
      const current = state.ui.agentFilter;
      const idx = order.indexOf(current);
      const next = order[(idx + 1) % order.length] ?? 'all';
      return { ui: { ...state.ui, agentFilter: next } };
    }),

  toggleCopyMode: () =>
    set((state) => {
      const entering = !state.ui.copyMode;
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = entering
        ? (top === 'copy' ? state.ui.modeStack : [...state.ui.modeStack, 'copy'])
        : (top === 'copy' ? state.ui.modeStack.slice(0, -1) : state.ui.modeStack);
      return { ui: { ...state.ui, copyMode: entering, modeStack: newStack } };
    }),

  togglePaneCollapse: (pane) =>
    set((state) => ({
      ui: {
        ...state.ui,
        paneCollapsed: {
          ...state.ui.paneCollapsed,
          [pane]: !state.ui.paneCollapsed[pane],
        },
      },
    })),

  // ── Multi-session management ─────────────────────────────────────────────

  addAgent: (agent: Agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  removeAgent: (agentId: string) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== agentId),
      focusedAgentId:
        state.focusedAgentId === agentId
          ? (state.agents.find((a) => a.id !== agentId)?.id ?? 'live')
          : state.focusedAgentId,
    })),

  registerSessionSend: (agentId: string, send: (text: string) => void) =>
    set((state) => ({
      sessionSends: { ...state.sessionSends, [agentId]: send },
    })),

  unregisterSessionSend: (agentId: string) =>
    set((state) => {
      const { [agentId]: _removed, ...rest } = state.sessionSends;
      void _removed;
      return { sessionSends: rest };
    }),

  registerSessionInterrupt: (agentId: string, fn: () => void) =>
    set((state) => ({
      sessionInterrupts: { ...state.sessionInterrupts, [agentId]: fn },
    })),

  unregisterSessionInterrupt: (agentId: string) =>
    set((state) => {
      const { [agentId]: _removed, ...rest } = state.sessionInterrupts;
      void _removed;
      return { sessionInterrupts: rest };
    }),

  dispatchOp: (agentId: string, op: AgentOp) => {
    const state = get();
    switch (op.type) {
      case 'submit': {
        const send = state.sessionSends[agentId];
        if (!send) break;
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  messages: [
                    ...a.messages,
                    {
                      id: `msg-${Date.now()}`,
                      role: 'user' as const,
                      content: op.text,
                    },
                  ],
                  status: 'running' as const,
                }
              : a,
          ),
          ui: s.focusedAgentId === agentId ? { ...s.ui, waiting: false } : s.ui,
          conversationScrollOffset:
            agentId === s.focusedAgentId ? 0 : s.conversationScrollOffset,
        }));
        send(op.text);
        break;
      }
      case 'interrupt': {
        const interrupt = state.sessionInterrupts[agentId];
        if (!interrupt) break;
        interrupt();
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId ? { ...a, status: 'waiting' as const } : a,
          ),
          ui: s.focusedAgentId === agentId ? { ...s.ui, waiting: true } : s.ui,
        }));
        break;
      }
      case 'clear': {
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId
              ? { ...a, messages: [], streamingText: '', toolCalls: [] }
              : a,
          ),
          conversationScrollOffset:
            agentId === s.focusedAgentId ? 0 : s.conversationScrollOffset,
        }));
        break;
      }
      case 'compact': {
        // /compact is not available in headless stream-json mode — local notice
        set((s) => ({
          agents: s.agents.map((a) =>
            a.id === agentId
              ? {
                  ...a,
                  messages: [
                    ...a.messages,
                    {
                      id: `sys-${Date.now()}`,
                      role: 'assistant' as const,
                      content:
                        '[시스템] /compact은 헤드리스 모드에서 지원되지 않습니다. /clear로 대화 버퍼를 비울 수 있습니다.',
                    },
                  ],
                }
              : a,
          ),
          conversationScrollOffset:
            agentId === s.focusedAgentId ? 0 : s.conversationScrollOffset,
        }));
        break;
      }
    }
  },

  // ── Per-agent state ──────────────────────────────────────────────────────

  setAgentStatus: (agentId: string, status: AgentStatus) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status } : a,
      ),
    })),

  setAgentSessionInfo: (agentId: string, model: string, sessionId: string) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, sessionModel: model, sessionId } : a,
      ),
    })),

  addMessage: (agentId: string, message: Message) =>
    set((state) => ({
      agents: state.agents.map((agent) =>
        agent.id === agentId
          ? { ...agent, messages: [...agent.messages, message] }
          : agent,
      ),
      // Snap back to tail when a new message arrives for the focused agent.
      conversationScrollOffset:
        agentId === state.focusedAgentId ? 0 : state.conversationScrollOffset,
    })),

  appendStreamingForAgent: (agentId: string, text: string) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, streamingText: a.streamingText + text } : a,
      ),
    })),

  commitStreamingForAgent: (agentId: string) =>
    set((state) => {
      const agent = state.agents.find((a) => a.id === agentId);
      if (!agent?.streamingText) return state;
      const newMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: agent.streamingText,
      };
      return {
        agents: state.agents.map((a) =>
          a.id === agentId
            ? { ...a, messages: [...a.messages, newMessage], streamingText: '' }
            : a,
        ),
        // Snap to tail when streaming completes for the focused agent.
        conversationScrollOffset:
          agentId === state.focusedAgentId ? 0 : state.conversationScrollOffset,
      };
    }),

  updateAgentUsage: (
    agentId: string,
    costUsd: number,
    inputTokens: number,
    outputTokens: number,
  ) =>
    set((state) => {
      // Recompute global cost display from all agents
      const updatedAgents = state.agents.map((a) => {
        if (a.id !== agentId) return a;
        const prev: AgentUsage = a.usage;
        return {
          ...a,
          usage: {
            inputTokens: prev.inputTokens + inputTokens,
            outputTokens: prev.outputTokens + outputTokens,
            costUsd: prev.costUsd + costUsd,
          },
        };
      });
      const totalCost = updatedAgents.reduce((sum, a) => sum + a.usage.costUsd, 0);
      const totalTokens = updatedAgents.reduce(
        (sum, a) => sum + a.usage.inputTokens + a.usage.outputTokens,
        0,
      );
      const tokensDisplay =
        totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : String(totalTokens);
      return {
        agents: updatedAgents,
        usage: { ...state.usage, cost: `$${totalCost.toFixed(4)}`, tokens: tokensDisplay },
      };
    }),

  addToolCallToAgent: (agentId: string, toolCall: ToolCallState) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId
          ? { ...a, toolCalls: [...a.toolCalls, toolCall] }
          : a,
      ),
    })),

  updateToolCallInAgent: (
    agentId: string,
    toolUseId: string,
    status: 'done' | 'error',
    result?: string,
  ) =>
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== agentId) return a;
        return {
          ...a,
          toolCalls: a.toolCalls.map((tc) =>
            tc.id === toolUseId ? { ...tc, status, result } : tc,
          ),
          messages: a.messages.map((msg) =>
            msg.toolCallId === toolUseId
              ? { ...msg, toolStatus: status === 'done' ? 'ok' : 'error' }
              : msg,
          ),
        };
      }),
    })),

  updateMessageToolStatus: (
    agentId: string,
    toolCallId: string,
    status: 'ok' | 'error',
  ) =>
    set((state) => ({
      agents: state.agents.map((a) => {
        if (a.id !== agentId) return a;
        return {
          ...a,
          messages: a.messages.map((msg) =>
            msg.toolCallId === toolCallId ? { ...msg, toolStatus: status } : msg,
          ),
        };
      }),
    })),

  setAgentsMdLoaded: (agentId: string, loaded: boolean) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, agentsMdLoaded: loaded } : a,
      ),
    })),

  // ── Scroll actions ───────────────────────────────────────────────────────

  scrollConversation: (delta: number) =>
    set((state) => ({
      conversationScrollOffset: Math.max(0, state.conversationScrollOffset + delta),
    })),

  resetConversationScroll: () => set({ conversationScrollOffset: 0 }),

  // ── Monitoring data actions ──────────────────────────────────────────────

  setSkills: (skills: SkillInfo[]) =>
    set((state) => ({ references: { ...state.references, skills } })),

  setSkillsLoading: (loading: boolean) =>
    set((state) => ({ references: { ...state.references, skillsLoading: loading } })),

  setMcp: (mcp: McpInfo[]) =>
    set((state) => ({ references: { ...state.references, mcp } })),

  setMcpLoading: (loading: boolean) =>
    set((state) => ({ references: { ...state.references, mcpLoading: loading } })),

  setUsageHistory: (history: UsageHistory) =>
    set({ usageHistory: history }),

  setUsageHistoryLoading: (loading: boolean) =>
    set({ usageHistoryLoading: loading }),

  setClaudeUsage: (usage: ClaudeUsage | null) =>
    set({ claudeUsage: usage }),

  setClaudeUsageLoading: (loading: boolean) =>
    set({ claudeUsageLoading: loading }),

  setCodexUsage: (usage: CodexUsage | null) =>
    set({ codexUsage: usage }),

  setCodexUsageLoading: (loading: boolean) =>
    set({ codexUsageLoading: loading }),

  // ── Slash autocomplete actions ───────────────────────────────────────────

  setSlashCommands: (commands: SlashCommand[]) =>
    set((state) => {
      const { open, query } = state.slashAutocomplete;
      return {
        slashAutocomplete: {
          ...state.slashAutocomplete,
          commands,
          filteredCommands: open ? filterSlashCommands(commands, query) : state.slashAutocomplete.filteredCommands,
        },
      };
    }),

  openSlashAutocomplete: (query: string) =>
    set((state) => {
      // Push 'slash' onto modeStack only if not already at top
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'slash'
        ? state.ui.modeStack
        : [...state.ui.modeStack, 'slash'];
      return {
        slashAutocomplete: {
          ...state.slashAutocomplete,
          open: true,
          query,
          selectedIndex: 0,
          filteredCommands: filterSlashCommands(state.slashAutocomplete.commands, query),
        },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  closeSlashAutocomplete: () =>
    set((state) => {
      // Pop 'slash' from modeStack if it is at the top
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'slash'
        ? state.ui.modeStack.slice(0, -1)
        : state.ui.modeStack;
      return {
        slashAutocomplete: {
          ...state.slashAutocomplete,
          open: false,
          query: '',
          selectedIndex: 0,
          filteredCommands: [],
        },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  setSlashQuery: (query: string) =>
    set((state) => ({
      slashAutocomplete: {
        ...state.slashAutocomplete,
        query,
        selectedIndex: 0,
        filteredCommands: filterSlashCommands(state.slashAutocomplete.commands, query),
      },
    })),

  moveSlashSelection: (delta: number) =>
    set((state) => {
      const { selectedIndex, filteredCommands } = state.slashAutocomplete;
      const len = filteredCommands.length;
      if (len === 0) return state;
      const next = ((selectedIndex + delta) % len + len) % len;
      return {
        slashAutocomplete: {
          ...state.slashAutocomplete,
          selectedIndex: next,
        },
      };
    }),

  // ── File autocomplete actions ────────────────────────────────────────────

  setFileList: (files: string[], truncated: boolean) =>
    set((state) => ({
      fileAutocomplete: {
        ...state.fileAutocomplete,
        allFiles: files,
        truncated,
        filteredFiles: state.fileAutocomplete.open
          ? filterFiles(files, state.fileAutocomplete.query)
          : state.fileAutocomplete.filteredFiles,
      },
    })),

  openFileAutocomplete: (query: string) =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'file'
        ? state.ui.modeStack
        : [...state.ui.modeStack, 'file'];
      return {
        fileAutocomplete: {
          ...state.fileAutocomplete,
          open: true,
          query,
          selectedIndex: 0,
          filteredFiles: filterFiles(state.fileAutocomplete.allFiles, query),
        },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  closeFileAutocomplete: () =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'file'
        ? state.ui.modeStack.slice(0, -1)
        : state.ui.modeStack;
      return {
        fileAutocomplete: {
          ...state.fileAutocomplete,
          open: false,
          query: '',
          selectedIndex: 0,
          filteredFiles: [],
        },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  setFileQuery: (query: string) =>
    set((state) => ({
      fileAutocomplete: {
        ...state.fileAutocomplete,
        query,
        selectedIndex: 0,
        filteredFiles: filterFiles(state.fileAutocomplete.allFiles, query),
      },
    })),

  moveFileSelection: (delta: number) =>
    set((state) => {
      const { selectedIndex, filteredFiles } = state.fileAutocomplete;
      const len = filteredFiles.length;
      if (len === 0) return state;
      const next = ((selectedIndex + delta) % len + len) % len;
      return {
        fileAutocomplete: {
          ...state.fileAutocomplete,
          selectedIndex: next,
        },
      };
    }),

  // ── Resume dialog actions ────────────────────────────────────────────────

  openResumeDialog: (sessions: SessionMeta[]) =>
    set((state) => {
      // Push 'resume' onto modeStack only if not already at top
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'resume'
        ? state.ui.modeStack
        : [...state.ui.modeStack, 'resume'];
      return {
        resumeDialog: { open: true, selectedIndex: 0, sessions },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  closeResumeDialog: () =>
    set((state) => {
      // Pop 'resume' from modeStack if it is at the top
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'resume'
        ? state.ui.modeStack.slice(0, -1)
        : state.ui.modeStack;
      return {
        resumeDialog: { ...state.resumeDialog, open: false, selectedIndex: 0 },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  moveResumeSelection: (delta: number) =>
    set((state) => {
      const { selectedIndex, sessions } = state.resumeDialog;
      const len = sessions.length;
      if (len === 0) return state;
      const next = ((selectedIndex + delta) % len + len) % len;
      return {
        resumeDialog: { ...state.resumeDialog, selectedIndex: next },
      };
    }),

  // ── Permission dialog actions ────────────────────────────────────────────

  openPermissionDialog: (toolName, toolInput, toolUseId) =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'permission'
        ? state.ui.modeStack
        : [...state.ui.modeStack, 'permission'];
      return {
        permissionDialog: { open: true, toolName, toolInput, toolUseId },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  closePermissionDialog: () =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'permission'
        ? state.ui.modeStack.slice(0, -1)
        : state.ui.modeStack;
      return {
        permissionDialog: { ...state.permissionDialog, open: false },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  // ── New session dialog actions ────────────────────────────────────────────

  openNewSessionDialog: () =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'newsession'
        ? state.ui.modeStack
        : [...state.ui.modeStack, 'newsession'];
      return {
        newSessionDialog: { ...state.newSessionDialog, open: true, focusRow: 'model' },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  closeNewSessionDialog: () =>
    set((state) => {
      const top = state.ui.modeStack[state.ui.modeStack.length - 1];
      const newStack: KeyMode[] = top === 'newsession'
        ? state.ui.modeStack.slice(0, -1)
        : state.ui.modeStack;
      return {
        newSessionDialog: { ...state.newSessionDialog, open: false },
        ui: { ...state.ui, modeStack: newStack },
      };
    }),

  moveNewSessionRow: (delta: number) =>
    set((state) => {
      const next: 'model' | 'effort' =
        state.newSessionDialog.focusRow === 'model' ? 'effort' : 'model';
      void delta; // delta kept for symmetry; only 2 rows so always toggles
      return {
        newSessionDialog: { ...state.newSessionDialog, focusRow: next },
      };
    }),

  cycleNewSessionOption: (delta: number) =>
    set((state) => {
      // MODEL_OPTIONS_LEN = 4 (default/opus/sonnet/haiku), EFFORT_OPTIONS_LEN = 5 (default/low/medium/high/xhigh)
      const MODEL_LEN = 4;
      const EFFORT_LEN = 5;
      const { focusRow, modelIdx, effortIdx } = state.newSessionDialog;
      if (focusRow === 'model') {
        const next = ((modelIdx + delta) % MODEL_LEN + MODEL_LEN) % MODEL_LEN;
        return { newSessionDialog: { ...state.newSessionDialog, modelIdx: next } };
      } else {
        const next = ((effortIdx + delta) % EFFORT_LEN + EFFORT_LEN) % EFFORT_LEN;
        return { newSessionDialog: { ...state.newSessionDialog, effortIdx: next } };
      }
    }),

  addInputHistory: (text: string) =>
    set((state) => {
      const MAX_HISTORY = 50;
      const next = [...state.inputHistory, text].slice(-MAX_HISTORY);
      return { inputHistory: next };
    }),

  setInputIsEmpty: (empty: boolean) => set({ inputIsEmpty: empty }),

  setInputHistoryNavigating: (navigating: boolean) => set({ inputHistoryNavigating: navigating }),
}));

// Export agent factory so App.tsx can create agents with all required fields.
export { makeAgent };
