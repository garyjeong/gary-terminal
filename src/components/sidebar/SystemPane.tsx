import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

// ── 3-row tall bar graph ────────────────────────────────────────────────────
//
// For each history sample, renders 3 characters stacked top→bottom.
// Think of the value (0-100%) as filling a bar from the bottom:
//   bottom zone: 0 – 33%   mid zone: 33 – 66%   top zone: 66 – 100%
// Character within each zone:
//   '█' zone fully covered   '▄' zone partially covered   ' ' zone empty

const GRAPH_WIDTH = 24; // number of history samples shown per row

function renderTallBar(
  history: number[],
  charCount: number = GRAPH_WIDTH,
  maxVal: number = 100,
): [string, string, string] {
  const needed = charCount;
  const padded: number[] = Array(Math.max(0, needed - history.length)).fill(0);
  padded.push(...history);
  const src = padded.slice(-needed);

  const topChars: string[] = [];
  const midChars: string[] = [];
  const botChars: string[] = [];

  for (const v of src) {
    const pct = maxVal <= 0 ? 0 : Math.min(100, Math.max(0, (v / maxVal) * 100));
    // Bottom zone  (0 – 33%)
    botChars.push(pct >= 33 ? '█' : pct > 3 ? '▄' : ' ');
    // Mid zone     (33 – 66%)
    midChars.push(pct >= 66 ? '█' : pct > 33 ? '▄' : ' ');
    // Top zone     (66 – 100%)
    topChars.push(pct >= 96 ? '█' : pct > 66 ? '▄' : ' ');
  }

  return [topChars.join(''), midChars.join(''), botChars.join('')];
}

// ── Block sparkline helper (kept for NET graphs) ─────────────────────────────
const BLOCK_CHARS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

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

// ── Braille sparkline helper (compact NET graphs) ────────────────────────────
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

// ── Color helpers ────────────────────────────────────────────────────────────
function pctColor(pct: number): string {
  if (pct >= 80) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

// ── Network speed formatter ──────────────────────────────────────────────────
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

// 8-char bar (for CTX / DSK gauges)
function renderBar(value: number, width: number = 8): string {
  const filled = Math.round((value / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export function SystemPane(): React.ReactElement {
  const { cpu, mem, memTotalGB, net, disk, cpuHistory, memHistory, netRxHistory, netTxHistory } = useStore(
    (state) => state.system,
  );
  const detectedServers = useStore((state) => state.detectedServers);

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

  // 3-row tall graphs for CPU and MEM
  const [cpuTop, cpuMid, cpuBot] = renderTallBar(cpuHistory, GRAPH_WIDTH, 100);
  const [memTop, memMid, memBot] = renderTallBar(memHistory, GRAPH_WIDTH, 100);

  // NET: braille (5 chars = 10 points) for compact traffic sparkline
  const netRxGraph = renderBraille(netRxHistory, 5);
  const netTxGraph = renderBraille(netTxHistory, 5);

  const cpuColor = pctColor(cpu);
  const memColor = pctColor(mem);

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
      borderColor="green"
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color="green">시스템</Text>

      {/* ── CPU: header + 3-row tall graph ─────────────────────────────────── */}
      <Box flexDirection="row">
        <Text color={cpuColor} bold>{'CPU '}</Text>
        <Text color={cpuColor} bold>{String(cpu).padStart(3)}{'%'}</Text>
      </Box>
      <Text color={cpuColor}>{cpuTop}</Text>
      <Text color={cpuColor}>{cpuMid}</Text>
      <Text color={cpuColor}>{cpuBot}</Text>

      {/* ── MEM: header + 3-row tall graph ─────────────────────────────────── */}
      <Box flexDirection="row">
        <Text color={memColor} bold>{'MEM '}</Text>
        <Text color={memColor} bold>{String(mem).padStart(3)}{'%'}</Text>
        {memSuffix.length > 0 && (
          <Text color="gray">{memSuffix}</Text>
        )}
      </Box>
      <Text color={memColor}>{memTop}</Text>
      <Text color={memColor}>{memMid}</Text>
      <Text color={memColor}>{memBot}</Text>

      {/* ── NET RX/TX (compact braille) ─────────────────────────────────────── */}
      <Box flexDirection="row">
        <Text color="cyan">{'↓'}</Text>
        <Text color="cyan">{rxLabel}</Text>
        <Text color="cyan">{' '}{netRxGraph}</Text>
      </Box>
      <Box flexDirection="row">
        <Text color="cyan">{'↑'}</Text>
        <Text color="cyan">{txLabel}</Text>
        <Text color="cyan">{' '}{netTxGraph}</Text>
      </Box>

      {/* ── Disk bar ─────────────────────────────────────────────────────────── */}
      <Text color="magenta">
        {'DSK ['}
        {renderBar(disk.usedPct)}
        {'] '}
        {String(disk.usedPct).padStart(3)}{'%'}
      </Text>

      {/* ── CTX gauge ────────────────────────────────────────────────────────── */}
      <Text color={ctxColor}>
        {'CTX ['}
        {ctxBar}
        {'] '}
        {ctxLabel}
      </Text>

      {/* ── Auto-detected repo servers (hidden when none) ────────────────────── */}
      {detectedServers.length > 0 && (
        <>
          <Text color="gray" dimColor>{'─'.repeat(GRAPH_WIDTH)}</Text>
          <Text bold color="magenta">{'서버'}</Text>
          {detectedServers.map((srv) => {
            const srvColor = pctColor(srv.cpu);
            const miniGraph = renderBlock(srv.cpuHistory, 5, 100);
            const nameLabel = srv.name.slice(0, 10).padEnd(10);
            const portStr = srv.port > 0 ? `:${srv.port}` : '';
            const cpuStr = `${String(Math.round(srv.cpu)).padStart(3)}%`;
            const memStr = srv.memRssMB >= 1 ? `${Math.round(srv.memRssMB)}M` : '';
            return (
              <Box key={srv.pid} flexDirection="column">
                <Box flexDirection="row">
                  <Text color="green">{'● '}</Text>
                  <Text color={srvColor}>{nameLabel}</Text>
                  <Text color="cyan">{portStr}</Text>
                </Box>
                <Box flexDirection="row" marginLeft={2}>
                  <Text color={srvColor}>{miniGraph}</Text>
                  <Text color={srvColor} bold>{' '}{cpuStr}</Text>
                  {memStr.length > 0 && (
                    <Text color="gray">{' '}{memStr}</Text>
                  )}
                </Box>
              </Box>
            );
          })}
        </>
      )}
    </Box>
  );
}
