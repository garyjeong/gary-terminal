import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useStore } from '../store.js';
import {
  cpSplit,
  cpLen,
  cpInsert,
  cpDeleteBefore,
  isPrintableInput,
  renderWithCursor,
  renderPlaceholder,
  ansiDim,
  detectSlashTrigger,
  detectFileTrigger,
} from './inputUtils.js';

const MAX_POPUP_ITEMS = 8;

// ─────────────────────────────────────────────────────────────────────────────
// InputPane component
//
// Pure code-point / rendering / trigger-detection helpers live in
// ./inputUtils.ts (unit-tested by scripts/test-input.ts).
// ─────────────────────────────────────────────────────────────────────────────

export function InputPane(): React.ReactElement {
  // ── Controlled input state ────────────────────────────────────────────────
  // value / cursorOffset are the single source of truth for the input field.
  // Both are also mirrored in refs so that useInput callbacks always see the
  // *latest* values even when they fire before the next React render.
  const [value, setValue] = useState('');
  const [cursorOffset, setCursorOffset] = useState(0); // in code-point units
  const valueRef       = useRef('');
  const cursorRef      = useRef(0);
  valueRef.current  = value;
  cursorRef.current = cursorOffset;

  // Command history navigation
  const historyIndexRef = useRef(-1); // -1 = not navigating
  const draftRef        = useRef(''); // saved draft before history navigation

  // ── Store selectors ───────────────────────────────────────────────────────
  const focusRegion    = useStore((state) => state.ui.focusRegion);
  const focusedAgentId = useStore((state) => state.focusedAgentId);

  // Slash autocomplete
  const autocomplete        = useStore((state) => state.slashAutocomplete);
  const openSlashAutocomplete  = useStore((state) => state.openSlashAutocomplete);
  const closeSlashAutocomplete = useStore((state) => state.closeSlashAutocomplete);
  const setSlashQuery          = useStore((state) => state.setSlashQuery);
  const moveSlashSelection     = useStore((state) => state.moveSlashSelection);

  // File autocomplete
  const fileAutocomplete    = useStore((state) => state.fileAutocomplete);
  const openFileAutocomplete  = useStore((state) => state.openFileAutocomplete);
  const closeFileAutocomplete = useStore((state) => state.closeFileAutocomplete);
  const setFileQuery           = useStore((state) => state.setFileQuery);
  const moveFileSelection      = useStore((state) => state.moveFileSelection);

  const focusMode  = useStore((state) => state.ui.focusMode);
  const modeStack  = useStore((state) => state.ui.modeStack);
  const setFocusMode = useStore((state) => state.setFocusMode);

  const isSelected = focusRegion === 'input';
  const isActive   = isSelected && focusMode === 'active';
  const isFocused  = isActive;
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';

  // Blocking overlays disable the input entirely
  const BLOCKING_MODES = ['resume', 'permission', 'newsession', 'cheatsheet', 'copy'] as const;
  const hasBlockingOverlay = modeStack.some((m) =>
    (BLOCKING_MODES as readonly string[]).includes(m),
  );
  const inputDisabled = !isActive || hasBlockingOverlay;

  // Input history actions
  const addInputHistory          = useStore((state) => state.addInputHistory);
  const setInputIsEmpty          = useStore((state) => state.setInputIsEmpty);
  const setInputHistoryNavigating = useStore((state) => state.setInputHistoryNavigating);

  // Slash popup display
  const { filteredCommands, selectedIndex, open: popupOpen } = autocomplete;
  const displayItems = filteredCommands.slice(0, MAX_POPUP_ITEMS);
  const remaining    = filteredCommands.length - MAX_POPUP_ITEMS;

  // File popup display
  const {
    filteredFiles,
    selectedIndex: fileSelectedIndex,
    open: filePopupOpen,
    truncated,
    allFiles,
  } = fileAutocomplete;
  const fileDisplayItems = filteredFiles.slice(0, MAX_POPUP_ITEMS);
  const fileRemaining    = filteredFiles.length - MAX_POPUP_ITEMS;

  // ── Core state updater ────────────────────────────────────────────────────
  /**
   * Atomically update value + cursor.
   * Refs are written BEFORE React state so that any synchronous code that
   * follows (e.g., side-effect calls) sees the new values immediately.
   */
  const applyUpdate = useCallback(
    (newVal: string, newCursor: number) => {
      valueRef.current  = newVal;
      cursorRef.current = newCursor;
      setValue(newVal);
      setCursorOffset(newCursor);
    },
    [],
  );

  // ── Value change side-effects (autocomplete / inputIsEmpty / history reset) ─
  // This is the direct equivalent of the old handleChange(), but now called
  // *synchronously* inside the useInput handler instead of via useEffect.
  const handleValueChange = useCallback(
    (newVal: string) => {
      setInputIsEmpty(newVal === '');

      // Reset history navigation whenever the user types
      if (historyIndexRef.current !== -1) {
        historyIndexRef.current = -1;
        setInputHistoryNavigating(false);
      }

      // ── Slash autocomplete ──────────────────────────────────────────────
      // Any '/'-prefixed value is handled by the slash branch and returns early
      // (slash takes priority over the @ file picker).
      if (newVal.startsWith('/')) {
        const slash = detectSlashTrigger(newVal);
        if (slash.active) {
          setSlashQuery(slash.query);
          if (!useStore.getState().slashAutocomplete.open) {
            openSlashAutocomplete(slash.query);
          }
        } else {
          if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();
        }
        if (useStore.getState().fileAutocomplete.open) closeFileAutocomplete();
        return;
      }

      if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();

      // ── @ file picker ───────────────────────────────────────────────────
      const file = detectFileTrigger(newVal);
      if (file.active) {
        if (!useStore.getState().fileAutocomplete.open) {
          openFileAutocomplete(file.query);
        } else {
          setFileQuery(file.query);
        }
        return;
      }

      if (useStore.getState().fileAutocomplete.open) closeFileAutocomplete();
    },
    [
      setInputIsEmpty, setInputHistoryNavigating,
      setSlashQuery, openSlashAutocomplete, closeSlashAutocomplete,
      openFileAutocomplete, setFileQuery, closeFileAutocomplete,
    ],
  );

  // ── Programmatic value injection (completions, history) ──────────────────
  /**
   * Inject a new value from outside (completion apply, history navigation).
   * Does NOT fire the autocomplete side-effects (the caller has already done
   * the bookkeeping for those).
   */
  const injectValue = useCallback(
    (newVal: string) => {
      applyUpdate(newVal, cpLen(newVal)); // cursor always goes to end on injection
      setInputIsEmpty(newVal === '');
    },
    [applyUpdate, setInputIsEmpty],
  );

  // ── Completion handlers ───────────────────────────────────────────────────
  const applyCompletion = useCallback(() => {
    const ac = useStore.getState().slashAutocomplete;
    const cmd = ac.filteredCommands[ac.selectedIndex];
    if (!cmd) return;
    const newVal = `/${cmd.name} `;
    injectValue(newVal);
    useStore.getState().closeSlashAutocomplete();
  }, [injectValue]);

  const applyFileCompletion = useCallback(() => {
    const fa = useStore.getState().fileAutocomplete;
    const file = fa.filteredFiles[fa.selectedIndex];
    if (!file) return;
    const val = valueRef.current;
    const lastAtIdx = val.lastIndexOf('@');
    const prefix = lastAtIdx >= 0 ? val.slice(0, lastAtIdx) : val;
    const newVal = `${prefix}@${file} `;
    injectValue(newVal);
    useStore.getState().closeFileAutocomplete();
  }, [injectValue]);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (text: string) => {
      if (useStore.getState().ui.focusMode === 'select') return;

      // File autocomplete active → apply completion
      const fa = useStore.getState().fileAutocomplete;
      if (fa.open && fa.filteredFiles.length > 0) {
        applyFileCompletion();
        return;
      }

      // Slash autocomplete active → apply completion
      const ac = useStore.getState().slashAutocomplete;
      if (ac.open && ac.filteredCommands.length > 0) {
        applyCompletion();
        return;
      }

      const trimmed = text.trim();
      if (!trimmed) return;

      addInputHistory(trimmed);
      historyIndexRef.current = -1;
      setInputHistoryNavigating(false);

      if (trimmed === '/clear') {
        useStore.getState().dispatchOp(focusedAgentId, { type: 'clear' });
      } else if (trimmed.startsWith('/compact')) {
        useStore.getState().dispatchOp(focusedAgentId, { type: 'compact' });
      } else {
        useStore.getState().dispatchOp(focusedAgentId, { type: 'submit', text: trimmed });
      }

      applyUpdate('', 0);
      setInputIsEmpty(true);
    },
    [
      applyCompletion, applyFileCompletion, addInputHistory,
      setInputHistoryNavigating, focusedAgentId, applyUpdate, setInputIsEmpty,
    ],
  );

  // ── Single unified useInput handler ──────────────────────────────────────
  //
  // Priority order (top = highest):
  //   1. File popup navigation (↑↓/Esc/Tab/Enter)
  //   2. Slash popup navigation (↑↓/Esc/Tab/Enter)
  //   3. Ctrl+U — kill line
  //   4. ↑↓ history (only when no popup open)
  //   5. Esc — exit to select mode (no popup)
  //   6. Enter — submit (no popup)
  //   7. ←/→ — cursor movement
  //   8. Backspace/Delete — code-point–aware deletion
  //   9. Printable character input (ASCII, Korean, emoji…)
  //
  // Korean input: ink's stdin.setEncoding('utf8') ensures that UTF-8 multibyte
  // sequences are buffered in Node's StringDecoder and delivered as complete
  // code-point strings. We still filter on codePoint >= 0x20 to discard any
  // control bytes that might slip through (e.g., 0x0D/Enter arriving as '\r').
  useInput(
    (input, key) => {
      // ── 1. File popup navigation ─────────────────────────────────────────
      if (filePopupOpen) {
        if (key.upArrow)             { moveFileSelection(-1);    return; }
        if (key.downArrow)           { moveFileSelection(1);     return; }
        if (key.escape)              { closeFileAutocomplete();  return; }
        if (key.tab || key.return)   { applyFileCompletion();   return; }
        // Other keys (including Korean chars) fall through to char insertion
        // below, which updates the value and re-filters the file list.
      }

      // ── 2. Slash popup navigation ─────────────────────────────────────────
      if (popupOpen) {
        if (key.upArrow)             { moveSlashSelection(-1);    return; }
        if (key.downArrow)           { moveSlashSelection(1);     return; }
        if (key.escape)              { closeSlashAutocomplete();  return; }
        if (key.tab || key.return)   { applyCompletion();         return; }
        // Other keys fall through.
      }

      // ── 3. Ctrl+U: kill line ─────────────────────────────────────────────
      if (key.ctrl && input === 'u') {
        applyUpdate('', 0);
        setInputIsEmpty(true);
        historyIndexRef.current = -1;
        setInputHistoryNavigating(false);
        if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();
        if (useStore.getState().fileAutocomplete.open)  closeFileAutocomplete();
        return;
      }

      // ── 4. ↑: navigate to older history item ─────────────────────────────
      if (key.upArrow && !filePopupOpen && !popupOpen) {
        const history = useStore.getState().inputHistory;
        if (history.length === 0) return;
        // If input has text and we're not already in history mode, do nothing
        if (historyIndexRef.current === -1 && valueRef.current !== '') return;
        // Save draft on first navigation
        if (historyIndexRef.current === -1) {
          draftRef.current = valueRef.current;
        }
        const nextIdx = Math.min(historyIndexRef.current + 1, history.length - 1);
        if (nextIdx === historyIndexRef.current && historyIndexRef.current >= 0) return;
        historyIndexRef.current = nextIdx;
        const item = history[history.length - 1 - nextIdx] ?? '';
        setInputHistoryNavigating(true);
        injectValue(item);
        return;
      }

      // ── ↓: navigate to newer history item or restore draft ───────────────
      if (key.downArrow && !filePopupOpen && !popupOpen && historyIndexRef.current !== -1) {
        const nextIdx = historyIndexRef.current - 1;
        if (nextIdx < 0) {
          historyIndexRef.current = -1;
          setInputHistoryNavigating(false);
          injectValue(draftRef.current);
        } else {
          historyIndexRef.current = nextIdx;
          const history = useStore.getState().inputHistory;
          const item = history[history.length - 1 - nextIdx] ?? '';
          injectValue(item);
        }
        return;
      }

      // ── 5. Esc: exit to select mode (when no popup is open) ──────────────
      if (key.escape && !filePopupOpen && !popupOpen) {
        setFocusMode('select');
        return;
      }

      // ── 6. Enter: submit (when no popup is handling Enter above) ─────────
      if (key.return && !filePopupOpen && !popupOpen) {
        handleSubmit(valueRef.current);
        return;
      }

      // ── 7. ←/→: cursor movement ───────────────────────────────────────────
      if (key.leftArrow) {
        const newCursor = Math.max(0, cursorRef.current - 1);
        cursorRef.current = newCursor;
        setCursorOffset(newCursor);
        return;
      }
      if (key.rightArrow) {
        const maxCursor = cpLen(valueRef.current);
        const newCursor = Math.min(maxCursor, cursorRef.current + 1);
        cursorRef.current = newCursor;
        setCursorOffset(newCursor);
        return;
      }

      // ── 8. Backspace/Delete: code-point–aware deletion ────────────────────
      if (key.backspace || key.delete) {
        const [newVal, newCursor] = cpDeleteBefore(valueRef.current, cursorRef.current);
        if (newVal !== valueRef.current) {
          applyUpdate(newVal, newCursor);
          handleValueChange(newVal);
        }
        return;
      }

      // ── 9. Printable character input (ASCII, Korean, emoji, …) ───────────
      // Filter out:
      //   - Empty input (special keys already handled above)
      //   - Ctrl / Meta sequences
      //   - Control characters (< U+0020, e.g. '\r', '\t', '\x1b')
      //
      // Korean: ink's StringDecoder delivers '안' (1 code-point string) as a
      // single 'input' value — no byte splitting at this layer.
      if (
        input &&
        !key.ctrl &&
        !key.meta &&
        isPrintableInput(input)
      ) {
        const inputCodePoints = cpSplit(input); // handles multi-char pastes & emoji
        const newVal    = cpInsert(valueRef.current, cursorRef.current, inputCodePoints);
        const newCursor = cursorRef.current + inputCodePoints.length;
        applyUpdate(newVal, newCursor);
        handleValueChange(newVal);
        return;
      }
    },
    { isActive: isFocused },
  );

  // ── Rendered input value ──────────────────────────────────────────────────
  const PLACEHOLDER = '메시지를 입력하세요...';

  const renderedInput = useMemo(() => {
    if (inputDisabled) {
      // Disabled: show plain text or dimmed placeholder
      return value || ansiDim(PLACEHOLDER);
    }
    if (!value) {
      // Active, empty: placeholder with cursor on first char
      return renderPlaceholder(PLACEHOLDER);
    }
    // Active, has text: render with block cursor
    return renderWithCursor(value, cursorOffset);
  }, [value, cursorOffset, inputDisabled]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      {/* File autocomplete popup */}
      {filePopupOpen && fileDisplayItems.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          {fileDisplayItems.map((file, i) => {
            const isItemSelected = i === fileSelectedIndex;
            return (
              <Box key={file} flexDirection="row">
                <Text color={isItemSelected ? 'cyan' : 'white'} bold={isItemSelected}>
                  {isItemSelected ? '> ' : '  '}@{file}
                </Text>
              </Box>
            );
          })}
          {fileRemaining > 0 && (
            <Text color="gray">  +{fileRemaining} more</Text>
          )}
          {truncated && (
            <Text color="yellow">  ({allFiles.length}개 표시 중, 5000개 상한 도달)</Text>
          )}
        </Box>
      )}

      {/* Slash autocomplete popup */}
      {popupOpen && displayItems.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          {displayItems.map((cmd, i) => {
            const isItemSelected = i === selectedIndex;
            const label = cmd.argumentHint ? `/${cmd.name} ${cmd.argumentHint}` : `/${cmd.name}`;
            const badge =
              cmd.type === 'skill'  ? ' [Skill]'  :
              cmd.type === 'plugin' ? ' [Plugin]' :
              cmd.type === 'custom' ? ' [Custom]' : '';
            return (
              <Box key={cmd.name} flexDirection="row">
                <Text color={isItemSelected ? 'cyan' : 'white'} bold={isItemSelected}>
                  {isItemSelected ? '> ' : '  '}{label}
                </Text>
                {badge ? <Text color="yellow">{badge}</Text> : null}
                <Text color="gray">  {cmd.description}</Text>
              </Box>
            );
          })}
          {remaining > 0 && (
            <Text color="gray">  +{remaining} more</Text>
          )}
        </Box>
      )}

      {/* Input field */}
      <Box
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="row"
      >
        <Text color="cyan">{'> '}</Text>
        <Box flexGrow={1}>
          <Text>{renderedInput}</Text>
        </Box>
      </Box>
    </Box>
  );
}
