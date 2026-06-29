#!/usr/bin/env tsx
/**
 * Standalone test script for M2-B monitoring features.
 * Run with: pnpm tsx scripts/test-monitoring.ts
 */

import { scanSkills } from '../src/data/skills.js';
import { fetchMcpList } from '../src/data/mcp.js';
import { aggregateUsageHistory } from '../src/data/usageHistory.js';

async function main(): Promise<void> {
  console.log('=== test-monitoring ===\n');

  // 1. Skills
  console.log('--- scanSkills() ---');
  const skills = await scanSkills();
  console.log(`Count: ${skills.length}`);
  console.log('First 5:');
  for (const s of skills.slice(0, 5)) {
    console.log(`  ${s.name}  (${s.dir})`);
  }
  console.log();

  // 2. MCP
  console.log('--- fetchMcpList() ---');
  const mcpList = await fetchMcpList();
  if (mcpList.length === 0) {
    console.log('  (empty — claude mcp list returned nothing or timed out)');
  } else {
    for (const item of mcpList) {
      console.log(`  ${item.name}: ${item.status}`);
    }
  }
  console.log();

  // 3. Usage history
  console.log('--- aggregateUsageHistory() ---');
  const history = await aggregateUsageHistory();
  console.log(`오늘: $${history.todayCostUsd.toFixed(4)}`);
  console.log(`이번달: $${history.monthCostUsd.toFixed(4)}`);
  console.log(`isEstimate: ${String(history.isEstimate)}`);
  console.log('By model:');
  if (history.byModel.length === 0) {
    console.log('  (none found)');
  } else {
    for (const m of history.byModel) {
      console.log(
        `  ${m.model}: input=${m.inputTokens} output=${m.outputTokens} cost=$${m.costUsd.toFixed(4)}`,
      );
    }
  }
  console.log();
  console.log('=== done ===');
}

main().catch((err: unknown) => {
  console.error('Error:', err);
  process.exit(1);
});
