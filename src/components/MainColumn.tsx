import React from 'react';
import { Box } from 'ink';
import { ConversationPane } from './ConversationPane.js';
import { InputPane } from './InputPane.js';

export function MainColumn(): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <ConversationPane />
      <InputPane />
    </Box>
  );
}
