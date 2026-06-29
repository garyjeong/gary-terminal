/**
 * scripts/test-keymap.ts
 *
 * Lightweight sanity check for the mode-stack key routing structure.
 * Verifies that KEYMAP_CONTEXTS contains all expected actions per mode/context.
 *
 * Run: npx tsx scripts/test-keymap.ts
 */

import { KEYMAP_CONTEXTS, type KeyContext } from '../src/keymap.js';

// ── Routing rules table ───────────────────────────────────────────────────────
// Each check states: "when modeStack top is X, context Y must contain action Z"

interface RouteCheck {
  label: string;
  context: KeyContext;
  expectedActions: string[];
  description: string;
}

const checks: RouteCheck[] = [
  {
    label: 'overlay-slash',
    context: 'overlay-slash',
    expectedActions: ['navigate', 'select', 'close'],
    description: 'top==="slash" → InputPane owns popup keys (nav/select/close)',
  },
  {
    label: 'overlay-resume',
    context: 'overlay-resume',
    expectedActions: ['navigate', 'resume', 'close'],
    description: 'top==="resume" → App.tsx routes ↑↓/Enter/Esc to dialog',
  },
  {
    label: 'overlay-cheatsheet',
    context: 'overlay-cheatsheet',
    expectedActions: ['close'],
    description: 'top==="cheatsheet" → ?/Esc close, all others swallowed',
  },
  {
    label: 'global (base)',
    context: 'global',
    expectedActions: ['quit', 'newSession', 'closeSession', 'refresh', 'openResume', 'cheatsheet'],
    description: 'base mode → global shortcuts active (q/Ctrl+C/N/W/R/O/?)',
  },
  {
    label: 'select',
    context: 'select',
    expectedActions: ['movePanel', 'enterPanel'],
    description: 'focusMode==="select" → ↑↓←→ move panels, Enter enter active',
  },
  {
    label: 'active-input',
    context: 'active-input',
    expectedActions: ['send', 'slash', 'exitPanel', 'movePanelFromInput'],
    description: 'active+input → Enter send, / slash popup, Esc exit, ↑↓ move panel',
  },
  {
    label: 'active-agents',
    context: 'active-agents',
    expectedActions: ['switchAgent', 'exitPanel'],
    description: 'active+agents → ↑↓ switch agent, Esc exit',
  },
  {
    label: 'active-reference',
    context: 'active-reference',
    expectedActions: ['moveSection', 'toggleSection', 'exitPanel'],
    description: 'active+reference → ↑↓ move, Space toggle, Esc exit',
  },
  {
    label: 'active-conversation',
    context: 'active-conversation',
    expectedActions: ['scroll', 'scrollUp', 'scrollDown', 'exitPanel'],
    description: 'active+conversation → ↑↓ scroll, PgUp/Dn, Esc exit',
  },
];

// ── Run checks ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

console.log('── Mode-stack key routing checks ─────────────────────────────────\n');

for (const check of checks) {
  const context = KEYMAP_CONTEXTS[check.context];
  const contextActions = context.map((e) => e.action);
  let checkPassed = true;

  for (const expected of check.expectedActions) {
    if (!contextActions.includes(expected)) {
      console.error(`FAIL [${check.label}] action "${expected}" missing in context "${check.context}"`);
      console.error(`     Available: ${contextActions.join(', ')}`);
      checkPassed = false;
      failed++;
    }
  }

  if (checkPassed) {
    console.log(`OK   [${check.label}]  ${check.description}`);
    passed++;
  }
}

// ── Print routing rules table ─────────────────────────────────────────────────

console.log('\n── Routing rules (modeStack top → handler) ────────────────────────');
const routingTable = [
  { top: '"slash"',      handler: 'InputPane.useInput (isActive: isFocused)', note: 'App.tsx yields entirely' },
  { top: '"resume"',     handler: 'App.tsx useInput',                          note: '↑↓/Enter/Esc; swallows others' },
  { top: '"cheatsheet"', handler: 'App.tsx useInput',                          note: '?/Esc close; swallows others' },
  { top: '"base"',       handler: 'App.tsx useInput (global + focusMode)',      note: 'normal panel routing' },
];
for (const row of routingTable) {
  console.log(`  top=${row.top.padEnd(14)} → ${row.handler.padEnd(44)} (${row.note})`);
}

// ── Print push/pop connection points ─────────────────────────────────────────

console.log('\n── modeStack push/pop connection points ────────────────────────────');
const connections = [
  { mode: 'slash',      push: 'store.openSlashAutocomplete()',  pop: 'store.closeSlashAutocomplete()' },
  { mode: 'resume',     push: 'store.openResumeDialog()',       pop: 'store.closeResumeDialog()' },
  { mode: 'cheatsheet', push: 'store.toggleCheatSheet() [open]', pop: 'store.toggleCheatSheet() [close]' },
];
for (const c of connections) {
  console.log(`  "${c.mode.padEnd(11)}"  push: ${c.push.padEnd(38)}  pop: ${c.pop}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n── Result ──────────────────────────────────────────────────────────`);
if (failed === 0) {
  console.log(`✓ All ${passed} checks passed`);
} else {
  console.error(`✗ ${failed} check(s) FAILED, ${passed} passed`);
  process.exit(1);
}
