import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';
import type { SubagentInfo } from '../../types.js';

/**
 * SubagentsPane — shows a tree of subagents spawned by the focused session.
 * Only renders when the focused agent has at least one subagent.
 * Supports up to 5 levels of nesting via parentToolUseId chain.
 */

function subagentIcon(status: SubagentInfo['status']): string {
  return status === 'running' ? '●' : '✓';
}

function subagentColor(status: SubagentInfo['status']): string {
  return status === 'running' ? 'green' : 'gray';
}

/**
 * Render subagents as a tree, resolving parent chains up to maxDepth.
 * Roots: subagents whose parentToolUseId is undefined or not found in the list.
 */
function buildTree(
  subagents: SubagentInfo[],
  parentId: string | undefined,
  depth: number,
  maxDepth: number,
): React.ReactElement[] {
  if (depth > maxDepth) return [];
  const indent = '  '.repeat(depth);
  const prefix = depth === 0 ? '' : '└ ';

  const children = subagents.filter((s) => s.parentToolUseId === parentId);
  const rows: React.ReactElement[] = [];

  for (const sub of children) {
    rows.push(
      <Box key={sub.id} flexDirection="row">
        <Text color="gray">{indent}{prefix}</Text>
        <Text color={subagentColor(sub.status)}>{subagentIcon(sub.status)} </Text>
        <Text color={sub.status === 'running' ? 'white' : 'gray'}>
          {sub.agentType}
        </Text>
      </Box>,
    );
    // Recurse with this subagent's id as parent
    rows.push(...buildTree(subagents, sub.id, depth + 1, maxDepth));
  }

  return rows;
}

export function SubagentsPane(): React.ReactElement | null {
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const focusedAgent = agents.find((a) => a.id === focusedAgentId);
  const subagents = focusedAgent?.subagents ?? [];

  // Don't render if no subagents
  if (subagents.length === 0) return null;

  // Roots: subagents whose parentToolUseId is undefined or not found among subagent ids
  const subagentIds = new Set(subagents.map((s) => s.id));
  const roots = subagents.filter(
    (s) => !s.parentToolUseId || !subagentIds.has(s.parentToolUseId),
  );
  const treeRows = buildTree(
    subagents,
    // Pass undefined to match roots (parentToolUseId === undefined) — but
    // since roots may have unknown parentToolUseId values, render them directly.
    undefined,
    0,
    5,
  );

  // Fallback: if tree building produced no rows (all have parent tool_use_ids
  // that don't match other subagent ids), just render as flat list.
  const rowsToRender: React.ReactElement[] =
    treeRows.length > 0
      ? treeRows
      : roots.map((sub) => (
          <Box key={sub.id} flexDirection="row">
            <Text color={subagentColor(sub.status)}>{subagentIcon(sub.status)} </Text>
            <Text color={sub.status === 'running' ? 'white' : 'gray'}>
              {sub.agentType}
            </Text>
          </Box>
        ));

  const runningCount = subagents.filter((s) => s.status === 'running').length;

  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      flexDirection="column"
      flexShrink={1}
      overflow="hidden"
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="white">Subagents</Text>
        {runningCount > 0 && (
          <Text color="green" dimColor>{runningCount} running</Text>
        )}
      </Box>
      {rowsToRender}
    </Box>
  );
}
