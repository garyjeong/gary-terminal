import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSpinner } from '../hooks/useSpinner.js';
import type { Message, MessageRole } from '../types.js';
import { MarkdownText } from '../utils/renderMarkdown.js';

// ─── Layout constants ──────────────────────────────────────────────────────
const TITLEBAR_H = 3;
const CONV_BORDERS_H = 2;
const CONV_HEADER_H = 1;
const INPUT_H = 3;
const LAYOUT_OVERHEAD = TITLEBAR_H + CONV_BORDERS_H + CONV_HEADER_H + INPUT_H; // = 9

const SIDEBAR_W = 34;
const CONV_BORDER_COLS = 2;
const CONV_PADDING_COLS = 2;

// ─── Flat row type for line-level windowing ────────────────────────────────

interface FlatRow {
  key: string;
  msgId: string;
  role: MessageRole;
  lineText: string;
  /** True for the first line of a message — controls role prefix display. */
  isFirstLine: boolean;
  toolName?: string;
  toolStatus?: 'ok' | 'error' | 'running';
}

/** Split a single message into flat display rows (one row per content line). */
function messageToRows(msg: Message): FlatRow[] {
  const lines = msg.content ? msg.content.split('\n') : [''];
  return lines.map((lineText, i) => ({
    key: `${msg.id}-ln${i}`,
    msgId: msg.id,
    role: msg.role,
    lineText,
    isFirstLine: i === 0,
    toolName: msg.toolName,
    toolStatus: msg.toolStatus,
  }));
}

// ─── Single flat-row renderer ──────────────────────────────────────────────

const FlatRowView = React.memo(function FlatRowView({
  row,
}: {
  row: FlatRow;
}): React.ReactElement {
  switch (row.role) {
    case 'user':
      return (
        <Box flexDirection="row">
          {row.isFirstLine ? (
            <Text color="cyan">[you] </Text>
          ) : (
            <Text>{'      '}</Text>
          )}
          <Text color="white" wrap="wrap">
            {row.lineText}
          </Text>
        </Box>
      );

    case 'assistant':
      // Pass individual lines through MarkdownText — handles headings, bullets,
      // inline bold/code/italic. Multi-line fenced code blocks are split across rows
      // (each line renders as plain text), which is an acceptable trade-off for
      // gaining full row-level scroll control.
      return (
        <Box flexDirection="column">
          <MarkdownText content={row.lineText} />
        </Box>
      );

    case 'tool': {
      const statusSymbol =
        row.toolStatus === 'ok' ? '✓' : row.toolStatus === 'error' ? '✗' : '●';
      const statusColor =
        row.toolStatus === 'ok' ? 'green' : row.toolStatus === 'error' ? 'red' : 'yellow';
      if (row.isFirstLine) {
        return (
          <Box flexDirection="row">
            <Text color="yellow">● </Text>
            <Text color="gray">
              {row.toolName ?? 'Tool'}: {row.lineText}{' '}
            </Text>
            <Text color={statusColor}>{statusSymbol}</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="row">
          <Text>{'  '}</Text>
          <Text color="gray">{row.lineText}</Text>
        </Box>
      );
    }

    case 'codex': {
      const statusSymbol =
        row.toolStatus === 'ok' ? '✓' : row.toolStatus === 'error' ? '✗' : '●';
      const statusColor =
        row.toolStatus === 'ok'
          ? 'green'
          : row.toolStatus === 'error'
          ? 'red'
          : 'magenta';
      if (row.isFirstLine) {
        return (
          <Box flexDirection="row">
            <Text color="magenta">▸ codex: </Text>
            <Text color="gray">{row.lineText} </Text>
            <Text color={statusColor}>{statusSymbol}</Text>
          </Box>
        );
      }
      return (
        <Box flexDirection="row">
          <Text>{'  '}</Text>
          <Text color="gray">{row.lineText}</Text>
        </Box>
      );
    }
  }
});

// ─── Main component ────────────────────────────────────────────────────────

export function ConversationPane(): React.ReactElement {
  const { rows, columns } = useTerminalSize();
  const agents = useStore((state) => state.agents);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusMode = useStore((state) => state.ui.focusMode);
  const scrollOffset = useStore((state) => state.conversationScrollOffset);
  const isSelected = focusRegion === 'conversation';
  const isActive = isSelected && focusMode === 'active';
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';

  const copyMode = useStore((state) => state.ui.copyMode);

  const focusedAgent = agents.find((a) => a.id === focusedAgentId);
  const messages = focusedAgent?.messages ?? [];
  const streamingText = focusedAgent?.streamingText ?? '';

  // Show thinking spinner: agent running but no streaming text yet (first-token wait).
  // Suppressed in copy-mode to freeze periodic re-renders.
  const isThinking =
    focusedAgent?.status === 'running' && streamingText === '' && scrollOffset === 0;
  const spinnerFrame = useSpinner(isThinking && !copyMode);

  const showStreaming = scrollOffset === 0 && Boolean(streamingText);

  const messagesHeight = Math.max(4, rows - LAYOUT_OVERHEAD);
  void columns; // used only for _contentWidth (unused by row-based logic)

  // ── Build flat row list from all committed messages ────────────────────────
  const allRows: FlatRow[] = [];
  for (const msg of messages) {
    for (const row of messageToRows(msg)) {
      allRows.push(row);
    }
  }

  // ── Compute how many tail rows (streaming + thinking) will occupy ──────────
  // These are always shown at the bottom and count against available height.
  const streamLineCount = showStreaming
    ? Math.max(1, streamingText.split('\n').length)
    : 0;
  const thinkingLineCount = isThinking ? 1 : 0;
  const tailHeight = streamLineCount + thinkingLineCount;

  // Available height for committed message rows
  const availableForRows = Math.max(0, messagesHeight - tailHeight);

  // ── Row-based windowing ────────────────────────────────────────────────────
  const totalMsgRows = allRows.length;
  // Clamp offset so we never scroll past the very first row
  const maxOffset = Math.max(0, totalMsgRows - availableForRows);
  const rowOffset = Math.min(scrollOffset, maxOffset);

  // Window: take the last `availableForRows` rows, shifted up by rowOffset
  const viewEnd = totalMsgRows - rowOffset;
  const viewStart = Math.max(0, viewEnd - availableForRows);
  const visibleRows = allRows.slice(viewStart, viewEnd);

  const isEmpty = visibleRows.length === 0 && !showStreaming && !isThinking;

  const scrollIndicator =
    rowOffset > 0
      ? ` [↑ ${rowOffset} rows up | PgDn/Ctrl+D to tail]`
      : '';

  // Streaming lines split for rendering
  const streamLines = showStreaming ? streamingText.split('\n') : [];

  return (
    <Box
      borderStyle="single"
      borderColor={borderColor}
      flexDirection="column"
      flexGrow={1}
      paddingX={1}
    >
      {/* Header row */}
      <Box flexDirection="row">
        <Text color="cyan">◀ </Text>
        <Text color="white" bold>
          {focusedAgent?.id ?? 'session-1'}
        </Text>
        <Text color="gray">
          {' · "'}
          {focusedAgent?.title ?? ''}
          {'"'}
        </Text>
        {focusedAgent?.agentsMdLoaded && (
          <Text color="green" dimColor>
            {' AGENTS.md ✓'}
          </Text>
        )}
        {rowOffset > 0 && (
          <Text color="yellow" dimColor>
            {scrollIndicator}
          </Text>
        )}
      </Box>

      {/*
       * Messages box: fixed height, no overflow clipping needed since
       * we pre-slice to exactly the available row count.
       */}
      <Box
        flexDirection="column"
        height={messagesHeight}
        overflow="hidden"
      >
        {isEmpty ? (
          <Box alignItems="center" justifyContent="center" height={messagesHeight}>
            <Text color="gray" dimColor>
              아직 대화가 없습니다 · 메시지를 입력해 시작하세요
            </Text>
          </Box>
        ) : (
          <>
            {visibleRows.map((row) => (
              <FlatRowView key={row.key} row={row} />
            ))}
            {/* Streaming text — always at tail */}
            {showStreaming &&
              streamLines.map((line, i) => (
                <Box key={`stream-${i}`} flexDirection="row">
                  {i === 0 ? (
                    <Text color="cyan" dimColor>
                      {'▍ '}
                    </Text>
                  ) : (
                    <Text>{'  '}</Text>
                  )}
                  <Text color="white" wrap="wrap">
                    {line}
                  </Text>
                </Box>
              ))}
            {/* Thinking spinner — shown while waiting for first token */}
            {isThinking && (
              <Box flexDirection="row">
                <Text color="cyan" dimColor>
                  {spinnerFrame}{' '}
                </Text>
                <Text color="gray" dimColor>
                  생각 중…
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
