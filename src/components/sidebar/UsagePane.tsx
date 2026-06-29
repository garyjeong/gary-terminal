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

/** Fixed-width label (8 chars) for consistent column alignment. */
function Label({ children }: { children: string }): React.ReactElement {
  return <Text color="gray">{children.padEnd(8)}</Text>;
}

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
      borderColor="yellow"
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color="yellow">사용량</Text>

      {/* ── Claude 섹션 ─────────────────────────────────────────────────── */}
      <Text bold color="cyan">─ Claude</Text>

      {/* 라이브 세션 토큰 */}
      <Box flexDirection="row">
        <Label>세션</Label>
        <Text color="yellow">{tokens}</Text>
        <Text color="gray"> tok</Text>
      </Box>

      {/* JSONL 히스토리 */}
      {usageHistory !== null && (
        <Box flexDirection="row">
          <Label>오늘</Label>
          <Text color="yellow">{fmtTokensLocal(usageHistory.todayTokens)}</Text>
          <Text color="gray">/</Text>
          <Text color="yellow">{fmtTokensLocal(usageHistory.monthTokens)}</Text>
          <Text color="gray"> tok</Text>
        </Box>
      )}

      {/* Rate-limit 창 — OAuth API */}
      {claudeUsageLoading && claudeUsage === null && (
        <Text color="gray" dimColor>조회중…</Text>
      )}
      {claudeUsage !== null && (() => {
        const { fiveHour, sevenDay, sevenDaySonnet, subscriptionType } = claudeUsage;
        const fhColor = utilizationColor(fiveHour.utilization);
        const fhBar = utilizationBar(fiveHour.utilization, 6);
        const fhReset = formatResetTime(fiveHour.resetsAt);
        return (
          <>
            {/* 5시간 창 */}
            <Box flexDirection="row">
              <Label>5h</Label>
              <Text color={fhColor}>{fhBar}</Text>
              <Text color={fhColor}> {String(fiveHour.utilization).padStart(3)}%</Text>
              {fhReset ? <Text color="gray"> ↺{fhReset}</Text> : null}
            </Box>
            {/* 7일 창 */}
            {sevenDay !== undefined && (() => {
              const wColor = utilizationColor(sevenDay.utilization);
              const wBar = utilizationBar(sevenDay.utilization, 6);
              const wReset = formatResetTime(sevenDay.resetsAt);
              return (
                <Box flexDirection="row">
                  <Label>7d</Label>
                  <Text color={wColor}>{wBar}</Text>
                  <Text color={wColor}> {String(sevenDay.utilization).padStart(3)}%</Text>
                  {wReset ? <Text color="gray"> ↺{wReset}</Text> : null}
                </Box>
              );
            })()}
            {/* Sonnet 7일 */}
            {sevenDaySonnet !== undefined && sevenDaySonnet.utilization > 0 && (
              <Box flexDirection="row">
                <Label>7d-snnt</Label>
                <Text color={utilizationColor(sevenDaySonnet.utilization)}>
                  {String(sevenDaySonnet.utilization).padStart(3)}%
                </Text>
              </Box>
            )}
            <Text color="gray" dimColor>플랜: {subscriptionType}</Text>
          </>
        );
      })()}

      {/* ── Codex 섹션 ──────────────────────────────────────────────────── */}
      {(codexUsage !== null || codexUsageLoading) && (
        <>
          <Text bold color="magenta">─ Codex</Text>
          {codexUsageLoading && codexUsage === null && (
            <Text color="gray" dimColor>조회중…</Text>
          )}
          {codexUsage !== null && (
            <>
              <Box flexDirection="row">
                <Label>총</Label>
                <Text color="magenta">{fmtTokens(codexUsage.totalTokens)}</Text>
                <Text color="gray"> tok</Text>
              </Box>
              <Box flexDirection="row">
                <Label>오늘</Label>
                <Text color="magenta">{fmtTokens(codexUsage.todayTokens)}</Text>
                <Text color="gray"> tok</Text>
              </Box>
              <Box flexDirection="row">
                <Label>세션</Label>
                <Text color="gray">{codexUsage.sessionCount}개</Text>
                <Text color="gray"> {codexUsage.recentModel}</Text>
              </Box>
            </>
          )}
        </>
      )}

      {/* ── Todo 섹션 ───────────────────────────────────────────────────── */}
      {(todo.total > 0 || todo.items.length > 0) && (
        <>
          <Text bold color="gray">─ 작업</Text>
          <Box flexDirection="row" flexWrap="wrap">
            <Text color="gray">{todo.done}/{todo.total} </Text>
            <Text color="green">{doneMark} </Text>
            <Text color="cyan">{pendingItems}</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
