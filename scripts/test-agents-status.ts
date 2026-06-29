#!/usr/bin/env node
/**
 * Quick validation of agentsStatus.ts parsing.
 * Usage: pnpm tsx scripts/test-agents-status.ts
 */
import { fetchAgentsStatus } from '../src/data/agentsStatus.js';

async function main(): Promise<void> {
  console.log('[TEST] Fetching claude agents --json...');
  const entries = await fetchAgentsStatus();
  if (entries === null) {
    console.error('[FAIL] fetchAgentsStatus returned null');
    process.exit(1);
  }
  console.log(`[OK] Got ${entries.length} agent entries`);
  for (const e of entries) {
    console.log(`  pid=${e.pid} sessionId=${e.sessionId} status=${e.status} kind=${e.kind}`);
  }
  console.log('[PASS] agentsStatus parsing OK');
}

main().catch((err: unknown) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
