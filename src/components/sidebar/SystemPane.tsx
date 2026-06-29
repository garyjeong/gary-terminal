import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

// 8-char bar using Unicode block elements as per spec
// Sidebar content area ≈ 21 cols; keep each stat row ≤ 21 chars.
function renderBar(value: number, width: number = 8): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function SystemPane(): React.ReactElement {
  const { cpu, mem } = useStore((state) => state.system);

  // CTX%: read from focused agent's latest usage data
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const contextTokens = useStore((state) => {
    const agent = state.agents.find((a) => a.id === focusedAgentId);
    return agent?.contextTokens ?? 0;
  });
  const contextWindow = useStore((state) => {
    const agent = state.agents.find((a) => a.id === focusedAgentId);
    return agent?.contextWindow ?? 0;
  });

  // System panel is display-only — never focused or highlighted
  const isFocused = false;

  const cpuBar = renderBar(cpu);
  const memBar = renderBar(mem);

  // CTX%
  const ctxPct = contextWindow > 0 ? Math.round((contextTokens / contextWindow) * 100) : 0;
  const ctxBar = contextWindow > 0 ? renderBar(ctxPct) : '░'.repeat(8);
  const ctxColor = ctxPct >= 95 ? 'red' : ctxPct >= 80 ? 'yellow' : 'green';

  let ctxLabel: string;
  if (contextWindow === 0) {
    ctxLabel = '--';
  } else {
    const cur = formatTokenCount(contextTokens);
    const win = formatTokenCount(contextWindow);
    ctxLabel = `${ctxPct}% ${cur}/${win}`;
  }

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
        시스템
      </Text>
      <Text color="green">CPU [{cpuBar}] {String(cpu).padStart(3)}%</Text>
      <Text color="blue">MEM [{memBar}] {String(mem).padStart(3)}%</Text>
      <Text color={ctxColor}>CTX [{ctxBar}] {ctxLabel}</Text>
    </Box>
  );
}
