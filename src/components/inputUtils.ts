// ─────────────────────────────────────────────────────────────────────────────
// inputUtils — pure, side-effect-free helpers for the controlled InputPane.
//
// Extracted from InputPane.tsx so they can be unit-tested in isolation
// (see scripts/test-input.ts). NO React / ink / store imports here — keep this
// module pure so it runs under plain `tsx`.
// ─────────────────────────────────────────────────────────────────────────────

// ── ANSI helpers (no chalk dep — avoids unlisted transitive dependency) ──────
export const ANSI_INVERSE_ON  = '\x1b[7m';
export const ANSI_INVERSE_OFF = '\x1b[27m';
export const ANSI_DIM_ON      = '\x1b[2m';
export const ANSI_DIM_OFF     = '\x1b[22m';

export function ansiInverse(s: string): string {
  return `${ANSI_INVERSE_ON}${s}${ANSI_INVERSE_OFF}`;
}
export function ansiDim(s: string): string {
  return `${ANSI_DIM_ON}${s}${ANSI_DIM_OFF}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Code-point–aware string utilities
// All string operations use Unicode code points (not UTF-16 code units) so
// Korean syllables, emoji, and other supplementary characters are handled
// correctly as single logical "characters".
// ─────────────────────────────────────────────────────────────────────────────

/** Split a string into an array of Unicode code-point strings. */
export function cpSplit(s: string): string[] {
  return [...s];
}

/** Length in code points (not UTF-16 code units). */
export function cpLen(s: string): number {
  return [...s].length;
}

/**
 * Insert characters at a code-point offset.
 * Returns the new string.
 */
export function cpInsert(s: string, offset: number, chars: string[]): string {
  const arr = cpSplit(s);
  arr.splice(offset, 0, ...chars);
  return arr.join('');
}

/**
 * Delete one code point before `offset`.
 * Returns `[newString, newOffset]`.
 */
export function cpDeleteBefore(s: string, offset: number): [string, number] {
  if (offset <= 0) return [s, offset];
  const arr = cpSplit(s);
  arr.splice(offset - 1, 1);
  return [arr.join(''), offset - 1];
}

/**
 * True when `input` is a printable character (or paste) that should be
 * inserted into the field — i.e. not a control byte (U+0000–U+001F).
 * Korean / emoji / ASCII letters all pass; '\r', '\t', '\x1b' do not.
 */
export function isPrintableInput(input: string): boolean {
  if (!input) return false;
  return (input.codePointAt(0) ?? 0) >= 0x20;
}

/**
 * Render a string with a block cursor at code-point position `offset`.
 * Korean syllables are double-width in the terminal but are treated as single
 * code-point units for cursor positioning. The inverse highlight covers the
 * full double-width cell correctly because terminals handle that automatically.
 */
export function renderWithCursor(s: string, offset: number): string {
  const chars = cpSplit(s);
  let result = '';
  for (let i = 0; i < chars.length; i++) {
    result += i === offset ? ansiInverse(chars[i]!) : chars[i]!;
  }
  // Trailing cursor block when at end
  if (offset >= chars.length) {
    result += ansiInverse(' ');
  }
  return result;
}

/** Render placeholder text: first char highlighted as cursor, rest dimmed. */
export function renderPlaceholder(placeholder: string): string {
  if (!placeholder) return ansiInverse(' ');
  return ansiInverse(placeholder[0]!) + ansiDim(placeholder.slice(1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Autocomplete trigger detection — pure functions over the current value.
// These mirror exactly the logic InputPane uses to decide whether the slash
// command popup or the @ file picker should be active for a given value.
// ─────────────────────────────────────────────────────────────────────────────

export interface TriggerResult {
  /** Whether the trigger is active for this value. */
  active: boolean;
  /** The query string (text after the trigger character). */
  query: string;
}

/**
 * Slash command trigger: active when value starts with '/' and the text after
 * the slash contains no space (e.g. "/cl" → active, query "cl";
 * "/clear x" → inactive).
 */
export function detectSlashTrigger(value: string): TriggerResult {
  if (value.startsWith('/')) {
    const afterSlash = value.slice(1);
    if (!afterSlash.includes(' ')) {
      return { active: true, query: afterSlash };
    }
  }
  return { active: false, query: '' };
}

/**
 * @ file-picker trigger: active when the value does NOT start with a slash
 * command and the text after the last '@' contains no space
 * (e.g. "see @src/comp" → active, query "src/comp"; "@file.ts " → inactive).
 *
 * Note: any value starting with '/' suppresses the file trigger entirely,
 * matching InputPane's "slash takes priority and returns early" behavior.
 */
export function detectFileTrigger(value: string): TriggerResult {
  if (value.startsWith('/')) {
    return { active: false, query: '' };
  }
  const lastAtIdx = value.lastIndexOf('@');
  if (lastAtIdx !== -1) {
    const afterAt = value.slice(lastAtIdx + 1);
    if (!afterAt.includes(' ')) {
      return { active: true, query: afterAt };
    }
  }
  return { active: false, query: '' };
}
