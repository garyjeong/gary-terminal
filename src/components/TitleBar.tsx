import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';

export function TitleBar(): React.ReactElement {
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const focusedAgent = agents.find((a) => a.id === focusedAgentId);
  const sessionModel = focusedAgent?.sessionModel ?? '';

  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Text color="cyan" bold>
        gary-terminal
      </Text>
      <Text color="gray">
        {sessionModel || 'claude'} · {agents.length > 1 ? `${agents.length} sessions` : '1 session'}
      </Text>
    </Box>
  );
}
