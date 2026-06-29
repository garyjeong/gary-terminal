import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';

export function WaitingBanner(): React.ReactElement | null {
  const waiting = useStore((state) => state.ui.waiting);

  if (!waiting) return null;

  return (
    <Box
      borderStyle="single"
      borderColor="yellow"
      paddingX={1}
      justifyContent="center"
    >
      <Text color="yellow">○ 입력 대기 중...</Text>
    </Box>
  );
}
