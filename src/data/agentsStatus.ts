/**
 * agentsStatus.ts — supplementary cross-check via `claude agents --json`
 *
 * Primary status detection is stream-based (session.ts status events).
 * This module provides a coarse supplementary view: which sessions are
 * alive (busy), their PIDs, and whether a session died unexpectedly.
 *
 * Stale-async guard: each fetch is stamped with a monotonic request token.
 * If a newer request completes first (or the module is reset), the late
 * response is discarded. This prevents out-of-order updates.
 *
 * Usage (on-demand, e.g. from Ctrl+R):
 *   const entries = await fetchAgentsStatus();
 *   // match against your sessionId to see if your session is still "busy"
 */

import { execa } from 'execa';

export interface AgentStatusEntry {
  pid: number;
  cwd: string;
  kind: string;
  startedAt: number;
  sessionId: string;
  /** 'busy' | 'idle' | 'completed' — values observed from claude CLI */
  status: string;
}

// Monotonic request counter for stale-async guard.
let _latestRequestToken = 0;

/**
 * Fetch the list of background/interactive claude agent sessions.
 * Returns null on error (CLI unavailable, parse failure, stale response).
 */
export async function fetchAgentsStatus(): Promise<AgentStatusEntry[] | null> {
  const myToken = ++_latestRequestToken;

  try {
    const { stdout } = await execa('claude', ['agents', '--json', '--all']);
    // Stale guard: discard if a newer request has already superseded this one.
    if (myToken !== _latestRequestToken) return null;

    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return null;

    return (parsed as Array<Record<string, unknown>>).map((entry) => ({
      pid: Number(entry['pid'] ?? 0),
      cwd: String(entry['cwd'] ?? ''),
      kind: String(entry['kind'] ?? ''),
      startedAt: Number(entry['startedAt'] ?? 0),
      sessionId: String(entry['sessionId'] ?? ''),
      status: String(entry['status'] ?? ''),
    }));
  } catch {
    return null;
  }
}

/**
 * Given our session's sessionId, look up whether it appears in the
 * `claude agents --json` output and return its status.
 * Returns null if not found or on error.
 */
export async function getSessionAgentStatus(
  sessionId: string,
): Promise<AgentStatusEntry | null> {
  const entries = await fetchAgentsStatus();
  if (!entries) return null;
  return entries.find((e) => e.sessionId === sessionId) ?? null;
}
