import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import { useStore } from '../store.js';

const MAX_POPUP_ITEMS = 8;

export function InputPane(): React.ReactElement {
  const [inputKey, setInputKey] = useState(0);
  const [completionValue, setCompletionValue] = useState('');

  const focusRegion = useStore((state) => state.ui.focusRegion);
  const focusedAgentId = useStore((state) => state.focusedAgentId);
  const sessionSends = useStore((state) => state.sessionSends);
  const addMessage = useStore((state) => state.addMessage);
  const setAgentStatus = useStore((state) => state.setAgentStatus);
  const setWaiting = useStore((state) => state.setWaiting);
  const autocomplete = useStore((state) => state.slashAutocomplete);
  const openSlashAutocomplete = useStore((state) => state.openSlashAutocomplete);
  const closeSlashAutocomplete = useStore((state) => state.closeSlashAutocomplete);
  const setSlashQuery = useStore((state) => state.setSlashQuery);
  const moveSlashSelection = useStore((state) => state.moveSlashSelection);

  const focusMode = useStore((state) => state.ui.focusMode);
  const setFocusMode = useStore((state) => state.setFocusMode);
  const isSelected = focusRegion === 'input';
  const isActive = isSelected && focusMode === 'active';
  const isFocused = isActive; // controls whether internal useInput fires
  const borderColor = !isSelected ? 'gray' : isActive ? 'cyan' : 'yellow';
  const { filteredCommands, selectedIndex, open: popupOpen } = autocomplete;
  const displayItems = filteredCommands.slice(0, MAX_POPUP_ITEMS);
  const remaining = filteredCommands.length - MAX_POPUP_ITEMS;

  const applyCompletion = useCallback(() => {
    const ac = useStore.getState().slashAutocomplete;
    const cmd = ac.filteredCommands[ac.selectedIndex];
    if (!cmd) return;
    const newVal = `/${cmd.name} `;
    setCompletionValue(newVal);
    setInputKey((k) => k + 1);
    useStore.getState().closeSlashAutocomplete();
  }, []); // empty deps since we use getState()

  function handleChange(value: string): void {
    if (value.startsWith('/')) {
      const afterSlash = value.slice(1);
      if (!afterSlash.includes(' ')) {
        setSlashQuery(afterSlash);
        if (!useStore.getState().slashAutocomplete.open) openSlashAutocomplete(afterSlash);
      } else {
        if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();
      }
    } else {
      if (useStore.getState().slashAutocomplete.open) closeSlashAutocomplete();
    }
  }

  function handleSubmit(text: string): void {
    // In SELECT mode, Enter enters the panel — don't send the message
    if (useStore.getState().ui.focusMode === 'select') return;
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

  // Handle autocomplete-specific keys and Esc
  useInput(
    (_input, key) => {
      // Popup open: navigate or close it
      if (popupOpen) {
        if (key.upArrow) {
          moveSlashSelection(-1);
          return;
        }
        if (key.downArrow) {
          moveSlashSelection(1);
          return;
        }
        if (key.escape) {
          closeSlashAutocomplete();
          return;
        }
        if (key.tab) {
          applyCompletion();
          return;
        }
        return;
      }
      // Popup closed: Esc exits to select mode
      if (key.escape) {
        setFocusMode('select');
        return;
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      {popupOpen && displayItems.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
        >
          {displayItems.map((cmd, i) => {
            const isSelected = i === selectedIndex;
            const label = cmd.argumentHint ? `/${cmd.name} ${cmd.argumentHint}` : `/${cmd.name}`;
            const badge =
              cmd.type === 'skill' ? ' [Skill]' :
              cmd.type === 'plugin' ? ' [Plugin]' :
              cmd.type === 'custom' ? ' [Custom]' : '';
            return (
              <Box key={cmd.name} flexDirection="row">
                <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                  {isSelected ? '> ' : '  '}{label}
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
