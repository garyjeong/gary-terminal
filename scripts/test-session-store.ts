#!/usr/bin/env node
/**
 * Unit verification for src/data/sessionStore.ts
 * Usage: pnpm tsx scripts/test-session-store.ts
 *
 * Tests:
 *  1. upsert → load round-trip (sessionId key, most-recent-first sort)
 *  2. Update existing entry (upsert by same sessionId)
 *  3. MAX N enforcement (only 50 kept)
 *  4. Graceful handling of corrupted file
 *  5. Confirms ~/.gary-terminal/sessions.json is created on disk
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSessions, upsertSession, shortCwd, relativeTime } from '../src/data/sessionStore.js';
import type { SessionMeta } from '../src/data/sessionStore.js';

const STORE_PATH = path.join(os.homedir(), '.gary-terminal', 'sessions.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function makeMeta(n: number, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: `test-session-${n}`,
    title: `Test Session ${n}`,
    cwd: process.cwd(),
    model: `claude-sonnet-4-test`,
    lastActiveAt: new Date(Date.now() - n * 60_000).toISOString(), // n minutes ago
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Basic round-trip
// ---------------------------------------------------------------------------

console.log('\n[1] Basic upsert → load round-trip');

const meta1 = makeMeta(1);
upsertSession(meta1);
const loaded1 = loadSessions();
const found1 = loaded1.find((s) => s.sessionId === meta1.sessionId);
assert(found1 !== undefined, 'Upserted session found in loadSessions()');
assert(found1?.title === meta1.title, 'Title preserved');
assert(found1?.model === meta1.model, 'Model preserved');
assert(found1?.cwd === meta1.cwd, 'CWD preserved');

// ---------------------------------------------------------------------------
// Test 2: Update existing (same sessionId)
// ---------------------------------------------------------------------------

console.log('\n[2] Update existing session (upsert by same sessionId)');

const updatedMeta1: SessionMeta = {
  ...meta1,
  title: 'Updated Title',
  lastActiveAt: new Date().toISOString(),
};
upsertSession(updatedMeta1);
const loaded2 = loadSessions();
const found2 = loaded2.filter((s) => s.sessionId === meta1.sessionId);
assert(found2.length === 1, 'No duplicate created by update');
assert(found2[0]?.title === 'Updated Title', 'Title updated correctly');

// ---------------------------------------------------------------------------
// Test 3: Most-recent-first ordering
// ---------------------------------------------------------------------------

console.log('\n[3] Most-recent-first ordering');

// Add several sessions with known timestamps
const sessions = [
  makeMeta(100), // 100 minutes ago
  makeMeta(5),   // 5 minutes ago
  makeMeta(50),  // 50 minutes ago
];
for (const s of sessions) upsertSession(s);

const loaded3 = loadSessions();
// Filter to only our test sessions
const testSessions = loaded3.filter((s) => s.sessionId.startsWith('test-session-'));
const isSorted = testSessions.every((s, i) => {
  if (i === 0) return true;
  return s.lastActiveAt <= testSessions[i - 1]!.lastActiveAt;
});
assert(isSorted, 'Sessions sorted most-recent-first');

// ---------------------------------------------------------------------------
// Test 4: MAX 50 enforcement
// ---------------------------------------------------------------------------

console.log('\n[4] MAX 50 sessions enforced');

// Clear existing test entries by starting fresh (add 60 unique sessions)
for (let i = 1000; i < 1060; i++) {
  upsertSession({
    sessionId: `bulk-session-${i}`,
    title: `Bulk ${i}`,
    cwd: process.cwd(),
    model: 'claude-sonnet',
    lastActiveAt: new Date(Date.now() - i * 1000).toISOString(),
  });
}
const loaded4 = loadSessions();
assert(loaded4.length <= 50, `Max 50 kept (got ${loaded4.length})`);

// ---------------------------------------------------------------------------
// Test 5: Corrupted file graceful handling
// ---------------------------------------------------------------------------

console.log('\n[5] Corrupted file → graceful empty fallback');

fs.writeFileSync(STORE_PATH, '{ this is not valid json ~~~', 'utf-8');
const loaded5 = loadSessions();
assert(Array.isArray(loaded5), 'Returns array on corrupt file');
assert(loaded5.length === 0, 'Returns empty array on corrupt file');

// Restore by writing a fresh valid session
upsertSession(makeMeta(999));
const loaded5b = loadSessions();
assert(loaded5b.length > 0, 'Can write new session after corruption recovery');

// ---------------------------------------------------------------------------
// Test 6: File actually on disk
// ---------------------------------------------------------------------------

console.log('\n[6] sessions.json on disk');

assert(fs.existsSync(STORE_PATH), `~/.gary-terminal/sessions.json exists at ${STORE_PATH}`);
const rawSize = fs.statSync(STORE_PATH).size;
assert(rawSize > 2, `File has content (${rawSize} bytes)`);

// ---------------------------------------------------------------------------
// Test 7: Display helpers
// ---------------------------------------------------------------------------

console.log('\n[7] Display helpers');

const homeBased = path.join(os.homedir(), 'Documents/projects/foo');
const short = shortCwd(homeBased);
assert(short.startsWith('~/'), 'shortCwd replaces home with ~');

const isoNow = new Date().toISOString();
const rt = relativeTime(isoNow);
assert(rt.includes('ago'), `relativeTime returns "... ago" for now (got: ${rt})`);

const isoOld = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const rt2 = relativeTime(isoOld);
assert(rt2.includes('h ago') || rt2.includes('d ago'), `relativeTime handles hours (got: ${rt2})`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== sessionStore test results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed.');
}
