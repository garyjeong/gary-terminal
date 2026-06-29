import React from 'react';
import { Box } from 'ink';
import { AgentSwitcher } from './AgentSwitcher.js';
import { SystemPane } from './SystemPane.js';
import { UsagePane } from './UsagePane.js';
import { ReferencePane } from './ReferencePane.js';

/**
 * ③ Sidebar height견고화
 *
 * Each child panel uses overflow="hidden" on its own root Box so that when
 * Yoga's flex algorithm shrinks a panel (insufficient vertical space), the
 * content clips *inside* the border rather than spilling out and corrupting
 * adjacent panels.
 *
 * The flexGrow=1 wrapper at the bottom lets ReferencePane absorb spare
 * vertical space, and shrinks first when the terminal is short.  AgentSwitcher
 * caps its agent count internally so it never overflows its own border even
 * without shrinking.
 */
export function Sidebar(): React.ReactElement {
  return (
    <Box width={34} flexDirection="column">
      <AgentSwitcher />
      <SystemPane />
      <UsagePane />
      <Box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
        <ReferencePane />
      </Box>
    </Box>
  );
}
