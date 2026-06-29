export type MessageRole = 'user' | 'assistant' | 'tool' | 'codex';

// ── Bound Process (server process monitoring) ─────────────────────────────────
export interface BoundProcess {
  /** Unique id (timestamp-based). */
  id: string;
  /** Human-readable label shown in the UI (e.g. "port:3000", "node"). */
  label: string;
  /** How the process was specified. */
  bindType: 'port' | 'pid' | 'name';
  /** The original bind specification string (port number, PID, or name). */
  bindValue: string;
  /** Resolved PID (null if not yet found or process exited). */
  pid: number | null;
  /** Process name (short). */
  name: string;
  /** Full command line (may be empty). */
  command: string;
  /** CPU usage percentage (from ps/si). */
  cpu: number;
  /** Memory percentage (from ps/si). */
  mem: number;
  /** Resident set size in MB. */
  memRssMB: number;
  /** False once the process has exited. */
  alive: boolean;
  /** Rolling history for the mini sparkline (same cadence as global stats). */
  cpuHistory: number[];
}

/** Lightweight process entry used in the BindDialog process list. */
export interface TopProc {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  command: string;
}
export type AgentStatus = 'running' | 'waiting' | 'blocked' | 'done';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolName?: string;
  toolStatus?: 'ok' | 'error' | 'running';
  /** Links message to a ToolCallState id for later status updates */
  toolCallId?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  isCodex: boolean;
  result?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * A subagent spawned by this session (from SubagentStart/Stop hook events).
 * parentToolUseId links to the Task/Agent tool_use that spawned this subagent.
 */
export interface SubagentInfo {
  id: string;
  agentType: string;
  status: 'running' | 'done';
  parentToolUseId?: string;
}

export interface Agent {
  id: string;
  title: string;
  status: AgentStatus;
  messages: Message[];
  /** Per-agent live streaming buffer */
  streamingText: string;
  /** Claude model name (from session init) */
  sessionModel: string;
  /** Claude session ID (from session init) */
  sessionId: string;
  /** Cumulative usage for this agent */
  usage: AgentUsage;
  /** Active / completed tool calls for this agent */
  toolCalls: ToolCallState[];
  /** Latest context token count (input + cache; not cumulative) */
  contextTokens: number;
  /** Max context window for this agent's model (0 = unknown) */
  contextWindow: number;
  /** Subagents spawned during this session (from SubagentStart/Stop events) */
  subagents: SubagentInfo[];
  /** True when AGENTS.md was found in cwd and injected via --append-system-prompt */
  agentsMdLoaded: boolean;
  /** Requested model at spawn time (passed to --model flag; undefined = user default) */
  requestedModel?: string;
  /** Requested effort at spawn time (passed to --effort flag; undefined = not set) */
  effort?: string;
  /**
   * True when this agent was created by resuming a previous claude session.
   * Resume agents replay user_replay events (past user messages) into their
   * message list; live agents skip them to avoid duplicating just-submitted text.
   */
  isResume: boolean;
}
