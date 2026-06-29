import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

// ── Braille sparkline helper ────────────────────────────────────────────────
// Each braille char encodes 2 columns × 4 dot rows (left: dots 1,2,3,7; right: dots 4,5,6,8).
// We use the bottom-up column fill to create a 1-row sparkline.
// Left column bits (fill level 0-4): dot7(bit6), dot3(bit2), dot2(bit1), dot1(bit0)
// Right column bits (fill level 0-4): dot8(bit7), dot6(bit5), dot5(bit4), dot4(bit3)
const BRAILLE_LEFT = [0x00, 0x40, 0x44, 0x46, 0x47] as const;
const BRAILLE_RIGHT = [0x00, 0x80, 0xa0, 0xb0, 0xb8] as const;

function toLevel(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(4, Math.round((Math.max(0, value) / max) * 4));
}

/**
 * Render a braille sparkline from a history array.
 * charCount braille chars = charCount*2 data points displayed.
 * maxVal: if provided, scale is fixed (good for 0-100%); otherwise uses dynamic max.
 */
export function renderBraille(history: number[], charCount: number = 8, maxVal?: number): string {
  const max = maxVal !== undefined ? maxVal : Math.max(1, ...history);
  const needed = charCount * 2;
  // Pad left with zeros if history is shorter than needed
  const padded: number[] = Array(Math.max(0, needed - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-needed);

  let result = '';
  for (let i = 0; i < charCount; i++) {
    const leftLevel = toLevel(src[i * 2] ?? 0, max);
    const rightLevel = toLevel(src[i * 2 + 1] ?? 0, max);
    result += String.fromCharCode(0x2800 + BRAILLE_LEFT[leftLevel]! + BRAILLE_RIGHT[rightLevel]!);
  }
  return result;
}

// ── Color helpers ───────────────────────────────────────────────────────────
function pctColor(pct: number): string {
  if (pct >= 80) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

// ── Network speed formatter ─────────────────────────────────────────────────
function formatKBs(kbs: number): string {
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)}M`;
  if (kbs >= 1) return `${Math.round(kbs)}K`;
  return '0K';
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

// 8-char bar (fallback for CTX gauge)
function renderBar(value: number, width: number = 8): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function SystemPane(): React.ReactElement {
  const { cpu, mem, net, disk, cpuHistory, memHistory, netRxHistory, netTxHistory } = useStore(
    (state) => state.system,
  );

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

  // Braille sparklines (8 chars = 16 data points)
  const cpuGraph = renderBraille(cpuHistory, 8, 100);
  const memGraph = renderBraille(memHistory, 8, 100);
  // NET uses dynamic max so relative traffic changes are visible
  const netRxGraph = renderBraille(netRxHistory, 6);
  const netTxGraph = renderBraille(netTxHistory, 6);

  // CTX gauge (keep existing bar style — distinct from system metrics)
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

  const rxLabel = formatKBs(net.rxKBs);
  const txLabel = formatKBs(net.txKBs);

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color="white">
        시스템
      </Text>
      {/* CPU sparkline */}
      <Text color={pctColor(cpu)}>
        {'CPU '}
        {cpuGraph}
        {' '}
        {String(cpu).padStart(3)}{'%'}
      </Text>
      {/* MEM sparkline */}
      <Text color={pctColor(mem)}>
        {'MEM '}
        {memGraph}
        {' '}
        {String(mem).padStart(3)}{'%'}
      </Text>
      {/* NET RX (download) */}
      <Text color="cyan">
        {'↓RX '}
        {netRxGraph}
        {' '}
        {rxLabel.padStart(4)}
      </Text>
      {/* NET TX (upload) */}
      <Text color="cyan">
        {'↑TX '}
        {netTxGraph}
        {' '}
        {txLabel.padStart(4)}
      </Text>
      {/* Disk bar (static bar is fine — disk % changes slowly) */}
      <Text color="magenta">
        {'DSK ['}
        {renderBar(disk.usedPct)}
        {'] '}
        {String(disk.usedPct).padStart(3)}{'%'}
      </Text>
      {/* CTX gauge — keep existing style */}
      <Text color={ctxColor}>
        {'CTX ['}
        {ctxBar}
        {'] '}
        {ctxLabel}
      </Text>
    </Box>
  );
}
