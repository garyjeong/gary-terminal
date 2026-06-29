import { useState, useEffect } from 'react';

// Braille spinner frames — classic 10-frame sequence
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const INTERVAL_MS = 100;

/**
 * Returns the current spinner frame character.
 * Only ticks when `active` is true; clears the interval on deactivation.
 */
export function useSpinner(active: boolean): string {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [active]);

  return FRAMES[frameIndex] ?? '⠋';
}
