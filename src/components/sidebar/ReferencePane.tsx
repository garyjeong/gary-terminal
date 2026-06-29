import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

export function ReferencePane(): React.ReactElement {
  const { referenceCollapsed, referenceCursor } = useStore((state) => state.ui);
  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusMode = useStore((state) => state.ui.focusMode);
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const references = useStore((state) => state.references);
  const isSelected = focusRegion === 'reference';
  const isActive = isSelected && focusMode === 'active';
  const isFocused = isActive; // kept for section-color logic
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';

  function sectionColor(section: 'skills' | 'mcp' | 'codex'): string {
    if (!isFocused) return 'blue';
    if (referenceCursor === section) return 'cyan';
    return 'yellow';
  }

  const { skills, mcp, mcpLoading, skillsLoading } = references;

  // Live codex stats from focused agent's tool calls
  const focusedAgent = agents.find((a) => a.id === focusedAgentId);
  const codexCalls = focusedAgent?.toolCalls.filter((tc) => tc.isCodex) ?? [];
  const codexRunning = codexCalls.filter((tc) => tc.status === 'running').length;
  const codexDone = codexCalls.filter((tc) => tc.status === 'done').length;
  const codexError = codexCalls.filter((tc) => tc.status === 'error').length;
  const codexTotal = codexCalls.length;

  function codexSummary(): string {
    if (codexTotal === 0) return 'gpt-5.5 · high';
    const parts: string[] = [];
    if (codexRunning > 0) parts.push(`실행중 ${codexRunning}`);
    if (codexDone > 0) parts.push(`완료 ${codexDone}`);
    if (codexError > 0) parts.push(`오류 ${codexError}`);
    return parts.join(' · ');
  }

  function mcpStatusIcon(status: string): string {
    if (status === 'connected') return '✔';
    if (status === 'auth') return '!';
    return '?';
  }

  function mcpStatusColor(status: string): string {
    if (status === 'connected') return 'green';
    if (status === 'auth') return 'yellow';
    return 'red';
  }

  const isSectionFocused = (section: 'skills' | 'mcp' | 'codex') =>
    isFocused && referenceCursor === section;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
      flexShrink={1}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color={isFocused ? 'cyan' : 'blue'}>
        참조
      </Text>
      {isSelected && (
        <Text color="gray" dimColor>
          {isActive ? '↑↓ 이동 · →펼침/←접음 · Esc 나가기' : 'Enter 진입'}
        </Text>
      )}

      {/* ── Skills 섹션 ──────────────────────────────────────────────────── */}
      <Box flexDirection="column">
        {/* 섹션 헤더 */}
        <Box flexDirection="row">
          <Text color={sectionColor('skills')}>
            {referenceCollapsed.skills ? '▶' : '▼'}
          </Text>
          <Text
            bold
            color={isSectionFocused('skills') ? 'cyan' : 'blue'}
          >
            {' '}Skills
          </Text>
          <Text color={isSectionFocused('skills') ? 'cyan' : 'gray'}>
            {' '}({skillsLoading ? '…' : String(skills.length)})
          </Text>
        </Box>
        {/* 항목 목록 */}
        {!referenceCollapsed.skills &&
          skills.map((skill) => (
            <Box key={skill.dir} flexDirection="row">
              <Text color="gray">{'  · '}</Text>
              <Text color={isFocused ? 'white' : 'gray'}>{skill.name}</Text>
            </Box>
          ))}
      </Box>

      {/* ── MCP 섹션 ─────────────────────────────────────────────────────── */}
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={sectionColor('mcp')}>
            {referenceCollapsed.mcp ? '▶' : '▼'}
          </Text>
          <Text
            bold
            color={isSectionFocused('mcp') ? 'cyan' : 'blue'}
          >
            {' '}MCP
          </Text>
          <Text color={isSectionFocused('mcp') ? 'cyan' : 'gray'}>
            {' '}({mcpLoading ? '…' : String(mcp.length)})
          </Text>
        </Box>
        {!referenceCollapsed.mcp && mcpLoading && (
          <Box flexDirection="row">
            <Text color="gray">{'  '}</Text>
            <Text color="gray" dimColor>확인 중…</Text>
          </Box>
        )}
        {!referenceCollapsed.mcp &&
          !mcpLoading &&
          mcp.map((item) => (
            <Box key={item.name} flexDirection="row">
              <Text color="gray">{'  '}</Text>
              <Text color={mcpStatusColor(item.status)}>
                {mcpStatusIcon(item.status)}
              </Text>
              <Text color={isFocused ? 'white' : 'gray'}>{' '}{item.name}</Text>
            </Box>
          ))}
      </Box>

      {/* ── Codex 섹션 ───────────────────────────────────────────────────── */}
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color={sectionColor('codex')}>
            {referenceCollapsed.codex ? '▶' : '▼'}
          </Text>
          <Text
            bold
            color={isSectionFocused('codex') ? 'cyan' : 'blue'}
          >
            {' '}Codex
          </Text>
          {codexRunning > 0 && (
            <Text color="magenta">{'  '}●</Text>
          )}
          {codexTotal > 0 && (
            <Text color={isSectionFocused('codex') ? 'cyan' : 'gray'}>
              {' '}({codexTotal})
            </Text>
          )}
        </Box>
        {!referenceCollapsed.codex && (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Text color="gray">{'  '}</Text>
              <Text color="gray" dimColor>{codexSummary()}</Text>
            </Box>
            {codexCalls.slice(-3).map((tc) => (
              <Box key={tc.id} flexDirection="row">
                <Text color="gray">{'  '}</Text>
                <Text
                  color={
                    tc.status === 'running'
                      ? 'yellow'
                      : tc.status === 'done'
                        ? 'green'
                        : 'red'
                  }
                >
                  {tc.status === 'running' ? '●' : tc.status === 'done' ? '✓' : '✗'}
                </Text>
                <Text color="gray">
                  {' '}{String(tc.input['command'] ?? '').slice(0, 18)}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
