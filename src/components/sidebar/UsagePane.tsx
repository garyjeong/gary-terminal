import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';
import { formatResetTime, utilizationColor, utilizationBar } from '../../data/claudeUsage.js';
import { fmtTokens } from '../../data/codexUsage.js';

function fmtTokensLocal(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
// fmtTokensLocal used for usageHistory display

export function UsagePane(): React.ReactElement {
  const { tokens, todo } = useStore((state) => state.usage);
  // Usage panel is display-only — never focused or highlighted
  const isFocused = false;

  const claudeUsage = useStore((state) => state.claudeUsage);
  const claudeUsageLoading = useStore((state) => state.claudeUsageLoading);
  const codexUsage = useStore((state) => state.codexUsage);
  const codexUsageLoading = useStore((state) => state.codexUsageLoading);
  const usageHistory = useStore((state) => state.usageHistory);

  const doneMark = todo.done > 0 ? '✓'.repeat(Math.min(todo.done, 5)) : '';
  const pendingItems = todo.items.slice(0, 3).map((item) => `▸${item}`).join(' ');

  return (
    <Box
      borderStyle="single"
      borderColor={isFocused ? 'cyan' : 'gray'}
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color={isFocused ? 'cyan' : 'white'}>
        사용량·작업
      </Text>

      {/* ── Claude 섹션 ─────────────────────────────────────────────────── */}
      <Box flexDirection="column">
        <Text bold color="cyan">─ Claude</Text>

        {/* 라이브 세션 토큰 (per-agent 누적) */}
        <Box flexDirection="row">
          <Text color="gray">  세션 </Text>
          <Text color="yellow">{tokens}</Text>
          <Text color="gray"> tok</Text>
        </Box>

        {/* JSONL 히스토리 (오늘/달) */}
        {usageHistory !== null && (
          <Box flexDirection="row">
            <Text color="gray">  오늘 </Text>
            <Text color="yellow">{fmtTokensLocal(usageHistory.todayTokens)}</Text>
            <Text color="gray"> · 달 </Text>
            <Text color="yellow">{fmtTokensLocal(usageHistory.monthTokens)}</Text>
            <Text color="gray"> tok</Text>
          </Box>
        )}

        {/* Rate-limit 창 — OAuth API */}
        {claudeUsageLoading && claudeUsage === null && (
          <Text color="gray" dimColor>  rate-limit 조회중…</Text>
        )}
        {claudeUsage !== null && (() => {
          const { fiveHour, sevenDay, sevenDaySonnet, subscriptionType } = claudeUsage;
          const fhColor = utilizationColor(fiveHour.utilization);
          const fhBar = utilizationBar(fiveHour.utilization, 8);
          const fhReset = formatResetTime(fiveHour.resetsAt);
          return (
            <Box flexDirection="column">
              {/* 5시간 창 */}
              <Box flexDirection="row">
                <Text color="gray">  5h </Text>
                <Text color={fhColor}>{fhBar}</Text>
                <Text color={fhColor}> {fiveHour.utilization}%</Text>
                {fhReset ? <Text color="gray"> ↺{fhReset}</Text> : null}
              </Box>
              {/* 7일 창 (max 플랜만) */}
              {sevenDay !== undefined && (() => {
                const wColor = utilizationColor(sevenDay.utilization);
                const wBar = utilizationBar(sevenDay.utilization, 8);
                const wReset = formatResetTime(sevenDay.resetsAt);
                return (
                  <Box flexDirection="row">
                    <Text color="gray">  7d </Text>
                    <Text color={wColor}>{wBar}</Text>
                    <Text color={wColor}> {sevenDay.utilization}%</Text>
                    {wReset ? <Text color="gray"> ↺{wReset}</Text> : null}
                  </Box>
                );
              })()}
              {/* Sonnet 7일 (있을 때만) */}
              {sevenDaySonnet !== undefined && sevenDaySonnet.utilization > 0 && (() => {
                const sColor = utilizationColor(sevenDaySonnet.utilization);
                return (
                  <Box flexDirection="row">
                    <Text color="gray">  7d-snnt </Text>
                    <Text color={sColor}>{sevenDaySonnet.utilization}%</Text>
                  </Box>
                );
              })()}
              {/* 플랜 표시 */}
              <Text color="gray" dimColor>  플랜: {subscriptionType}</Text>
            </Box>
          );
        })()}
      </Box>

      {/* ── Codex 섹션 ──────────────────────────────────────────────────── */}
      {(codexUsage !== null || codexUsageLoading) && (
        <Box flexDirection="column">
          <Text bold color="magenta">─ Codex</Text>
          {codexUsageLoading && codexUsage === null && (
            <Text color="gray" dimColor>  조회중…</Text>
          )}
          {codexUsage !== null && (
            <Box flexDirection="column">
              <Box flexDirection="row">
                <Text color="gray">  총 </Text>
                <Text color="magenta">{fmtTokens(codexUsage.totalTokens)}</Text>
                <Text color="gray"> · 오늘 </Text>
                <Text color="magenta">{fmtTokens(codexUsage.todayTokens)}</Text>
                <Text color="gray"> tok</Text>
              </Box>
              <Box flexDirection="row">
                <Text color="gray">  세션 {codexUsage.sessionCount}개 · </Text>
                <Text color="gray">{codexUsage.recentModel}</Text>
              </Box>
              <Text color="gray" dimColor>  구독(plus) — 별도청구</Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── Todo 섹션 ───────────────────────────────────────────────────── */}
      {(todo.total > 0 || todo.items.length > 0) && (
        <Box flexDirection="column">
          <Text bold color="gray">─ 작업</Text>
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="gray">  {todo.done}/{todo.total} </Text>
            <Text color="green">{doneMark} </Text>
            <Text color="cyan">{pendingItems}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
