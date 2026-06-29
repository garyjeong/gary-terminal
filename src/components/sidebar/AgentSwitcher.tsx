import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';
import type { AgentFilter } from '../../store.js';
import type { Agent, AgentStatus } from '../../types.js';

// ③ Cap visible agent rows so the sidebar never overflows its vertical budget.
// Each agent takes 1 row; header + 2 borders = 3 overhead rows in the panel.
const MAX_VISIBLE_AGENTS = 4;

function statusIcon(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return '●';
    case 'waiting':
      return '⏳';
    case 'blocked':
      return '🔒';
    case 'done':
      return '✓';
  }
}

function statusColor(status: AgentStatus): string {
  switch (status) {
    case 'running':
      return 'green';
    case 'waiting':
      return 'yellow';
    case 'blocked':
      return 'red';
    case 'done':
      return 'gray';
  }
}

/** Shorten a full claude model ID to a readable family name. */
function shortModel(model: string): string {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'son';
  if (m.includes('haiku')) return 'hku';
  if (m.includes('fable')) return 'fab';
  return model.slice(0, 6);
}

/** Build the compact badge string for an agent row, e.g. "[opus·xhigh]" */
function agentBadge(agent: Agent): string {
  // Use sessionModel (filled after init) for the actual model; fall back to requestedModel.
  const rawModel = agent.sessionModel || agent.requestedModel || '';
  const modelPart = shortModel(rawModel);
  const effortPart = agent.effort ?? '';
  if (!modelPart && !effortPart) return '';
  if (modelPart && effortPart) return `[${modelPart}·${effortPart}]`;
  if (modelPart) return `[${modelPart}]`;
  return `[·${effortPart}]`;
}

function filterLabel(filter: AgentFilter): string {
  switch (filter) {
    case 'all':
      return '전체';
    case 'active':
      return '활성';
    case 'blocked':
      return '대기중';
  }
}

export function AgentSwitcher(): React.ReactElement {
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusMode = useStore((state) => state.ui.focusMode);
  const agentFilter = useStore((state) => state.ui.agentFilter);
  const isSelected = focusRegion === 'agents';
  const isActive = isSelected && focusMode === 'active';
  const isFocused = isActive; // kept for backward compat with internal usage
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';

  // Apply filter to agents list
  const filteredAgents = agents.filter((a) => {
    if (agentFilter === 'all') return true;
    if (agentFilter === 'active') return a.status !== 'done';
    if (agentFilter === 'blocked') return a.status === 'blocked';
    return true;
  });

  // Always include the focused agent in the visible window,
  // then fill from the filtered list.
  const visible = (() => {
    if (filteredAgents.length <= MAX_VISIBLE_AGENTS) return filteredAgents;
    const focusedIdx = filteredAgents.findIndex((a) => a.id === focusedAgentId);
    // Prefer showing the most-recent MAX_VISIBLE_AGENTS agents; but if the
    // focused one is near the top, shift the window so it's always visible.
    const windowStart = Math.min(
      Math.max(0, focusedIdx - 1),
      filteredAgents.length - MAX_VISIBLE_AGENTS,
    );
    return filteredAgents.slice(windowStart, windowStart + MAX_VISIBLE_AGENTS);
  })();

  const hiddenCount = filteredAgents.length - visible.length;

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
      flexShrink={1}
      overflow="hidden"
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={isFocused ? 'cyan' : 'white'}>
          에이전트
        </Text>
        {agentFilter !== 'all' && (
          <Text color="cyan" dimColor>
            [{filterLabel(agentFilter)}]
          </Text>
        )}
      </Box>
      {visible.length === 0 ? (
        <Text color="gray" dimColor>  (없음)</Text>
      ) : (
        visible.map((agent) => {
          const isAgentSelected = agent.id === focusedAgentId;
          const badge = agentBadge(agent);
          return (
            <Box key={agent.id} flexDirection="row">
              <Text color={statusColor(agent.status)}>{statusIcon(agent.status)} </Text>
              <Text color={isAgentSelected ? 'white' : 'gray'} bold={isAgentSelected}>
                {agent.title}
              </Text>
              {badge ? <Text color="gray" dimColor> {badge}</Text> : null}
              {isAgentSelected && <Text color="cyan"> ◀</Text>}
            </Box>
          );
        })
      )}
      {hiddenCount > 0 && (
        <Text color="gray" dimColor>  +{hiddenCount} more (↑↓ to navigate)</Text>
      )}
    </Box>
  );
}
