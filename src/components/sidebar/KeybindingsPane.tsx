import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../../store.js';

// Most-used shortcuts extracted from KEYMAP_CONTEXTS global context.
// Full reference is in the ? overlay — this panel shows the quick-access subset.
const SHORTCUTS: Array<{ key: string; desc: string }> = [
  { key: '^N', desc: '새세션' },
  { key: '^O', desc: '재개' },
  { key: '^X', desc: '중단' },
  { key: '^Y', desc: '복사' },
  { key: '? ', desc: '도움말' },
  { key: 'q ', desc: '종료' },
];

export function KeybindingsPane(): React.ReactElement {
  const collapsed = useStore((state) => state.ui.paneCollapsed.keybindings);

  // Render 2-column grid to stay compact
  const pairs: Array<[typeof SHORTCUTS[0], typeof SHORTCUTS[0] | undefined]> = [];
  for (let i = 0; i < SHORTCUTS.length; i += 2) {
    pairs.push([SHORTCUTS[i]!, SHORTCUTS[i + 1]]);
  }

  return (
    <Box
      borderStyle="single"
      borderColor="blue"
      borderDimColor
      flexDirection="column"
      flexShrink={1}
      overflow="hidden"
      paddingX={1}
    >
      <Text bold color="gray">
        {collapsed ? '▸' : '▾'} 단축키
        {collapsed && <Text color="gray" dimColor> (^K 열기)</Text>}
      </Text>
      {!collapsed && pairs.map(([left, right], idx) => (
        <Box key={idx} flexDirection="row">
          <Text color="yellow">{left.key}</Text>
          <Text color="white"> {left.desc.padEnd(5)}</Text>
          {right !== undefined ? (
            <>
              <Text color="yellow">{'  '}{right.key}</Text>
              <Text color="white"> {right.desc}</Text>
            </>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}
