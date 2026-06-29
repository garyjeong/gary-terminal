/**
 * Validation script: test networkStats/fsSize real values + braille helper.
 * Run: npx tsx scripts/test-sysstats.ts
 */
import * as si from 'systeminformation';

// ── Inline braille helper (same logic as SystemPane) ────────────────────────
const BRAILLE_LEFT = [0x00, 0x40, 0x44, 0x46, 0x47] as const;
const BRAILLE_RIGHT = [0x00, 0x80, 0xa0, 0xb0, 0xb8] as const;

function toLevel(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(4, Math.round((Math.max(0, value) / max) * 4));
}

function renderBraille(history: number[], charCount = 8, maxVal?: number): string {
  const max = maxVal !== undefined ? maxVal : Math.max(1, ...history);
  const needed = charCount * 2;
  const padded: number[] = Array(Math.max(0, needed - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-needed);
  let result = '';
  for (let i = 0; i < charCount; i++) {
    const ll = toLevel(src[i * 2] ?? 0, max);
    const rl = toLevel(src[i * 2 + 1] ?? 0, max);
    result += String.fromCharCode(0x2800 + BRAILLE_LEFT[ll]! + BRAILLE_RIGHT[rl]!);
  }
  return result;
}

// ── Test braille graph ───────────────────────────────────────────────────────
console.log('=== Braille graph helper ===');
const rising = [0, 6, 12, 25, 38, 50, 63, 75, 88, 100, 88, 75, 63, 50, 38, 25];
console.log(`rising/falling (0→100→25, fixed 0-100): ${renderBraille(rising, 8, 100)}`);
const allMax = Array(16).fill(100);
console.log(`all 100%:                                ${renderBraille(allMax, 8, 100)}`);
const allZero = Array(16).fill(0);
console.log(`all 0%:                                  ${renderBraille(allZero, 8, 100)}`);
const dynamic = [1, 2, 4, 8, 16, 32, 64, 128, 64, 32, 16, 8, 4, 2, 1, 0];
console.log(`dynamic net traffic (auto-scale):        ${renderBraille(dynamic, 8)}`);

// ── Live system data ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n=== Live System Data ===');

  const [load, mem, nets, fsSizes] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats(),
    si.fsSize(),
  ]);

  console.log(`\n--- CPU/MEM ---`);
  console.log(`CPU load: ${Math.round(load.currentLoad)}%`);
  console.log(`MEM used: ${Math.round((mem.used / mem.total) * 100)}% (${(mem.used / 1e9).toFixed(1)}GB / ${(mem.total / 1e9).toFixed(1)}GB)`);

  console.log(`\n--- Network Stats (${nets.length} interfaces) ---`);
  for (const n of nets.slice(0, 5)) {
    const rxKBs = (n.rx_sec ?? 0) / 1024;
    const txKBs = (n.tx_sec ?? 0) / 1024;
    console.log(`  ${n.iface}: ↓${rxKBs.toFixed(1)}KB/s ↑${txKBs.toFixed(1)}KB/s`);
  }
  const totalRx = nets.reduce((s, n) => s + Math.max(0, n.rx_sec ?? 0), 0) / 1024;
  const totalTx = nets.reduce((s, n) => s + Math.max(0, n.tx_sec ?? 0), 0) / 1024;
  console.log(`  TOTAL: ↓${totalRx.toFixed(1)}KB/s ↑${totalTx.toFixed(1)}KB/s`);

  console.log(`\n--- Disk (fsSize, ${fsSizes.length} entries) ---`);
  for (const f of fsSizes.slice(0, 5)) {
    if (f.size === 0) continue;
    const pct = Math.round((f.used / f.size) * 100);
    console.log(`  ${f.mount}: ${pct}% (${(f.used / 1e9).toFixed(1)}GB / ${(f.size / 1e9).toFixed(1)}GB)`);
  }
  const rootFs = fsSizes.find((f) => f.mount === '/');
  if (rootFs && rootFs.size > 0) {
    const pct = Math.round((rootFs.used / rootFs.size) * 100);
    console.log(`  /root disk: ${pct}%`);
    console.log(`  bar: [${renderBraille([pct], 8, 100)}]`);
  }
}

main().catch(console.error);
