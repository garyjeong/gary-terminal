import React from 'react';
import { Box } from 'ink';
import { AgentSwitcher } from './AgentSwitcher.js';
import { SubagentsPane } from './SubagentsPane.js';
import { SystemPane } from './SystemPane.js';
import { UsagePane } from './UsagePane.js';
import { ReferencePane } from './ReferencePane.js';
import { KeybindingsPane } from './KeybindingsPane.js';

/**
 * Sidebar layout (top → bottom):
 * 1. AgentSwitcher   — flexShrink=0, caps agent count internally
 * 2. SubagentsPane   — flexShrink=0
 * 3. SystemPane      — flexShrink=0, bpytop-style braille sparklines
 * 4. UsagePane       — flexShrink=0
 * 5. ReferencePane   — flexGrow=1, flexShrink=1 (absorbs spare space, shrinks first)
 * 6. KeybindingsPane — flexShrink=1, compact 2-col grid at the bottom
 *
 * Each panel uses overflow="hidden" so content clips inside the border when
 * Yoga's flex algorithm shrinks the panel.
 */
export function Sidebar(): React.ReactElement {
  return (
    <Box width={34} flexDirection="column">
      <AgentSwitcher />
      <SubagentsPane />
      <SystemPane />
      <UsagePane />
      <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
        <ReferencePane />
      </Box>
      <KeybindingsPane />
    </Box>
  );
}
