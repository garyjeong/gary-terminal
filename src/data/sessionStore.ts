/**
 * sessionStore — lightweight session index persistence
 *
 * Stores session metadata in ~/.gary-terminal/sessions.json.
 * claude itself persists transcripts in ~/.claude/projects/[project]/*.jsonl;
 * we only maintain this index for the resume UI.
 *
 * Schema: SessionMeta[]  (sorted most-recent-first, capped at MAX_SESSIONS)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMeta {
  sessionId: string;
  title: string;
  cwd: string;
  model: string;
  /** ISO 8601 timestamp of last activity */
  lastActiveAt: string;
  /** Future fork support — always undefined in MVP */
  parentId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_SESSIONS = 50;
const STORE_DIR = path.join(os.homedir(), '.gary-terminal');
const STORE_PATH = path.join(STORE_DIR, 'sessions.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function isSessionMeta(item: unknown): item is SessionMeta {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj['sessionId'] === 'string' &&
    typeof obj['title'] === 'string' &&
    typeof obj['cwd'] === 'string' &&
    typeof obj['model'] === 'string' &&
    typeof obj['lastActiveAt'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load sessions from disk, sorted most-recent-first.
 * Returns [] if file does not exist or is corrupted.
 */
export function loadSessions(): SessionMeta[] {
  try {
    ensureDir();
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isSessionMeta);
    return valid.sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  } catch {
    // Damaged / unreadable file — graceful empty fallback
    return [];
  }
}

/**
 * Insert or update a session by sessionId.
 * Keeps at most MAX_SESSIONS entries, most-recent-first.
 * Silently ignores write errors (non-critical path).
 */
export function upsertSession(meta: SessionMeta): void {
  try {
    ensureDir();
    const sessions = loadSessions();
    const idx = sessions.findIndex((s) => s.sessionId === meta.sessionId);
    if (idx >= 0) {
      sessions[idx] = meta;
    } else {
      sessions.unshift(meta);
    }
    const trimmed = sessions
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))
      .slice(0, MAX_SESSIONS);
    fs.writeFileSync(STORE_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch {
    // Silently ignore write failures
  }
}

// ---------------------------------------------------------------------------
// Display helpers (used by ResumeDialog)
// ---------------------------------------------------------------------------

/**
 * Shorten a cwd path: replace home dir with ~, truncate long tails.
 */
export function shortCwd(cwd: string, maxLen = 32): string {
  const home = os.homedir();
  const rel = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  return rel.length > maxLen ? '…' + rel.slice(-(maxLen - 1)) : rel;
}

/**
 * Human-readable relative time from an ISO timestamp.
 */
export function relativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
