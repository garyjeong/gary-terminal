export type MessageRole = 'user' | 'assistant' | 'tool' | 'codex';
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
}
