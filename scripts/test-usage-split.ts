/**
 * scripts/test-usage-split.ts
 *
 * Standalone verification of claudeUsage + codexUsage data sources.
 * Run: pnpm tsx scripts/test-usage-split.ts
 */

import { fetchClaudeUsage, formatResetTime, utilizationColor, utilizationBar } from '../src/data/claudeUsage.js';
import { fetchCodexUsage, fmtTokens } from '../src/data/codexUsage.js';

// ---------------------------------------------------------------------------
// Claude Usage (OAuth API)
// ---------------------------------------------------------------------------

console.log('\n══════════════════════════════════════');
console.log('  Claude Rate-Limit Usage (OAuth API)');
console.log('══════════════════════════════════════');

try {
  const claude = await fetchClaudeUsage();
  if (!claude) {
    console.log('  ⚠  토큰 조달 실패 (Keychain 접근 실패 또는 .credentials.json 없음)');
    console.log('     → Keychain 접근 권한 프롬프트가 떴는지 확인하세요.');
  } else {
    console.log(`  플랜:           ${claude.subscriptionType}`);
    console.log(`  5시간 창:`);
    console.log(`    이용률:       ${claude.fiveHour.utilization}%`);
    console.log(`    바:           ${utilizationBar(claude.fiveHour.utilization, 12)}`);
    console.log(`    색상 힌트:    ${utilizationColor(claude.fiveHour.utilization)}`);
    console.log(`    리셋까지:     ${formatResetTime(claude.fiveHour.resetsAt)}`);
    console.log(`    resets_at:    ${claude.fiveHour.resetsAt}`);

    if (claude.sevenDay) {
      console.log(`  7일 창:`);
      console.log(`    이용률:       ${claude.sevenDay.utilization}%`);
      console.log(`    바:           ${utilizationBar(claude.sevenDay.utilization, 12)}`);
      console.log(`    리셋까지:     ${formatResetTime(claude.sevenDay.resetsAt)}`);
      console.log(`    resets_at:    ${claude.sevenDay.resetsAt}`);
    } else {
      console.log('  7일 창:         없음 (pro 플랜 또는 API 미제공)');
    }

    if (claude.sevenDaySonnet) {
      console.log(`  7일 Sonnet 창:`);
      console.log(`    이용률:       ${claude.sevenDaySonnet.utilization}%`);
      console.log(`    resets_at:    ${claude.sevenDaySonnet.resetsAt}`);
    }

    console.log(`  fetchedAt:      ${new Date(claude.fetchedAt).toISOString()}`);
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ✗  오류: ${msg}`);
}

// ---------------------------------------------------------------------------
// Codex Usage (SQLite)
// ---------------------------------------------------------------------------

console.log('\n══════════════════════════════════════');
console.log('  Codex Usage (state_5.sqlite)        ');
console.log('══════════════════════════════════════');

try {
  const codex = await fetchCodexUsage();
  if (!codex) {
    console.log('  ⚠  ~/.codex 디렉터리가 없거나 DB 읽기 실패.');
  } else {
    console.log(`  전체 세션 수:   ${codex.sessionCount}`);
    console.log(`  총 토큰:        ${fmtTokens(codex.totalTokens)} (${codex.totalTokens.toLocaleString()})`);
    console.log(`  오늘 토큰:      ${fmtTokens(codex.todayTokens)} (${codex.todayTokens.toLocaleString()})`);
    console.log(`  최근 모델:      ${codex.recentModel}`);
    console.log(`  fetchedAt:      ${new Date(codex.fetchedAt).toISOString()}`);
  }
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ✗  오류: ${msg}`);
}

console.log('\n══════════════════════════════════════');
console.log('  검증 완료');
console.log('══════════════════════════════════════\n');
