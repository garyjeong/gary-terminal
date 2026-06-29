/**
 * test-input.ts — unit tests for the controlled InputPane core logic.
 *
 * Verifies the pure helpers in src/components/inputUtils.ts that the InputPane
 * useInput handler is built on. The handler itself drives a (value, cursor)
 * state machine using exactly these helpers, so we simulate that machine here.
 *
 * Run:  pnpm tsx scripts/test-input.ts
 *
 * Coverage:
 *   1. Korean consecutive insertion ("안"→"안녕"→"안녕하세요") accumulates immediately
 *   2. Backspace deletes by code point (character), not byte — "안녕" → "안"
 *   3. Emoji (supplementary plane / surrogate pair) insert & delete as 1 unit
 *   4. Insertion / deletion at a mid-string cursor position
 *   5. Control bytes (U+0000–U+001F) are ignored
 *   6. Slash (/) and @ trigger detection works off the value
 *   7. Ctrl+U whole-line clear
 */

import {
  cpSplit,
  cpLen,
  cpInsert,
  cpDeleteBefore,
  isPrintableInput,
  renderWithCursor,
  detectSlashTrigger,
  detectFileTrigger,
  ANSI_INVERSE_ON,
  ANSI_INVERSE_OFF,
} from '../src/components/inputUtils.js';

// ─── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(desc: string, cond: boolean, actual?: unknown, expected?: unknown): void {
  if (cond) {
    console.log(`  ✓ ${desc}`);
    passed++;
  } else {
    console.log(`  ✗ ${desc}`);
    console.log(`    Expected: ${JSON.stringify(expected)}`);
    console.log(`    Actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── State-machine simulation (mirrors the useInput handler) ──────────────────
interface InputState {
  value: string;
  cursor: number; // code-point offset
}

/** Simulate a printable-key event (the step-9 branch of the handler). */
function typeInput(state: InputState, input: string): InputState {
  // Control bytes are ignored, exactly like the handler's isPrintableInput gate.
  if (!isPrintableInput(input)) return state;
  const inputCodePoints = cpSplit(input);
  return {
    value: cpInsert(state.value, state.cursor, inputCodePoints),
    cursor: state.cursor + inputCodePoints.length,
  };
}

/** Simulate a backspace/delete event. */
function backspace(state: InputState): InputState {
  const [newVal, newCursor] = cpDeleteBefore(state.value, state.cursor);
  return { value: newVal, cursor: newCursor };
}

/** Simulate Ctrl+U (kill line). */
function killLine(_state: InputState): InputState {
  return { value: '', cursor: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('=== InputPane core-logic tests ===\n');

// ── 1. Korean consecutive insertion accumulates immediately ──────────────────
console.log('1) Korean consecutive insertion ("안"→"안녕"→"안녕하세요")');
{
  let s: InputState = { value: '', cursor: 0 };

  s = typeInput(s, '안');
  assert('after 안: value="안"', s.value === '안', s.value, '안');
  assert('after 안: cursor=1', s.cursor === 1, s.cursor, 1);

  s = typeInput(s, '녕');
  assert('after 녕: value="안녕"', s.value === '안녕', s.value, '안녕');
  assert('after 녕: cursor=2', s.cursor === 2, s.cursor, 2);

  s = typeInput(s, '하');
  s = typeInput(s, '세');
  s = typeInput(s, '요');
  assert('after 하세요: value="안녕하세요"', s.value === '안녕하세요', s.value, '안녕하세요');
  assert('after 하세요: cursor=5', s.cursor === 5, s.cursor, 5);
  assert('cpLen counts 5 code points', cpLen(s.value) === 5, cpLen(s.value), 5);
}

// ── 2. Backspace deletes by code point, not byte ─────────────────────────────
console.log('\n2) Backspace = code-point deletion ("안녕" → "안")');
{
  let s: InputState = { value: '안녕', cursor: 2 };
  // Sanity: "안녕" is 6 UTF-8 bytes but 2 code points
  assert('"안녕" is 6 UTF-8 bytes', Buffer.byteLength('안녕', 'utf8') === 6, Buffer.byteLength('안녕', 'utf8'), 6);
  assert('"안녕" is 2 code points', cpLen('안녕') === 2, cpLen('안녕'), 2);

  s = backspace(s);
  assert('1 backspace → value="안"', s.value === '안', s.value, '안');
  assert('1 backspace → cursor=1', s.cursor === 1, s.cursor, 1);

  s = backspace(s);
  assert('2 backspaces → value=""', s.value === '', s.value, '');
  assert('2 backspaces → cursor=0', s.cursor === 0, s.cursor, 0);

  // Backspace on empty is a no-op
  s = backspace(s);
  assert('backspace at start is no-op (value)', s.value === '', s.value, '');
  assert('backspace at start is no-op (cursor)', s.cursor === 0, s.cursor, 0);
}

// ── 3. Emoji (surrogate pair) insert & delete as one unit ────────────────────
console.log('\n3) Emoji (supplementary plane) insert/delete as 1 unit');
{
  // '😀' = U+1F600, a surrogate pair (UTF-16 length 2) but 1 code point
  assert('"😀" UTF-16 length is 2', '😀'.length === 2, '😀'.length, 2);
  assert('"😀" code-point length is 1', cpLen('😀') === 1, cpLen('😀'), 1);

  let s: InputState = { value: '', cursor: 0 };
  s = typeInput(s, '😀');
  assert('insert 😀: value="😀"', s.value === '😀', s.value, '😀');
  assert('insert 😀: cursor=1 (not 2)', s.cursor === 1, s.cursor, 1);

  s = typeInput(s, '안');
  assert('then 안: value="😀안"', s.value === '😀안', s.value, '😀안');
  assert('then 안: cursor=2', s.cursor === 2, s.cursor, 2);

  s = backspace(s); // delete 안
  assert('backspace → "😀"', s.value === '😀', s.value, '😀');
  s = backspace(s); // delete whole emoji at once
  assert('backspace deletes emoji whole → ""', s.value === '', s.value, '');
  assert('cursor back to 0', s.cursor === 0, s.cursor, 0);
}

// ── 4. Mid-string cursor insertion / deletion ────────────────────────────────
console.log('\n4) Mid-string cursor insert/delete');
{
  // Insert at middle: "안녕", cursor=1 (between 안 and 녕), type "하"
  let s: InputState = { value: '안녕', cursor: 1 };
  s = typeInput(s, '하');
  assert('mid-insert: value="안하녕"', s.value === '안하녕', s.value, '안하녕');
  assert('mid-insert: cursor=2', s.cursor === 2, s.cursor, 2);

  // Backspace at middle removes the char before cursor (하)
  s = backspace(s);
  assert('mid-backspace: value="안녕"', s.value === '안녕', s.value, '안녕');
  assert('mid-backspace: cursor=1', s.cursor === 1, s.cursor, 1);

  // ASCII + Korean interleave
  let t: InputState = { value: '', cursor: 0 };
  t = typeInput(t, 'h');
  t = typeInput(t, '안');
  t = typeInput(t, 'i');
  t = typeInput(t, '녕');
  assert('interleaved: value="h안i녕"', t.value === 'h안i녕', t.value, 'h안i녕');
  assert('interleaved: cpLen=4', cpLen(t.value) === 4, cpLen(t.value), 4);
}

// ── 5. Control bytes (U+0000–U+001F) are ignored ─────────────────────────────
console.log('\n5) Control bytes are ignored');
{
  assert('isPrintableInput("\\r") === false', isPrintableInput('\r') === false, isPrintableInput('\r'), false);
  assert('isPrintableInput("\\t") === false', isPrintableInput('\t') === false, isPrintableInput('\t'), false);
  assert('isPrintableInput("\\x1b") === false', isPrintableInput('\x1b') === false, isPrintableInput('\x1b'), false);
  assert('isPrintableInput("\\x00") === false', isPrintableInput('\x00') === false, isPrintableInput('\x00'), false);
  assert('isPrintableInput("") === false', isPrintableInput('') === false, isPrintableInput(''), false);
  assert('isPrintableInput("a") === true', isPrintableInput('a') === true, isPrintableInput('a'), true);
  assert('isPrintableInput("안") === true', isPrintableInput('안') === true, isPrintableInput('안'), true);
  assert('isPrintableInput(" ") === true (space is printable)', isPrintableInput(' ') === true, isPrintableInput(' '), true);

  // Through the state machine: control bytes leave value unchanged
  let s: InputState = { value: '안녕', cursor: 2 };
  s = typeInput(s, '\r');
  s = typeInput(s, '\x1b');
  s = typeInput(s, '\x00');
  assert('control bytes leave value unchanged', s.value === '안녕', s.value, '안녕');
  assert('control bytes leave cursor unchanged', s.cursor === 2, s.cursor, 2);
}

// ── 6. Slash (/) and @ trigger detection off the value ───────────────────────
console.log('\n6) Slash (/) and @ trigger detection');
{
  // Slash
  assert('"/" → slash active, query ""', detectSlashTrigger('/').active && detectSlashTrigger('/').query === '', detectSlashTrigger('/'), { active: true, query: '' });
  assert('"/cl" → slash active, query "cl"', detectSlashTrigger('/cl').query === 'cl', detectSlashTrigger('/cl').query, 'cl');
  assert('"/clear x" → slash inactive (has space)', detectSlashTrigger('/clear x').active === false, detectSlashTrigger('/clear x').active, false);
  assert('"hello" → slash inactive', detectSlashTrigger('hello').active === false, detectSlashTrigger('hello').active, false);
  assert('"안녕" → slash inactive', detectSlashTrigger('안녕').active === false, detectSlashTrigger('안녕').active, false);

  // @ file picker
  assert('"@" → file active, query ""', detectFileTrigger('@').active && detectFileTrigger('@').query === '', detectFileTrigger('@'), { active: true, query: '' });
  assert('"@src/comp" → file active, query "src/comp"', detectFileTrigger('@src/comp').query === 'src/comp', detectFileTrigger('@src/comp').query, 'src/comp');
  assert('"see @src" → file active, query "src"', detectFileTrigger('see @src').query === 'src', detectFileTrigger('see @src').query, 'src');
  assert('"안녕 @store" → file active, query "store"', detectFileTrigger('안녕 @store').query === 'store', detectFileTrigger('안녕 @store').query, 'store');
  assert('"@file.ts " → file inactive (trailing space)', detectFileTrigger('@file.ts ').active === false, detectFileTrigger('@file.ts ').active, false);
  assert('"no at here" → file inactive', detectFileTrigger('no at here').active === false, detectFileTrigger('no at here').active, false);

  // Slash takes priority: a '/'-prefixed value never triggers the file picker,
  // even if it contains an '@'.
  assert('"/cmd @x" → file inactive (slash prefix wins)', detectFileTrigger('/cmd @x').active === false, detectFileTrigger('/cmd @x').active, false);
  assert('"/@x" → file inactive (slash prefix wins)', detectFileTrigger('/@x').active === false, detectFileTrigger('/@x').active, false);

  // Last '@' wins
  assert('"@a @b" → file query "b" (last @)', detectFileTrigger('@a @b').query === 'b', detectFileTrigger('@a @b').query, 'b');
}

// ── 7. Ctrl+U whole-line clear ───────────────────────────────────────────────
console.log('\n7) Ctrl+U whole-line clear');
{
  let s: InputState = { value: '안녕하세요 world', cursor: 8 };
  s = killLine(s);
  assert('Ctrl+U → value=""', s.value === '', s.value, '');
  assert('Ctrl+U → cursor=0', s.cursor === 0, s.cursor, 0);
}

// ── Bonus: cursor rendering sanity (block cursor placement) ───────────────────
console.log('\n8) Cursor rendering (block cursor placement)');
{
  const rendered = renderWithCursor('안녕', 1); // cursor on 녕
  assert(
    'cursor on 녕 is inverse-highlighted',
    rendered.includes(ANSI_INVERSE_ON + '녕' + ANSI_INVERSE_OFF),
    rendered,
    `...${ANSI_INVERSE_ON}녕${ANSI_INVERSE_OFF}...`,
  );
  assert('안 rendered plain (not inverse)', rendered.includes('안') && !rendered.includes(ANSI_INVERSE_ON + '안'), rendered, '안 plain');

  const trailing = renderWithCursor('안', 1); // cursor at end → block space
  assert(
    'trailing cursor renders inverse space',
    trailing.includes(ANSI_INVERSE_ON + ' ' + ANSI_INVERSE_OFF),
    trailing,
    `${ANSI_INVERSE_ON} ${ANSI_INVERSE_OFF}`,
  );
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n=== Summary ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
if (failed > 0) {
  console.log('  ✗ FAILURES PRESENT');
  process.exit(1);
} else {
  console.log('  ✓ All tests passed');
}
