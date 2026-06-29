/**
 * Unit validation script: port→PID mapping + si.processes() CPU/MEM extraction
 * + block sparkline helper output.
 *
 * Run: npx tsx scripts/test-procmon.ts
 *
 * Tests:
 *  1. Block sparkline rendering at various load levels
 *  2. si.processes() — finds a known PID (current process) and reads its cpu/mem
 *  3. Port→PID mapping via lsof (finds a currently listening port if any)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as si from 'systeminformation';

const execFileAsync = promisify(execFile);

// ── 1. Block sparkline helper ──────────────────────────────────────────────

const BLOCK_CHARS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

function renderBlock(history: number[], charCount = 8, maxVal?: number): string {
  const max = maxVal !== undefined ? maxVal : Math.max(1, ...history);
  const needed = charCount;
  const padded: number[] = Array(Math.max(0, needed - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-needed);
  return src
    .map((v) => {
      const level = max <= 0 ? 0 : Math.min(8, Math.round((Math.max(0, v) / max) * 8));
      return BLOCK_CHARS[level]!;
    })
    .join('');
}

console.log('=== Block Sparkline Helper ===');
const rising = [0, 12, 25, 38, 50, 63, 75, 88, 100, 88, 75, 63, 50, 38, 25, 12];
console.log(`rising/falling (fixed 0-100, 8 chars): "${renderBlock(rising, 8, 100)}"`);
const allMax = Array(8).fill(100);
console.log(`all 100% (fixed scale):               "${renderBlock(allMax, 8, 100)}"`);
const allZero = Array(8).fill(0);
console.log(`all 0%   (fixed scale):               "${renderBlock(allZero, 8, 100)}"`);
const halfLoad = [50, 50, 50, 50, 50, 50, 50, 50];
console.log(`constant 50%:                         "${renderBlock(halfLoad, 8, 100)}"`);
const dynamic = [1, 2, 4, 8, 16, 32, 64, 128];
console.log(`dynamic net (auto-scale, 8 chars):    "${renderBlock(dynamic, 8)}"`);
const lowLoad = [1, 2, 3, 4, 5, 6, 7, 8];
console.log(`low load 1-8% (fixed 0-100):          "${renderBlock(lowLoad, 8, 100)}"  (should still show ▁ chars)`);

// ── 2. Port→PID mapping ─────────────────────────────────────────────────────

async function portToPid(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      `-i:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    const pid = parseInt(stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

// ── 3. si.processes() extraction ────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== si.processes() — current process stats ===');
  const selfPid = process.pid;
  console.log(`Self PID: ${selfPid}`);

  const procsData = await si.processes();
  const self = procsData.list.find((p) => p.pid === selfPid);
  if (self) {
    console.log(`  name:    ${self.name}`);
    console.log(`  cpu:     ${self.cpu.toFixed(2)}%`);
    console.log(`  mem:     ${self.mem.toFixed(2)}%`);
    console.log(`  memRss:  ${((self.memRss ?? 0) / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  command: ${(self.command ?? '').slice(0, 80)}`);
  } else {
    console.log(`  [NOT FOUND in si.processes() list — normal for tsx scripts]`);
  }

  // Top 5 by CPU
  console.log('\nTop 5 by CPU:');
  const top5 = procsData.list.sort((a, b) => b.cpu - a.cpu).slice(0, 5);
  for (const p of top5) {
    const rss = ((p.memRss ?? 0) / (1024 * 1024)).toFixed(0);
    console.log(`  pid:${String(p.pid).padStart(6)}  cpu:${p.cpu.toFixed(1).padStart(5)}%  mem:${p.mem.toFixed(1).padStart(5)}%  rss:${rss.padStart(6)}MB  ${p.name}`);
  }

  // ── Port→PID test using currently listening ports ─────────────────────────
  console.log('\n=== Port→PID mapping via lsof ===');
  let testedPort: number | null = null;

  try {
    // Get a port that is actually listening right now
    const netConns = await si.networkConnections();
    const listening = netConns.filter(
      (c) => c.state === 'LISTEN' && c.localPort && parseInt(c.localPort, 10) > 1024,
    );
    if (listening.length > 0) {
      const first = listening[0]!;
      testedPort = parseInt(first.localPort, 10);
      console.log(`Testing port ${testedPort} (from si.networkConnections — localAddress: ${first.localAddress})`);
      const resolvedPid = await portToPid(testedPort);
      if (resolvedPid !== null) {
        console.log(`  lsof resolved port ${testedPort} → PID ${resolvedPid}`);
        // Find the process
        const proc = procsData.list.find((p) => p.pid === resolvedPid);
        if (proc) {
          console.log(`  Process: ${proc.name} (cpu: ${proc.cpu.toFixed(1)}%, mem: ${proc.mem.toFixed(1)}%)`);
        } else {
          console.log(`  Process PID ${resolvedPid} not in si.processes() list (may be a kernel process)`);
        }
      } else {
        console.log(`  lsof returned null for port ${testedPort} (may need elevated perms or port closed already)`);
      }
    } else {
      console.log('  No user-space LISTEN ports found via si.networkConnections()');
    }
  } catch (err) {
    console.log(`  si.networkConnections() error: ${err}`);
  }

  // Test a well-known port that is unlikely to be in use
  const unusedPort = 19999;
  const nullResult = await portToPid(unusedPort);
  console.log(`  Port ${unusedPort} (likely unused): ${nullResult === null ? 'null (correct)' : `PID ${nullResult} (port is in use!)`}`);

  console.log('\n=== All tests complete ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
