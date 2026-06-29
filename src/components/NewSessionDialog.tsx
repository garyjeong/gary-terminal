/**
 * NewSessionDialog — overlay for selecting model/effort before spawning a new session.
 *
 * Ctrl+N opens this dialog. Keys are handled in App.tsx.
 * - ↑↓  : switch between model row and effort row
 * - ←→  : cycle option on the focused row
 * - Enter: spawn with selected options
 * - Esc  : cancel
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useStore } from '../store.js';

// ── Options ────────────────────────────────────────────────────────────────
// Index 0 = 'default' (no flag passed). Keep MODEL_OPTIONS_LEN / EFFORT_OPTIONS_LEN
// in sync with store.ts cycleNewSessionOption.

/** Model display labels. Index 0 = default (user's configured model). */
export const MODEL_OPTIONS = ['default', 'opus', 'sonnet', 'haiku'] as const;
export type ModelOption = (typeof MODEL_OPTIONS)[number];

/** Effort display labels. Index 0 = default (no flag). */
export const EFFORT_OPTIONS = ['default', 'low', 'medium', 'high', 'xhigh'] as const;
export type EffortOption = (typeof EFFORT_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Helpers to convert selected indices to flag values
// ---------------------------------------------------------------------------

/** Returns the model value to pass to --model, or undefined if default. */
export function resolveModelFlag(modelIdx: number): string | undefined {
  const label = MODEL_OPTIONS[modelIdx];
  if (!label || label === 'default') return undefined;
  // claude CLI accepts short model family names (opus/sonnet/haiku).
  // Full model IDs also work but we let the CLI resolve the alias.
  return label;
}

/** Returns the effort value to pass to --effort, or undefined if default. */
export function resolveEffortFlag(effortIdx: number): string | undefined {
  const label = EFFORT_OPTIONS[effortIdx];
  if (!label || label === 'default') return undefined;
  return label;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewSessionDialog(): React.ReactElement | null {
  const { open, focusRow, modelIdx, effortIdx } = useStore((state) => state.newSessionDialog);

  if (!open) return null;

  const modelLabel = MODEL_OPTIONS[modelIdx] ?? 'default';
  const effortLabel = EFFORT_OPTIONS[effortIdx] ?? 'default';

  return (
    <Box
      borderStyle="double"
      borderColor="cyan"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="cyan">새 세션 옵션 (Ctrl+N)</Text>
      <Text color="gray">↑↓ 행 이동  ←→ 옵션 변경  Enter 생성  Esc 취소</Text>
      <Box flexDirection="column" marginTop={1}>
        {/* Model row */}
        <Box flexDirection="row">
          <Text color={focusRow === 'model' ? 'cyan' : 'gray'}>
            {focusRow === 'model' ? '▶ ' : '  '}
          </Text>
          <Text color={focusRow === 'model' ? 'white' : 'gray'}>
            {'모델   : '}
          </Text>
          {MODEL_OPTIONS.map((opt, i) => (
            <Text
              key={opt}
              color={i === modelIdx ? 'cyan' : 'gray'}
              bold={i === modelIdx}
            >
              {i === modelIdx ? `[${opt}]` : ` ${opt} `}
            </Text>
          ))}
        </Box>
        {/* Effort row */}
        <Box flexDirection="row">
          <Text color={focusRow === 'effort' ? 'cyan' : 'gray'}>
            {focusRow === 'effort' ? '▶ ' : '  '}
          </Text>
          <Text color={focusRow === 'effort' ? 'white' : 'gray'}>
            {'effort : '}
          </Text>
          {EFFORT_OPTIONS.map((opt, i) => (
            <Text
              key={opt}
              color={i === effortIdx ? 'cyan' : 'gray'}
              bold={i === effortIdx}
            >
              {i === effortIdx ? `[${opt}]` : ` ${opt} `}
            </Text>
          ))}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          → claude {modelLabel !== 'default' ? `--model ${modelLabel} ` : ''}
          {effortLabel !== 'default' ? `--effort ${effortLabel}` : '(기본값)'}
        </Text>
      </Box>
    </Box>
  );
}
