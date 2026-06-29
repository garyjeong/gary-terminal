/**
 * BindDialog — overlay for binding a server process to the system monitor.
 *
 * Opened with Ctrl+B. Accepts a port number, PID, or process name.
 * Displays the top-CPU running processes as a filterable list.
 *
 * Keys are handled in App.tsx (topMode === 'bind'), same pattern as
 * ResumeDialog / NewSessionDialog.
 *
 * Layout:
 *   ╔══════════════════════════════════════╗
 *   ║ 프로세스 바인딩 (Ctrl+B)             ║
 *   ║ 포트/PID/이름 입력 · ↑↓ · Enter · Esc ║
 *   ║ ▶ [query______]                     ║
 *   ║   PID  이름           CPU   MEM      ║
 *   ║ ▶ 3001 node           12%   45M     ║
 *   ║   ...                               ║
 *   ╚══════════════════════════════════════╝
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import type { TopProc } from '../types.js';

/** Max number of process rows shown in the dialog list. */
const MAX_LIST_ROWS = 10;

export function BindDialog(): React.ReactElement | null {
  const { open, query, selectedIndex, topProcs } = useStore((state) => state.bindDialog);
  const boundProcesses = useStore((state) => state.boundProcesses);

  if (!open) return null;

  // Filter process list by current query
  const filtered: TopProc[] = query === ''
    ? topProcs.slice(0, MAX_LIST_ROWS)
    : topProcs
        .filter(
          (p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            String(p.pid).includes(query),
        )
        .slice(0, MAX_LIST_ROWS);

  // Set of already-bound PIDs for visual hint
  const boundPids = new Set(boundProcesses.map((bp) => bp.pid));

  return (
    <Box
      borderStyle="double"
      borderColor="yellow"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">
        프로세스 바인딩 (Ctrl+B)
      </Text>
      <Text color="gray">
        포트:3000 / PID / 이름 · ↑↓ 선택 · Enter 바인딩 · Esc 닫기
      </Text>

      {/* Query input display */}
      <Box flexDirection="row" marginTop={1}>
        <Text color="yellow">{'▶ '}</Text>
        {query.length > 0 ? (
          <Text color="white">{query}</Text>
        ) : (
          <Text color="gray" dimColor>포트/PID/이름 입력...</Text>
        )}
        <Text color="yellow">{'█'}</Text>
      </Box>

      {/* Process list */}
      {filtered.length === 0 ? (
        <Text color="gray" dimColor>
          {topProcs.length === 0
            ? '프로세스 목록을 로딩 중...'
            : '일치하는 프로세스가 없습니다'}
        </Text>
      ) : (
        <>
          <Box flexDirection="row" marginTop={1}>
            <Text color="gray">{'  '}</Text>
            <Text color="gray">{'PID   '}</Text>
            <Text color="gray">{'이름           '}</Text>
            <Text color="gray">{'CPU  '}</Text>
            <Text color="gray">{'MEM'}</Text>
          </Box>
          {filtered.map((proc, i) => {
            const isSelected = i === selectedIndex;
            const isBound = boundPids.has(proc.pid);
            const cpuColor = proc.cpu >= 50 ? 'red' : proc.cpu >= 20 ? 'yellow' : 'green';
            const nameStr = proc.name.slice(0, 14).padEnd(14);
            const pidStr = String(proc.pid).padStart(5);
            const cpuStr = `${Math.round(proc.cpu)}%`.padStart(4);
            const memStr = `${proc.mem.toFixed(1)}%`.padStart(5);

            return (
              <Box key={proc.pid} flexDirection="row">
                <Text color={isSelected ? 'yellow' : 'gray'} bold={isSelected}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                  {pidStr}{' '}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                  {nameStr}
                </Text>
                <Text color={isSelected ? cpuColor : 'gray'} bold={isSelected}>
                  {cpuStr}
                </Text>
                <Text color={isSelected ? 'gray' : 'gray'}>
                  {memStr}
                </Text>
                {isBound && (
                  <Text color="green">{' ●'}</Text>
                )}
              </Box>
            );
          })}
        </>
      )}

      {/* Currently bound processes hint */}
      {boundProcesses.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray" dimColor>
            {'현재 바인딩: '}
            {boundProcesses.map((bp) => bp.label).join(', ')}
          </Text>
          <Text color="gray" dimColor>Del 키: 선택한 프로세스 바인딩 제거</Text>
        </Box>
      )}
    </Box>
  );
}
