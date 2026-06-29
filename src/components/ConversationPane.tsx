import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useSpinner } from '../hooks/useSpinner.js';
import type { Message } from '../types.js';
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

// ─── Message rendering ─────────────────────────────────────────────────────

const MessageRow = React.memo(function MessageRow({ message }: { message: Message }): React.ReactElement {
  switch (message.role) {
    case 'user':
      return (
        <Box flexDirection="row">
          <Text color="cyan">[you] </Text>
          <Text color="white" wrap="wrap">{message.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box flexDirection="column">
          <MarkdownText content={message.content} />
        </Box>
      );

    case 'tool': {
      const statusSymbol =
        message.toolStatus === 'ok'
          ? '✓'
          : message.toolStatus === 'error'
          ? '✗'
          : '⏳';
      const statusColor =
        message.toolStatus === 'ok'
          ? 'green'
          : message.toolStatus === 'error'
          ? 'red'
          : 'yellow';
      return (
        <Box flexDirection="row">
          <Text color="yellow">● </Text>
          <Text color="gray">
            {message.toolName ?? 'Tool'}: {message.content}{' '}
          </Text>
          <Text color={statusColor}>{statusSymbol}</Text>
        </Box>
      );
    }

    case 'codex': {
      const statusSymbol =
        message.toolStatus === 'ok'
          ? '✓'
          : message.toolStatus === 'error'
          ? '✗'
          : '⏳';
      const statusColor =
        message.toolStatus === 'ok'
          ? 'green'
          : message.toolStatus === 'error'
          ? 'red'
          : 'magenta';
      return (
        <Box flexDirection="row">
          <Text color="magenta">▸ codex: </Text>
          <Text color="gray">{message.content} </Text>
          <Text color={statusColor}>{statusSymbol}</Text>
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

  const focusedAgent = agents.find((a) => a.id === focusedAgentId);
  const messages = focusedAgent?.messages ?? [];
  // Per-agent streaming text
  const streamingText = focusedAgent?.streamingText ?? '';

  // Show thinking spinner: agent is running but no streaming text yet (first-token wait)
  const isThinking =
    focusedAgent?.status === 'running' && streamingText === '' && scrollOffset === 0;
  const spinnerFrame = useSpinner(isThinking);

  // ② Determine which messages to render.
  const displayMessages =
    scrollOffset > 0
      ? messages.slice(0, Math.max(1, messages.length - scrollOffset))
      : messages;

  const showStreaming = scrollOffset === 0 && Boolean(streamingText);

  const messagesHeight = Math.max(4, rows - LAYOUT_OVERHEAD);
  const _contentWidth = Math.max(20, columns - SIDEBAR_W - CONV_BORDER_COLS - CONV_PADDING_COLS);
  void _contentWidth;

  const scrollIndicator =
    scrollOffset > 0 ? ` [↑ ${scrollOffset} msgs up | PgDn/Ctrl+D to tail]` : '';

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
          <Text color="green" dimColor> AGENTS.md ✓</Text>
        )}
        {scrollOffset > 0 && (
          <Text color="yellow" dimColor>{scrollIndicator}</Text>
        )}
      </Box>

      {/*
       * Messages box: fixed height + flex-end packs to bottom,
       * overflow="hidden" clips upward overflow.
       */}
      <Box
        flexDirection="column"
        height={messagesHeight}
        justifyContent="flex-end"
        overflow="hidden"
      >
        {displayMessages.map((msg) => (
          <MessageRow key={msg.id} message={msg} />
        ))}
        {showStreaming && (
          <Box flexDirection="row">
            <Text color="cyan" dimColor>▍ </Text>
            <Text color="white" wrap="wrap">{streamingText}</Text>
          </Box>
        )}
        {isThinking && (
          <Box flexDirection="row">
            <Text color="cyan" dimColor>{spinnerFrame} </Text>
            <Text color="gray" dimColor>생각 중…</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
