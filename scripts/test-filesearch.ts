/**
 * Unit verification for src/data/fileSearch.ts
 *
 * Run:  npx tsx scripts/test-filesearch.ts
 *   or: pnpm exec tsx scripts/test-filesearch.ts
 */

// Use relative import (tsx resolves .ts extensions directly)
import { scanFilesSync, filterFiles, MAX_FILES } from '../src/data/fileSearch.js';

const cwd = process.cwd();
console.log(`\n=== fileSearch unit test ===`);
console.log(`Scanning: ${cwd}\n`);

// ── 1. Scan ──────────────────────────────────────────────────────────────────
const { files, truncated } = scanFilesSync(cwd);
console.log(`Total files found : ${files.length}`);
console.log(`Truncated (≥${MAX_FILES}): ${truncated}`);

// Verify IGNORE_DIRS are excluded
const ignored = ['node_modules', '.git', 'dist'];
let allExcluded = true;
for (const dir of ignored) {
  const leaked = files.filter((f) => f.startsWith(dir + '/') || f === dir);
  if (leaked.length > 0) {
    console.error(`  FAIL: found ${leaked.length} paths under ${dir}/`, leaked.slice(0, 3));
    allExcluded = false;
  }
}
if (allExcluded) {
  console.log(`Ignored dirs excluded: OK (${ignored.join(', ')})`);
}

// Verify no hidden files
const hiddenFiles = files.filter((f) => f.split('/').some((seg) => seg.startsWith('.')));
if (hiddenFiles.length > 0) {
  console.error(`  FAIL: found ${hiddenFiles.length} hidden paths`, hiddenFiles.slice(0, 3));
} else {
  console.log(`Hidden files excluded: OK`);
}

console.log(`\nSample files (first 10):`);
files.slice(0, 10).forEach((f) => console.log(`  ${f}`));

// ── 2. Fuzzy filter ──────────────────────────────────────────────────────────
console.log(`\n=== Fuzzy filter tests ===`);

const tests: Array<{ query: string; expectContains: string }> = [
  { query: 'App',    expectContains: 'src/App.tsx' },
  { query: 'store',  expectContains: 'src/store.ts' },
  { query: 'types',  expectContains: 'src/types.ts' },
  { query: 'Input',  expectContains: 'src/components/InputPane.tsx' },
  { query: 'Conv',   expectContains: 'src/components/ConversationPane.tsx' },
  { query: 'fileSearch', expectContains: 'src/data/fileSearch.ts' },
  { query: 'spinner',    expectContains: 'src/hooks/useSpinner.ts' },
];

let passed = 0;
for (const t of tests) {
  const results = filterFiles(files, t.query, 10);
  const ok = results.includes(t.expectContains);
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passed++;
  console.log(`  [${status}] query="${t.query}" → ${ok ? t.expectContains : `not found (got: ${results.slice(0,3).join(', ')})`}`);
}

console.log(`\n${passed}/${tests.length} fuzzy tests passed`);

// ── 3. Edge cases ────────────────────────────────────────────────────────────
console.log(`\n=== Edge cases ===`);

// Empty query → first N files
const emptyResult = filterFiles(files, '', 5);
console.log(`Empty query returns ${emptyResult.length} files (expected ≤5): ${emptyResult.length <= 5 ? 'OK' : 'FAIL'}`);

// No-match query
const noMatch = filterFiles(files, 'xyzzy_does_not_exist_12345', 8);
console.log(`No-match query returns 0 files: ${noMatch.length === 0 ? 'OK' : 'FAIL (got ' + noMatch.length + ')'}`);

console.log(`\n=== Done ===\n`);
