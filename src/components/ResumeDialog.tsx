/**
 * ResumeDialog — overlay showing recent sessions for --resume selection.
 *
 * Keys are handled in App.tsx (useInput with resumeDialog.open guard) so
 * that this component remains stateless and purely presentational.
 *
 * Layout:  title · cwd(short) · relative-time · model
 * CWD mismatch warning shown inline when selected.cwd ≠ process.cwd().
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import { shortCwd, relativeTime } from '../data/sessionStore.js';

export function ResumeDialog(): React.ReactElement | null {
  const { open, selectedIndex, sessions } = useStore((state) => state.resumeDialog);

  if (!open) return null;

  const currentCwd = process.cwd();

  return (
    <Box
      borderStyle="double"
      borderColor="magenta"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="magenta">
        세션 재개 (Ctrl+O)
      </Text>
      <Text color="gray">
        ↑↓ 이동 · Enter 재개 · Esc 닫기
      </Text>

      {sessions.length === 0 ? (
        <Text color="gray" dimColor>
          저장된 세션이 없습니다. 먼저 세션을 시작하세요.
        </Text>
      ) : (
        sessions.map((sess, i) => {
          const isSelected = i === selectedIndex;
          const cwdMismatch = sess.cwd !== currentCwd;

          return (
            <Box key={sess.sessionId} flexDirection="column">
              <Box flexDirection="row">
                <Text color={isSelected ? 'magenta' : 'gray'} bold={isSelected}>
                  {isSelected ? '▶ ' : '  '}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                  {sess.title.padEnd(18).slice(0, 18)}
                </Text>
                <Text color="cyan">
                  {shortCwd(sess.cwd).padEnd(34).slice(0, 34)}
                </Text>
                <Text color="yellow">
                  {relativeTime(sess.lastActiveAt).padEnd(10).slice(0, 10)}
                </Text>
                <Text color="blue">
                  {sess.model.slice(0, 24)}
                </Text>
                {cwdMismatch && isSelected && (
                  <Text color="red" bold>
                    {' '}⚠ cwd 불일치
                  </Text>
                )}
              </Box>
              {cwdMismatch && isSelected && (
                <Box marginLeft={4}>
                  <Text color="red" dimColor>
                    저장: {shortCwd(sess.cwd, 50)} → 현재: {shortCwd(currentCwd, 50)}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
