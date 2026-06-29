import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

// ── Block sparkline helper ──────────────────────────────────────────────────
// Uses Unicode block characters ▁▂▃▄▅▆▇█ (8 levels) + space (empty).
// Much more readable than braille in fonts where braille dots are tiny.
const BLOCK_CHARS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * Render a block-character sparkline from a history array.
 * charCount = number of chars in output (1 data point per char).
 * maxVal: if provided, scale is fixed (good for 0-100%); else uses dynamic max.
 */
export function renderBlock(history: number[], charCount: number = 8, maxVal?: number): string {
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

// ── Braille sparkline helper (kept for compact NET graphs) ──────────────────
const BRAILLE_LEFT = [0x00, 0x40, 0x44, 0x46, 0x47] as const;
const BRAILLE_RIGHT = [0x00, 0x80, 0xa0, 0xb0, 0xb8] as const;

function toLevel(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(4, Math.round((Math.max(0, value) / max) * 4));
}

export function renderBraille(history: number[], charCount: number = 8, maxVal?: number): string {
  const max = maxVal !== undefined ? maxVal : Math.max(1, ...history);
  const needed = charCount * 2;
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
/**
 * Format KB/s into a human-readable speed string.
 * Returns strings like "1.2MB/s", "512KB/s", " <1KB/s" (padded to 8 chars).
 */
function formatNetSpeed(kbs: number): string {
  if (kbs >= 1024) return `${(kbs / 1024).toFixed(1)}MB/s`;
  if (kbs >= 1) return `${Math.round(kbs)}KB/s`;
  return '<1KB/s';
}

/** Format token count for CTX display. */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** Format memory in GB for display, e.g. "9.8G". */
function formatGB(gb: number): string {
  if (gb >= 10) return `${Math.round(gb)}G`;
  return `${gb.toFixed(1)}G`;
}

// 8-char bar (for CTX gauge)
function renderBar(value: number, width: number = 8): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function SystemPane(): React.ReactElement {
  const { cpu, mem, memTotalGB, net, disk, cpuHistory, memHistory, netRxHistory, netTxHistory } = useStore(
    (state) => state.system,
  );
  const boundProcesses = useStore((state) => state.boundProcesses);

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

  // Block sparklines — 8 chars each (8 data points, more readable than braille)
  const cpuGraph = renderBlock(cpuHistory, 8, 100);
  const memGraph = renderBlock(memHistory, 8, 100);
  // NET: braille (6 chars = 12 points) gives smoother traffic curve in compact space
  const netRxGraph = renderBraille(netRxHistory, 5);
  const netTxGraph = renderBraille(netTxHistory, 5);

  // CTX gauge
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

  // MEM used amount (in GB)
  const memUsedGB = memTotalGB > 0 ? (mem / 100) * memTotalGB : null;
  const memSuffix = memUsedGB !== null && memTotalGB > 0
    ? ` ${formatGB(memUsedGB)}/${formatGB(memTotalGB)}`
    : '';

  const rxLabel = formatNetSpeed(net.rxKBs).padStart(8);
  const txLabel = formatNetSpeed(net.txKBs).padStart(8);

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

      {/* CPU block sparkline + value */}
      <Box flexDirection="row">
        <Text color={pctColor(cpu)}>{'CPU '}</Text>
        <Text color={pctColor(cpu)}>{cpuGraph}</Text>
        <Text color={pctColor(cpu)} bold>{' '}{String(cpu).padStart(3)}{'%'}</Text>
      </Box>

      {/* MEM block sparkline + value + used/total */}
      <Box flexDirection="row">
        <Text color={pctColor(mem)}>{'MEM '}</Text>
        <Text color={pctColor(mem)}>{memGraph}</Text>
        <Text color={pctColor(mem)} bold>{' '}{String(mem).padStart(3)}{'%'}</Text>
        {memSuffix.length > 0 && (
          <Text color="gray">{memSuffix}</Text>
        )}
      </Box>

      {/* NET RX (download) */}
      <Box flexDirection="row">
        <Text color="cyan">{'↓'}</Text>
        <Text color="cyan">{rxLabel}</Text>
        <Text color="cyan">{' '}{netRxGraph}</Text>
      </Box>

      {/* NET TX (upload) */}
      <Box flexDirection="row">
        <Text color="cyan">{'↑'}</Text>
        <Text color="cyan">{txLabel}</Text>
        <Text color="cyan">{' '}{netTxGraph}</Text>
      </Box>

      {/* Disk bar */}
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

      {/* Bound Processes section — hidden when no processes are bound */}
      {boundProcesses.length > 0 && (
        <>
          <Text color="gray" dimColor>{'─'.repeat(28)}</Text>
          <Text bold color="white">{'서버'}</Text>
          {boundProcesses.map((bp) => {
            const procColor = bp.alive ? pctColor(bp.cpu) : 'gray';
            // Mini sparkline: 4 chars
            const miniGraph = renderBlock(bp.cpuHistory, 4, 100);
            // Label: name truncated to fit
            const nameLabel = (bp.name || bp.label).slice(0, 10).padEnd(10);
            const cpuStr = bp.alive ? `${String(Math.round(bp.cpu)).padStart(3)}%` : '종료됨';
            const memStr = bp.alive ? `${bp.memRssMB.toFixed(0)}M` : '';
            return (
              <Box key={bp.id} flexDirection="column">
                <Box flexDirection="row">
                  <Text color={bp.alive ? 'green' : 'red'}>
                    {bp.alive ? '● ' : '○ '}
                  </Text>
                  <Text color={procColor}>{nameLabel}</Text>
                </Box>
                <Box flexDirection="row" marginLeft={2}>
                  <Text color={procColor}>{miniGraph}</Text>
                  <Text color={procColor} bold>{' '}{cpuStr}</Text>
                  {memStr.length > 0 && (
                    <Text color="gray">{' '}{memStr}</Text>
                  )}
                </Box>
                <Box flexDirection="row" marginLeft={2}>
                  <Text color="gray" dimColor>
                    {bp.bindType === 'port' ? `port:${bp.bindValue}` : `pid:${bp.pid ?? '?'}`}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
