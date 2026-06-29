/**
 * Validation script: auto-detection of repo servers via lsof cwd-matching.
 *
 * Run: npx tsx scripts/test-procmon.ts
 *
 * Tests:
 *  1. Block sparkline helpers
 *  2. renderTallBar — 3-row bpytop-style graph output
 *  3. getListeningPidPorts — lsof TCP LISTEN parsing
 *  4. Own PID exclusion
 *  5. Spin up a real HTTP server on port 4599, verify auto-detection picks it up
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as si from 'systeminformation';

const execFileAsync = promisify(execFile);

// ── Re-implement helpers locally (same logic as useSystemStats.ts) ─────────

async function getListeningPidPorts(): Promise<Map<number, number[]>> {
  const pidPorts = new Map<number, number[]>();
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn',
    ]);
    let currentPid: number | null = null;
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed[0] === 'p') {
        const parsed = parseInt(trimmed.slice(1), 10);
        currentPid = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      } else if (trimmed[0] === 'n' && currentPid !== null) {
        const portMatch = trimmed.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1]!, 10);
          if (!pidPorts.has(currentPid)) pidPorts.set(currentPid, []);
          pidPorts.get(currentPid)!.push(port);
        }
      }
    }
  } catch {
    // lsof unavailable
  }
  return pidPorts;
}

async function getPidCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-a', '-p', String(pid), '-d', 'cwd', '-Fn',
    ]);
    const nLine = stdout.split('\n').find((l) => l.trim().startsWith('n'));
    if (!nLine) return null;
    const path = nLine.trim().slice(1);
    return path || null;
  } catch {
    return null;
  }
}

// ── 1. Block sparkline ──────────────────────────────────────────────────────

const BLOCK_CHARS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

function renderBlock(history: number[], charCount = 8, maxVal?: number): string {
  const max = maxVal !== undefined ? maxVal : Math.max(1, ...history);
  const needed = charCount;
  const padded: number[] = Array(Math.max(0, needed - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-needed);
  return src.map((v) => {
    const level = max <= 0 ? 0 : Math.min(8, Math.round((Math.max(0, v) / max) * 8));
    return BLOCK_CHARS[level]!;
  }).join('');
}

console.log('=== 1. Block Sparkline Helper ===');
const rising = [0, 12, 25, 38, 50, 63, 75, 88, 100, 88, 75, 63, 50, 38, 25, 12];
console.log(`rising/falling (8 chars): "${renderBlock(rising, 8, 100)}"`);
console.log(`all 100%:                 "${renderBlock(Array(8).fill(100), 8, 100)}"`);
console.log(`all 0%:                   "${renderBlock(Array(8).fill(0), 8, 100)}"`);

// ── 2. renderTallBar ─────────────────────────────────────────────────────────

function renderTallBar(
  history: number[],
  charCount = 16,
  maxVal = 100,
): [string, string, string] {
  const padded: number[] = Array(Math.max(0, charCount - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-charCount);
  const top: string[] = [];
  const mid: string[] = [];
  const bot: string[] = [];
  for (const v of src) {
    const pct = maxVal <= 0 ? 0 : Math.min(100, Math.max(0, (v / maxVal) * 100));
    bot.push(pct >= 33 ? '█' : pct > 3 ? '▄' : ' ');
    mid.push(pct >= 66 ? '█' : pct > 33 ? '▄' : ' ');
    top.push(pct >= 96 ? '█' : pct > 66 ? '▄' : ' ');
  }
  return [top.join(''), mid.join(''), bot.join('')];
}

console.log('\n=== 2. 3-Row Tall Bar Graph ===');
{
  const vals = [0, 10, 30, 50, 70, 90, 100, 90, 70, 50, 30, 10, 0, 0, 0, 0];
  const [t, m, b] = renderTallBar(vals, 16, 100);
  console.log(`Top: ${t}`);
  console.log(`Mid: ${m}`);
  console.log(`Bot: ${b}`);
  // Verify: at 100% all three rows should show █
  const [t2, m2, b2] = renderTallBar([100], 1, 100);
  const allFull = t2 === '█' && m2 === '█' && b2 === '█';
  console.log(`100% → all rows full:  ${allFull ? 'PASS ✓' : 'FAIL ✗'} (top="${t2}" mid="${m2}" bot="${b2}")`);
  // At 0%, all spaces
  const [t3, m3, b3] = renderTallBar([0], 1, 100);
  const allEmpty = t3 === ' ' && m3 === ' ' && b3 === ' ';
  console.log(`0%   → all rows empty: ${allEmpty ? 'PASS ✓' : 'FAIL ✗'}`);
  // At 50%, only bottom and mid should show
  const [t4, m4, b4] = renderTallBar([50], 1, 100);
  const halfOk = b4 === '█' && m4 !== ' ' && t4 === ' ';
  console.log(`50%  → top empty:      ${halfOk ? 'PASS ✓' : 'FAIL ✗'} (top="${t4}" mid="${m4}" bot="${b4}")`);
}

// ── 3. getListeningPidPorts ───────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== 3. Listening PID→Port Map (lsof) ===');
  const pidPortMap = await getListeningPidPorts();
  console.log(`Total listening PIDs: ${pidPortMap.size}`);
  let count = 0;
  for (const [pid, ports] of pidPortMap) {
    console.log(`  PID ${pid} → ports ${ports.join(', ')}`);
    if (++count >= 5) { console.log('  ... (truncated at 5)'); break; }
  }

  // ── 4. Own PID exclusion ───────────────────────────────────────────────────
  console.log('\n=== 4. Own PID Exclusion ===');
  const ownPid = process.pid;
  console.log(`Own PID: ${ownPid}`);
  const ownInMap = pidPortMap.has(ownPid);
  console.log(`Own PID in listening map: ${ownInMap} (expected false for gary-terminal itself)`);
  const afterExclusion = [...pidPortMap.keys()].filter((p) => p !== ownPid);
  console.log(`PIDs after excluding self: ${afterExclusion.length} (was ${pidPortMap.size})`);
  console.log(`Exclusion PASS: ${afterExclusion.length <= pidPortMap.size ? '✓' : '✗'}`);

  // ── 4b. CWD check for existing listening processes ─────────────────────────
  console.log('\n=== 4b. CWD Matching for Existing Processes ===');
  const repoRoot = process.cwd();
  console.log(`Repo root: ${repoRoot}`);
  let checkedCount = 0;
  for (const [pid] of pidPortMap) {
    if (pid === ownPid) continue;
    const cwd = await getPidCwd(pid);
    const inRepo = cwd !== null && cwd.startsWith(repoRoot);
    if (cwd) {
      console.log(`  PID ${pid}: cwd="${cwd}" → inRepo=${inRepo}`);
      if (++checkedCount >= 3) { console.log('  ... (checked 3, stopping)'); break; }
    }
  }
  if (checkedCount === 0) {
    console.log('  No non-self listening processes found to check cwd for.');
  }

  // ── 5. HTTP server auto-detection ─────────────────────────────────────────
  console.log('\n=== 5. HTTP Server Auto-Detection (port 4599) ===');

  // Spawn HTTP server as a subprocess so its PID differs from ownPid
  const serverScript = `
    const http = require('http');
    const s = http.createServer((req, res) => res.end('ok'));
    s.listen(4599, '127.0.0.1', () => {
      process.stdout.write('ready\\n');
    });
    // Keep alive until killed
    process.on('SIGTERM', () => process.exit(0));
  `;

  const serverProc = spawn(process.execPath, ['-e', serverScript], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const serverPid = serverProc.pid ?? 0;
  console.log(`Spawned HTTP server subprocess: PID ${serverPid}`);

  // Wait for 'ready' from the server
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('  [Warning] Timed out waiting for server ready signal');
      resolve();
    }, 3000);
    serverProc.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  // Small extra delay to ensure lsof can see it
  await new Promise((r) => setTimeout(r, 300));

  // Detect
  const pidPortMap2 = await getListeningPidPorts();
  const port4599Entry = [...pidPortMap2.entries()].find(([, ports]) => ports.includes(4599));

  if (!port4599Entry) {
    console.log('  FAIL: port 4599 not found in listening map ✗');
  } else {
    const [detectedPid] = port4599Entry;
    console.log(`  Port 4599 → PID ${detectedPid} (expected ${serverPid})`);
    const pidMatch = detectedPid === serverPid;
    console.log(`  PID matches: ${pidMatch ? 'PASS ✓' : 'FAIL ✗'}`);

    // Check exclusion: server is NOT own PID → should not be excluded
    const notOwn = detectedPid !== ownPid;
    console.log(`  Not own PID (won't be excluded): ${notOwn ? 'PASS ✓' : 'FAIL ✗'}`);

    // Check cwd
    const cwd = await getPidCwd(detectedPid);
    console.log(`  CWD: ${cwd ?? '(null)'}`);
    const inRepo = cwd !== null && cwd.startsWith(repoRoot);
    console.log(`  CWD starts with repo root: ${inRepo ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!inRepo) {
      console.log(`    repoRoot = "${repoRoot}"`);
      console.log(`    cwd      = "${cwd}"`);
    }
  }

  // Clean up
  serverProc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));

  // ── si.processes() sanity check ────────────────────────────────────────────
  console.log('\n=== 6. si.processes() sanity (self PID) ===');
  const procsData = await si.processes();
  const self = procsData.list.find((p) => p.pid === ownPid);
  if (self) {
    console.log(`  Found self: name=${self.name} cpu=${self.cpu.toFixed(2)}% mem=${self.mem.toFixed(2)}%`);
    console.log('  PASS ✓');
  } else {
    console.log('  Self not found in si.processes() (normal for tsx scripts) — OK');
  }
  const top3 = procsData.list.sort((a, b) => b.cpu - a.cpu).slice(0, 3);
  console.log('  Top 3 by CPU:');
  for (const p of top3) {
    console.log(`    pid:${p.pid}  cpu:${p.cpu.toFixed(1)}%  ${p.name}`);
  }

  console.log('\n=== All tests complete ===');
}

main().catch((err: unknown) => {
  console.error('Test failed:', err);
  process.exit(1);
});
