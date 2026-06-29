#!/usr/bin/env node
/**
 * Unit test: SubagentStart/Stop parsing via ClaudeSession.handleLine()
 *
 * Tests both possible formats:
 *   A) Direct subtype: { type:"system", subtype:"subagent_start", agent_id, agent_type, ... }
 *   B) Via hook_started: { type:"system", subtype:"hook_started",
 *                          hook_event_name:"SubagentStart", hook_event:{...} }
 *
 * Usage: pnpm tsx scripts/test-subagent.ts
 */

import { ClaudeSession } from '../src/claude/session.js';
import type { SessionEvent } from '../src/claude/session.js';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}`);
    failed++;
  }
}

// ── Helper: create a fresh session and collect events ──────────────────────

function makeSession(): { session: ClaudeSession; events: SessionEvent[] } {
  const session = new ClaudeSession('test-subagent');
  const events: SessionEvent[] = [];
  session.onEvent((evt) => events.push(evt));
  return { session, events };
}

// ── Test A: Direct system subtype "subagent_start" ────────────────────────

console.log('\nTest A: direct subtype form');
{
  const { session, events } = makeSession();

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'subagent_start',
    agent_id: 'sub-001',
    agent_type: 'code-reviewer',
    parent_tool_use_id: 'tool-abc',
  }));

  const startEvt = events.find((e) => e.type === 'subagent_start') as Extract<SessionEvent, { type: 'subagent_start' }> | undefined;
  assert(startEvt !== undefined, 'subagent_start event emitted');
  assert(startEvt?.id === 'sub-001', `id = "${startEvt?.id}" (expected "sub-001")`);
  assert(startEvt?.agentType === 'code-reviewer', `agentType = "${startEvt?.agentType}"`);
  assert(startEvt?.parentToolUseId === 'tool-abc', `parentToolUseId = "${startEvt?.parentToolUseId}"`);

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'subagent_stop',
    agent_id: 'sub-001',
  }));

  const stopEvt = events.find((e) => e.type === 'subagent_stop') as Extract<SessionEvent, { type: 'subagent_stop' }> | undefined;
  assert(stopEvt !== undefined, 'subagent_stop event emitted');
  assert(stopEvt?.id === 'sub-001', `stop id = "${stopEvt?.id}"`);
}

// ── Test B: Via hook_started with hook_event_name="SubagentStart" ─────────

console.log('\nTest B: hook_started form (SubagentStart)');
{
  const { session, events } = makeSession();

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'hook_started',
    hook_event_name: 'SubagentStart',
    hook_event: {
      agent_id: 'sub-002',
      agent_type: 'code-implementer',
      parent_tool_use_id: 'tool-xyz',
    },
  }));

  const startEvt = events.find((e) => e.type === 'subagent_start') as Extract<SessionEvent, { type: 'subagent_start' }> | undefined;
  assert(startEvt !== undefined, 'subagent_start event emitted via hook_started');
  assert(startEvt?.id === 'sub-002', `id = "${startEvt?.id}"`);
  assert(startEvt?.agentType === 'code-implementer', `agentType = "${startEvt?.agentType}"`);
  assert(startEvt?.parentToolUseId === 'tool-xyz', `parentToolUseId = "${startEvt?.parentToolUseId}"`);

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'hook_started',
    hook_event_name: 'SubagentStop',
    hook_event: {
      agent_id: 'sub-002',
    },
  }));

  const stopEvt = events.find((e) => e.type === 'subagent_stop') as Extract<SessionEvent, { type: 'subagent_stop' }> | undefined;
  assert(stopEvt !== undefined, 'subagent_stop event emitted via hook_started');
  assert(stopEvt?.id === 'sub-002', `stop id = "${stopEvt?.id}"`);
}

// ── Test C: Existing hook_started (PreToolUse) still consumed silently ─────

console.log('\nTest C: non-subagent hook_started (PreToolUse) still consumed silently');
{
  const { session, events } = makeSession();

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'hook_started',
    hook_event_name: 'PreToolUse',
    hook_event: { tool: 'Bash' },
  }));

  const subEvts = events.filter((e) => e.type === 'subagent_start' || e.type === 'subagent_stop');
  assert(subEvts.length === 0, 'no subagent events emitted for PreToolUse hook');
  // Also ensure no other events were emitted unexpectedly
  assert(events.length === 0, 'no events emitted at all for non-subagent hook');
}

// ── Test D: tool_use_id fallback when agent_id absent ────────────────────

console.log('\nTest D: tool_use_id fallback');
{
  const { session, events } = makeSession();

  session.handleLine(JSON.stringify({
    type: 'system',
    subtype: 'subagent_start',
    tool_use_id: 'toolu-999',
    agent_type: 'search',
  }));

  const startEvt = events.find((e) => e.type === 'subagent_start') as Extract<SessionEvent, { type: 'subagent_start' }> | undefined;
  assert(startEvt !== undefined, 'subagent_start with tool_use_id fallback emitted');
  assert(startEvt?.id === 'toolu-999', `id via tool_use_id = "${startEvt?.id}"`);
  assert(startEvt?.parentToolUseId === undefined, 'parentToolUseId undefined when absent');
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
