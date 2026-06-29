import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useStore } from '../store.js';

const MAX_POPUP_ITEMS = 8;

export function InputPane(): React.ReactElement {
  const [inputKey, setInputKey] = useState(0);
  const [completionValue, setCompletionValue] = useState('');
  // Ref to track raw current value for @ completion (avoids stale closures)
  const currentValueRef = useRef('');

  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const sessionSends = useStore((state) => state.sessionSends);
  const addMessage = useStore((state) => state.addMessage);
  const setAgentStatus = useStore((state) => state.setAgentStatus);
  const setWaiting = useStore((state) => state.setWaiting);

  // Slash autocomplete
  const autocomplete = useStore((state) => state.slashAutocomplete);
  const openSlashAutocomplete = useStore((state) => state.openSlashAutocomplete);
  const closeSlashAutocomplete = useStore((state) => state.closeSlashAutocomplete);
  const setSlashQuery = useStore((state) => state.setSlashQuery);
  const moveSlashSelection = useStore((state) => state.moveSlashSelection);

  // File autocomplete
  const fileAutocomplete = useStore((state) => state.fileAutocomplete);
  const openFileAutocomplete = useStore((state) => state.openFileAutocomplete);
  const closeFileAutocomplete = useStore((state) => state.closeFileAutocomplete);
  const setFileQuery = useStore((state) => state.setFileQuery);
  const moveFileSelection = useStore((state) => state.moveFileSelection);

  const focusMode = useStore((state) => state.ui.focusMode);
  const setFocusMode = useStore((state) => state.setFocusMode);
  const isSelected = focusRegion === 'input';
  const isActive = isSelected && focusMode === 'active';
  const isFocused = isActive;
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';

  // Slash popup display
  const { filteredCommands, selectedIndex, open: popupOpen } = autocomplete;
  const displayItems = filteredCommands.slice(0, MAX_POPUP_ITEMS);
  const remaining = filteredCommands.length - MAX_POPUP_ITEMS;

  // File popup display
  const {
    filteredFiles,
    selectedIndex: fileSelectedIndex,
    open: filePopupOpen,
    truncated,
    allFiles,
  } = fileAutocomplete;
  const fileDisplayItems = filteredFiles.slice(0, MAX_POPUP_ITEMS);
  const fileRemaining = filteredFiles.length - MAX_POPUP_ITEMS;

  // Apply slash completion
  const applyCompletion = useCallback(() => {
    const ac = useStore.getState().slashAutocomplete;
    const cmd = ac.filteredCommands[ac.selectedIndex];
    if (!cmd) return;
    const newVal = `/${cmd.name} `;
    setCompletionValue(newVal);
    setInputKey((k) => k + 1);
    useStore.getState().closeSlashAutocomplete();
  }, []);

  // Apply file completion: replace @<query> with @<file>
  const applyFileCompletion = useCallback(() => {
    const fa = useStore.getState().fileAutocomplete;
    const file = fa.filteredFiles[fa.selectedIndex];
    if (!file) return;
    const val = currentValueRef.current;
    const lastAtIdx = val.lastIndexOf('@');
    const prefix = lastAtIdx >= 0 ? val.slice(0, lastAtIdx) : val;
    const newVal = `${prefix}@${file} `;
    setCompletionValue(newVal);
    setInputKey((k) => k + 1);
    useStore.getState().closeFileAutocomplete();
  }, []);

  function handleChange(value: string): void {
    currentValueRef.current = value;

    // ── Slash autocomplete: only when value starts with '/' ──
    if (value.startsWith('/')) {
      const afterSlash = value.slice(1);
      if (!afterSlash.includes(' ')) {
        setSlashQuery(afterSlash);
        if (!useStore.getState().slashAutocomplete.open) openSlashAutocomplete(afterSlash);
      } else {
        if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();
      }
      // Slash takes priority — close file picker if somehow open
      if (useStore.getState().fileAutocomplete.open) closeFileAutocomplete();
      return;
    }

    // Not starting with '/' — close slash autocomplete if open
    if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();

    // ── @ file picker: detect last '@' without subsequent space ──
    const lastAtIdx = value.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const afterAt = value.slice(lastAtIdx + 1);
      if (!afterAt.includes(' ')) {
        const query = afterAt;
        if (!useStore.getState().fileAutocomplete.open) {
          openFileAutocomplete(query);
        } else {
          setFileQuery(query);
        }
        return;
      }
    }

    // No active trigger — close file picker if open
    if (useStore.getState().fileAutocomplete.open) closeFileAutocomplete();
  }

  function handleSubmit(text: string): void {
    if (useStore.getState().ui.focusMode === 'select') return;

    // File autocomplete active → apply completion instead of sending
    const fa = useStore.getState().fileAutocomplete;
    if (fa.open && fa.filteredFiles.length > 0) {
      applyFileCompletion();
      return;
    }

    // Slash autocomplete active → apply completion instead of sending
    const ac = useStore.getState().slashAutocomplete;
    if (ac.open && ac.filteredCommands.length > 0) {
      const cmd = ac.filteredCommands[ac.selectedIndex];
      if (cmd) {
        const newVal = `/${cmd.name} `;
        setCompletionValue(newVal);
        setInputKey((k) => k + 1);
        useStore.getState().closeSlashAutocomplete();
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    addMessage(focusedAgentId, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
    });

    const sessionSend = sessionSends[focusedAgentId];
    if (sessionSend) {
      sessionSend(trimmed);
      setAgentStatus(focusedAgentId, 'running');
      setWaiting(false);
    }

    setCompletionValue('');
    setInputKey((k) => k + 1);
  }

  // Handle popup-specific keys and Esc
  useInput(
    (_input, key) => {
      // File popup: ↑↓ navigate, Tab/Enter apply, Esc close
      if (filePopupOpen) {
        if (key.upArrow) { moveFileSelection(-1); return; }
        if (key.downArrow) { moveFileSelection(1); return; }
        if (key.escape) { closeFileAutocomplete(); return; }
        if (key.tab) { applyFileCompletion(); return; }
        return; // swallow other keys while file popup is open
      }

      // Slash popup: ↑↓ navigate, Tab apply, Esc close
      if (popupOpen) {
        if (key.upArrow) { moveSlashSelection(-1); return; }
        if (key.downArrow) { moveSlashSelection(1); return; }
        if (key.escape) { closeSlashAutocomplete(); return; }
        if (key.tab) { applyCompletion(); return; }
        return; // swallow other keys while slash popup is open
      }

      // No popup: Esc exits to select mode
      if (key.escape) {
        setFocusMode('select');
        return;
      }
    },
    { isActive: isFocused },
  );

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
              cmd.type === 'skill' ? ' [Skill]' :
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

      <Box
        borderStyle="single"
        borderColor={borderColor}
        paddingX={1}
        flexDirection="row"
      >
        <Text color="cyan">{'> '}</Text>
        <Box flexGrow={1}>
          <TextInput
            key={inputKey}
            defaultValue={completionValue}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="메시지를 입력하세요..."
          />
        </Box>
      </Box>
    </Box>
  );
}
