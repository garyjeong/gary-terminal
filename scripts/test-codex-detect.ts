#!/usr/bin/env node
/**
 * Unit test for codex detection logic in session.ts
 *
 * Tests both:
 *  1. The exported helper detectCodexToolUse()
 *  2. End-to-end event emission via ClaudeSession.handleLine() (no live API call)
 *
 * Usage: pnpm tsx scripts/test-codex-detect.ts
 */

import { detectCodexToolUse, ClaudeSession } from '../src/claude/session.js';
import type { SessionEvent } from '../src/claude/session.js';

// ---------------------------------------------------------------------------
// Part 1: unit-test the exported helper
// ---------------------------------------------------------------------------

interface Case {
  name: string;
  input: Record<string, unknown>;
  expected: boolean;
  label: string;
}

const helperCases: Case[] = [
  {
    name: 'Bash',
    input: { command: 'codex exec "summarise this"' },
    expected: true,
    label: 'Bash with codex exec → codex',
  },
  {
    name: 'Bash',
    input: { command: 'codex "plain call"' },
    expected: true,
    label: 'Bash with bare codex → codex',
  },
  {
    name: 'Bash',
    input: { command: 'ls -la' },
    expected: false,
    label: 'Bash without codex → not codex',
  },
  {
    name: 'Bash',
    input: { command: 'echo codex' },
    expected: true,
    label: 'Bash echoing the word codex → codex (matches substring)',
  },
  {
    name: 'Read',
    input: { file_path: '/codex/config.json' },
    expected: false,
    label: 'Non-Bash tool → not codex',
  },
  {
    name: 'Write',
    input: { file_path: 'out.ts', content: 'codex' },
    expected: false,
    label: 'Write tool → not codex even if content has codex',
  },
];

let pass = 0;
let fail = 0;

console.log('\n=== Part 1: detectCodexToolUse() helper ===\n');
for (const c of helperCases) {
  const result = detectCodexToolUse(c.name, c.input);
  if (result === c.expected) {
    console.log(`  PASS  ${c.label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${c.label}`);
    console.error(`        got=${result}, expected=${c.expected}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------
// Part 2: end-to-end via ClaudeSession.handleLine()
// ---------------------------------------------------------------------------

console.log('\n=== Part 2: ClaudeSession.handleLine() integration ===\n');

function runSessionTest(label: string, lines: string[], checker: (events: SessionEvent[]) => boolean): void {
  const session = new ClaudeSession('__test__');
  const events: SessionEvent[] = [];
  session.onEvent((evt) => events.push(evt));

  for (const line of lines) {
    session.handleLine(line);
  }

  if (checker(events)) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.error(`  FAIL  ${label}`);
    console.error('        events:', JSON.stringify(events, null, 2));
    fail++;
  }
}

// Test: assistant message with tool_use (Bash/codex)
runSessionTest(
  'assistant tool_use codex → emits tool_use with isCodex=true',
  [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_01',
            name: 'Bash',
            input: { command: 'codex exec "design review"' },
          },
        ],
      },
    }),
  ],
  (evts) => {
    const tu = evts.find((e) => e.type === 'tool_use');
    return (
      tu !== undefined &&
      tu.type === 'tool_use' &&
      tu.id === 'toolu_01' &&
      tu.isCodex === true
    );
  },
);

// Test: assistant message with non-codex Bash
runSessionTest(
  'assistant tool_use Bash non-codex → emits tool_use with isCodex=false',
  [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_02',
            name: 'Bash',
            input: { command: 'npm test' },
          },
        ],
      },
    }),
  ],
  (evts) => {
    const tu = evts.find((e) => e.type === 'tool_use');
    return tu !== undefined && tu.type === 'tool_use' && tu.isCodex === false;
  },
);

// Test: duplicate assistant events don't duplicate tool_use emissions
runSessionTest(
  'duplicate assistant events → tool_use emitted only once',
  [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_03',
            name: 'Bash',
            input: { command: 'codex exec "x"' },
          },
        ],
      },
    }),
    // Same event again (partial-message re-emission)
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_03',
            name: 'Bash',
            input: { command: 'codex exec "x"' },
          },
        ],
      },
    }),
  ],
  (evts) => {
    const toolUseEvents = evts.filter((e) => e.type === 'tool_use');
    return toolUseEvents.length === 1;
  },
);

// Test: tool_result from user message
runSessionTest(
  'user message with tool_result → emits tool_result event',
  [
    JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_04',
            content: 'Done.',
            is_error: false,
          },
        ],
      },
    }),
  ],
  (evts) => {
    const tr = evts.find((e) => e.type === 'tool_result');
    return (
      tr !== undefined &&
      tr.type === 'tool_result' &&
      tr.toolUseId === 'toolu_04' &&
      tr.content === 'Done.' &&
      tr.isError === false
    );
  },
);

// Test: text_delta still works (regression)
runSessionTest(
  'assistant text block → emits text_delta (M1 regression check)',
  [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Hello world' },
        ],
      },
    }),
  ],
  (evts) => evts.some((e) => e.type === 'text_delta'),
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
