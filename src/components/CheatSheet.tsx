import React from 'react';
import { Box, Text } from 'ink';
import { CHEATSHEET_ENTRIES } from '../keymap.js';
import { useStore } from '../store.js';

export function CheatSheet(): React.ReactElement | null {
  const showCheatSheet = useStore((state) => state.ui.showCheatSheet);

  if (!showCheatSheet) return null;

  return (
    <Box
      borderStyle="double"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">
        단축키 도움말
      </Text>
      {CHEATSHEET_ENTRIES.map((entry) => (
        <Box key={entry.key} flexDirection="row">
          <Text color="yellow" bold>
            {entry.key.padEnd(16)}
          </Text>
          <Text color="white">{entry.desc}</Text>
        </Box>
      ))}
      <Text color="gray">? 를 눌러 닫기</Text>
    </Box>
  );
}
