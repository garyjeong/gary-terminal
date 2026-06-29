import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';

function summarizeInput(toolName: string, toolInput: Record<string, unknown>): string {
  if (toolName === 'Bash') {
    const cmd = String(toolInput['command'] ?? toolInput['cmd'] ?? '');
    return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
  }
  if (toolName === 'Write' || toolName === 'Edit') {
    return String(toolInput['file_path'] ?? toolInput['path'] ?? '');
  }
  const s = JSON.stringify(toolInput);
  return s.length > 80 ? s.slice(0, 77) + '...' : s;
}

export function PermissionDialog(): React.ReactElement | null {
  const { open, toolName, toolInput } = useStore((state) => state.permissionDialog);

  if (!open) return null;

  const summary = summarizeInput(toolName, toolInput);

  return (
    <Box
      borderStyle="double"
      borderColor="yellow"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">
        도구 실행 승인 필요
      </Text>
      <Text color="gray">
        y=승인 · n/Esc=거부
      </Text>
      <Box marginTop={1} flexDirection="row">
        <Text color="cyan" bold>{toolName}</Text>
        <Text color="white">{'  '}{summary}</Text>
      </Box>
    </Box>
  );
}
