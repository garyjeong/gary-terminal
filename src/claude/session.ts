/**
 * M1 — Claude headless session
 *
 * Launch command:
 *   claude -p --output-format stream-json --input-format stream-json --verbose \
 *     --include-partial-messages --include-hook-events --replay-user-messages
 *
 * stdin:  NDJSON  { type: 'user', message: { role: 'user', content: [...] } }
 * stdout: NDJSON  stream-json events
 *
 * M2-A additions:
 *  - tool_use event: assistant content block with type "tool_use"
 *  - tool_result event: user message content block with type "tool_result"
 *  - handleLine(): public method for testing / synthetic injection
 *  - Codex detection exported helper: detectCodexToolUse()
 */

import { EventEmitter } from 'node:events';
import { execa } from 'execa';
import { createInterface } from 'node:readline';
import type { Writable, Readable } from 'node:stream';

// ---------------------------------------------------------------------------
// Public event types
// ---------------------------------------------------------------------------

export type SessionEvent =
  | { type: 'init'; model: string; sessionId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'message_complete'; text: string }
  | { type: 'user_replay'; content: string }
  | {
      type: 'usage';
      costUsd: number;
      inputTokens: number;
      outputTokens: number;
      /** input + cache_creation + cache_read (not cumulative — latest turn value) */
      contextTokens: number;
      /** Max context window for the model (0 = unknown) */
      contextWindow: number;
    }
  | { type: 'waiting'; state: boolean }
  /**
   * Fine-grained status event derived from hook/notification events in the stream.
   * Emitted when the session transitions to a new state detected from hook events:
   *   - 'running'  : API request in flight (system:status:requesting)
   *   - 'waiting'  : session idle, awaiting user input (notification:idle_prompt)
   *   - 'blocked'  : session waiting for user permission (notification:permission_prompt)
   */
  | { type: 'status'; status: 'running' | 'waiting' | 'blocked' }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; isCodex: boolean }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'error'; message: string }
  /**
   * SubagentStart: a subagent was spawned by this session.
   * id       : unique identifier for the subagent (agent_id or tool_use_id)
   * agentType: type/name of the spawned agent (e.g. "code-reviewer")
   * parentToolUseId: tool_use_id of the Task/Agent call that spawned this subagent
   *
   * Format observed from --include-hook-events:
   *   Direct:  { type:"system", subtype:"subagent_start", agent_id, agent_type, parent_tool_use_id? }
   *   Via hook: { type:"system", subtype:"hook_started", hook_event_name:"SubagentStart",
   *               hook_event: { agent_id, agent_type, parent_tool_use_id? } }
   */
  | { type: 'subagent_start'; id: string; agentType: string; parentToolUseId?: string }
  /**
   * SubagentStop: a previously started subagent has finished.
   */
  | { type: 'subagent_stop'; id: string }
  /** Emitted when the claude process exits unexpectedly (not via stop()). */
  | { type: 'exited'; code?: number };

// ---------------------------------------------------------------------------
// Exported helper: codex detection
// ---------------------------------------------------------------------------

/**
 * Returns true if this tool call is a Bash call that invokes codex.
 * Exported so it can be tested in isolation (scripts/test-codex-detect.ts).
 */
export function detectCodexToolUse(
  name: string,
  input: Record<string, unknown>,
): boolean {
  return (
    name === 'Bash' &&
    typeof input['command'] === 'string' &&
    input['command'].includes('codex')
  );
}

// ---------------------------------------------------------------------------
// ClaudeSession class
// ---------------------------------------------------------------------------

export class ClaudeSession extends EventEmitter {
  private readonly agentId: string;
  private procStdin: Writable | null = null;
  private procKill: (() => void) | null = null;
  private _interruptFn: (() => void) | null = null;
  private stopped = false;
  private _streamingText = '';
  /** Accumulated text from partial assistant events (for delta diffs) */
  private _lastAssistantText = '';
  /** Tool use IDs already emitted — guards against duplicate partial events */
  private _emittedToolUseIds = new Set<string>();
  /** Model name from init event (used for contextWindow fallback) */
  private _model = '';
  /** Context window size — resolved once from result.modelUsage */
  private _contextWindow = 0;

  constructor(agentId: string) {
    super();
    this.agentId = agentId;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(opts?: {
    resumeSessionId?: string;
    appendSystemPrompt?: string;
    settingsPath?: string;
    /** --model <model>: override claude model (e.g. 'claude-sonnet-4-6'). Omit for user default. */
    model?: string;
    /** --effort <level>: set reasoning effort (low/medium/high/xhigh/max). Omit for default. */
    effort?: string;
  }): void {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--include-hook-events',
      '--replay-user-messages',
    ];
    if (opts?.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    }
    if (opts?.appendSystemPrompt) {
      args.push('--append-system-prompt', opts.appendSystemPrompt);
    }
    if (opts?.settingsPath) {
      args.push('--settings', opts.settingsPath);
    }
    if (opts?.model) {
      args.push('--model', opts.model);
    }
    if (opts?.effort) {
      args.push('--effort', opts.effort);
    }
    const proc = execa(
      'claude',
      args,
      {
        stdin: 'pipe' as const,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    );

    // Store typed references to the streams we need
    this.procStdin = proc.stdin as Writable | null;
    this.procKill = () => {
      try {
        proc.kill();
      } catch {
        // Ignore errors during shutdown (process may already be gone)
      }
    };

    this._interruptFn = () => {
      try {
        proc.kill('SIGINT' as NodeJS.Signals);
      } catch {
        // ignore if process is already gone
      }
    };

    const stdout = proc.stdout as Readable | null;
    if (!stdout) {
      this._emitEvent({ type: 'error', message: 'No stdout from claude process' });
      return;
    }

    // Buffer stdout line-by-line and parse NDJSON
    const rl = createInterface({ input: stdout as NodeJS.ReadableStream });
    rl.on('line', (line: string) => this.handleLine(line));

    // Handle process exit — both normal (code 0) and abnormal (error/signal).
    // On normal exit without stop(): emit 'exited' so the store marks the agent done.
    // On signal/expected termination: suppress silently.
    // On unexpected error exit: emit error then exited.
    void proc.then(
      () => {
        // Resolved = exit code 0 (clean exit we didn't trigger)
        if (!this.stopped) {
          this._handleProcessExit(0);
        }
      },
      (err: unknown) => {
        if (this.stopped) return;
        const anyErr = err as { exitCode?: number; signal?: string };
        if (
          anyErr.exitCode === 143 ||
          anyErr.signal === 'SIGTERM' ||
          anyErr.signal === 'SIGKILL' ||
          anyErr.signal === 'SIGINT'
        ) {
          return; // Expected/intentional termination — suppress
        }
        // Unexpected error: show message, then mark exited
        this._emitEvent({ type: 'error', message: (err as Error).message });
        this._handleProcessExit(anyErr.exitCode);
      },
    );
  }

  stop(): void {
    this.stopped = true;
    try {
      this.procStdin?.end();
    } catch {
      // ignore
    }
    this.procKill?.();
    this.procStdin = null;
    this.procKill = null;
    this._interruptFn = null;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  interrupt(): void {
    this._interruptFn?.();
  }

  sendMessage(text: string): void {
    if (this.stopped || !this.procStdin) return;
    const payload = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    });
    this.procStdin.write(payload + '\n');
  }

  // -------------------------------------------------------------------------
  // Public line processor (for testing and live use)
  // -------------------------------------------------------------------------

  /**
   * Parse a single NDJSON line and dispatch the corresponding events.
   * Public so that scripts/test-codex-detect.ts can inject synthetic lines.
   */
  handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      this._handleRawEvent(parsed);
    } catch {
      // Ignore non-JSON lines (startup banners, etc.)
    }
  }

  // -------------------------------------------------------------------------
  // Typed event subscription helper
  // -------------------------------------------------------------------------

  onEvent(handler: (evt: SessionEvent) => void): () => void {
    const listener = (evt: SessionEvent) => handler(evt);
    this.on('event', listener);
    return () => this.off('event', listener);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _emitEvent(evt: SessionEvent): void {
    this.emit('event', evt);
  }

  /**
   * Called when the child process exits (cleanly or with an unexpected code).
   * Nulls out the I/O handles so further sendMessage/interrupt calls are no-ops,
   * then emits 'exited' so the store can mark the agent as done.
   */
  private _handleProcessExit(code: number | undefined): void {
    this.procStdin = null;
    this.procKill = null;
    this._interruptFn = null;
    this._emitEvent({ type: 'exited', code });
  }

  /** Fallback context window by model name when modelUsage is absent */
  private _resolveContextWindowFallback(): number {
    const m = this._model.toLowerCase();
    if (m.includes('haiku')) return 200_000;
    // opus with extended context (1m / 1000k)
    if (m.includes('opus') && (m.includes('1m') || m.includes('1000k'))) return 1_000_000;
    // default for opus, sonnet, and unknown
    return 200_000;
  }

  private _handleRawEvent(data: Record<string, unknown>): void {
    const evtType = data['type'] as string | undefined;

    // ── system events ──────────────────────────────────────────────────────

    // system::init — session started, model negotiated
    if (evtType === 'system' && data['subtype'] === 'init') {
      const model = String(data['model'] ?? '');
      const sessionId = String(data['session_id'] ?? '');
      this._model = model;
      this._emitEvent({ type: 'init', model, sessionId });
      return;
    }

    // system::status — coarse lifecycle status from claude CLI
    // Observable values: "requesting" (API call in flight)
    if (evtType === 'system' && data['subtype'] === 'status') {
      const statusVal = data['status'] as string | undefined;
      if (statusVal === 'requesting') {
        // API call started → session is actively running.
        // Only emit if not already streaming (text_delta already handles that);
        // this catches tool-use turns where no text is emitted but the session
        // is still working.
        this._emitEvent({ type: 'status', status: 'running' });
      }
      return;
    }

    // system::notification — hook-level notification events (--include-hook-events)
    // Observed with permission_prompt / idle_prompt notification_type values.
    // Format: { type:"system", subtype:"notification", notification_type:"..." }
    if (evtType === 'system' && data['subtype'] === 'notification') {
      const notifType = data['notification_type'] as string | undefined;
      if (notifType === 'permission_prompt') {
        this._emitEvent({ type: 'status', status: 'blocked' });
      } else if (notifType === 'idle_prompt') {
        this._emitEvent({ type: 'status', status: 'waiting' });
      }
      // Other notification types are silently ignored.
      return;
    }

    // system::subagent_start / subagent_stop — direct subtype form (if claude CLI uses this format)
    if (evtType === 'system' && data['subtype'] === 'subagent_start') {
      const id = String(data['agent_id'] ?? data['tool_use_id'] ?? '');
      const agentType = String(data['agent_type'] ?? 'agent');
      const parentToolUseId = data['parent_tool_use_id'] ? String(data['parent_tool_use_id']) : undefined;
      if (id) this._emitEvent({ type: 'subagent_start', id, agentType, parentToolUseId });
      return;
    }
    if (evtType === 'system' && data['subtype'] === 'subagent_stop') {
      const id = String(data['agent_id'] ?? data['tool_use_id'] ?? '');
      if (id) this._emitEvent({ type: 'subagent_stop', id });
      return;
    }

    // system::hook_started — PreToolUse/PostToolUse hooks firing, AND potentially
    // SubagentStart/SubagentStop lifecycle events delivered as hook events.
    // Check for subagent lifecycle before silently consuming.
    if (evtType === 'system' && data['subtype'] === 'hook_started') {
      const hookEventName = data['hook_event_name'] as string | undefined;
      if (hookEventName === 'SubagentStart') {
        const hookEvent = data['hook_event'] as Record<string, unknown> | undefined;
        const id = String(hookEvent?.['agent_id'] ?? hookEvent?.['tool_use_id'] ?? `subagent-${Date.now()}`);
        const agentType = String(hookEvent?.['agent_type'] ?? 'agent');
        const parentToolUseId = hookEvent?.['parent_tool_use_id']
          ? String(hookEvent['parent_tool_use_id'])
          : undefined;
        this._emitEvent({ type: 'subagent_start', id, agentType, parentToolUseId });
      } else if (hookEventName === 'SubagentStop') {
        const hookEvent = data['hook_event'] as Record<string, unknown> | undefined;
        const id = String(hookEvent?.['agent_id'] ?? hookEvent?.['tool_use_id'] ?? '');
        if (id) this._emitEvent({ type: 'subagent_stop', id });
      }
      // All hook_started events (incl. PreToolUse/PostToolUse): no status change needed.
      return;
    }

    // system::hook_response — silently consume (status already set by other events).
    if (evtType === 'system' && data['subtype'] === 'hook_response') {
      return;
    }

    // assistant — claude CLI emits assistant-type events for partial & final messages
    if (evtType === 'assistant') {
      const message = data['message'] as Record<string, unknown> | undefined;
      const contentBlocks = message?.['content'];
      let fullText = '';
      if (Array.isArray(contentBlocks)) {
        const blocks = contentBlocks as Array<Record<string, unknown>>;

        // Extract text content
        fullText = blocks
          .filter((b) => b['type'] === 'text')
          .map((b) => String(b['text'] ?? ''))
          .join('');

        // Extract tool_use blocks (deduplicated by id)
        for (const block of blocks) {
          if (block['type'] === 'tool_use') {
            const toolId = String(block['id'] ?? '');
            if (toolId && !this._emittedToolUseIds.has(toolId)) {
              this._emittedToolUseIds.add(toolId);
              const toolName = String(block['name'] ?? '');
              const toolInput = (block['input'] as Record<string, unknown>) ?? {};
              const isCodex = detectCodexToolUse(toolName, toolInput);
              this._emitEvent({ type: 'tool_use', id: toolId, name: toolName, input: toolInput, isCodex });
            }
          }
        }
      }

      // Emit only the *new* characters since last partial event
      if (fullText.length > this._lastAssistantText.length) {
        const newChars = fullText.slice(this._lastAssistantText.length);
        this._lastAssistantText = fullText;
        this._streamingText = fullText;
        this._emitEvent({ type: 'text_delta', text: newChars });
      }
      return;
    }

    // content_block_delta — raw streaming delta (fallback for non-cli mode)
    if (evtType === 'content_block_delta') {
      const delta = data['delta'] as Record<string, unknown> | undefined;
      if (delta?.['type'] === 'text_delta') {
        const text = String(delta['text'] ?? '');
        this._streamingText += text;
        this._lastAssistantText += text;
        this._emitEvent({ type: 'text_delta', text });
      }
      return;
    }

    // content_block_stop — finalize streaming (raw mode fallback)
    if (evtType === 'content_block_stop') {
      if (this._streamingText) {
        const text = this._streamingText;
        this._streamingText = '';
        this._lastAssistantText = '';
        this._emitEvent({ type: 'message_complete', text });
      }
      return;
    }

    // result — final summary: commit message, emit cost, set waiting
    if (evtType === 'result') {
      // Use accumulated assistant text, or fall back to result.result field
      const finalText = this._lastAssistantText || String(data['result'] ?? '');
      if (finalText) {
        this._emitEvent({ type: 'message_complete', text: finalText });
      }
      this._lastAssistantText = '';
      this._streamingText = '';
      // Reset tool use dedup set for next turn
      this._emittedToolUseIds.clear();

      const costUsd = Number(data['total_cost_usd'] ?? data['cost_usd'] ?? 0);
      const usageData = data['usage'] as Record<string, unknown> | undefined;
      const inputTokens = Number(usageData?.['input_tokens'] ?? 0);
      const outputTokens = Number(usageData?.['output_tokens'] ?? 0);
      const cacheCreation = Number(usageData?.['cache_creation_input_tokens'] ?? 0);
      const cacheRead = Number(usageData?.['cache_read_input_tokens'] ?? 0);
      const contextTokens = inputTokens + cacheCreation + cacheRead;

      // Resolve contextWindow from modelUsage (once per session), then fallback
      if (this._contextWindow === 0) {
        const modelUsageData = data['modelUsage'] as Record<string, Record<string, unknown>> | undefined;
        if (modelUsageData) {
          // Prefer the session's primary model (the init model includes the
          // [1m] suffix). Otherwise pick the LARGEST contextWindow across
          // entries — utility/subagent models (e.g. haiku at 200k) also appear
          // in modelUsage and must not shadow the main model's window
          // (e.g. claude-opus-4-8[1m] = 1,000,000).
          const primaryCw = Number(modelUsageData[this._model]?.['contextWindow'] ?? 0);
          if (primaryCw > 0) {
            this._contextWindow = primaryCw;
          } else {
            let maxCw = 0;
            for (const modelData of Object.values(modelUsageData)) {
              const cw = Number(modelData['contextWindow'] ?? 0);
              if (cw > maxCw) maxCw = cw;
            }
            this._contextWindow = maxCw;
          }
        }
        if (this._contextWindow === 0) {
          this._contextWindow = this._resolveContextWindowFallback();
        }
      }

      this._emitEvent({ type: 'usage', costUsd, inputTokens, outputTokens, contextTokens, contextWindow: this._contextWindow });
      this._emitEvent({ type: 'waiting', state: true });
      return;
    }

    // user — echoed user message or tool_result blocks
    if (evtType === 'user') {
      const message = data['message'] as Record<string, unknown> | undefined;
      const raw = message?.['content'];

      if (Array.isArray(raw)) {
        const blocks = raw as Array<Record<string, unknown>>;
        let textContent = '';

        for (const block of blocks) {
          if (block['type'] === 'tool_result') {
            // Tool result block — resolve the pending tool call
            const toolUseId = String(block['tool_use_id'] ?? '');
            const content = block['content'];
            let contentStr = '';
            if (typeof content === 'string') {
              contentStr = content;
            } else if (Array.isArray(content)) {
              contentStr = (content as Array<Record<string, unknown>>)
                .filter((b) => b['type'] === 'text')
                .map((b) => String(b['text'] ?? ''))
                .join('');
            }
            const isError = Boolean(block['is_error'] ?? false);
            this._emitEvent({ type: 'tool_result', toolUseId, content: contentStr, isError });
          } else if (block['type'] === 'text') {
            textContent += String(block['text'] ?? '');
          }
        }

        if (textContent) {
          this._emitEvent({ type: 'user_replay', content: textContent });
        }
      } else if (typeof raw === 'string' && raw) {
        this._emitEvent({ type: 'user_replay', content: raw });
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory (kept for backward compatibility with M0 stub callers)
// ---------------------------------------------------------------------------

export function createSession(agentId: string): ClaudeSession {
  return new ClaudeSession(agentId);
}
