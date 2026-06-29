import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodexUsage {
  totalTokens: number;
  todayTokens: number;
  sessionCount: number;
  recentModel: string;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Row type from DB
// ---------------------------------------------------------------------------

interface ThreadRow {
  id: string;
  tokens_used: number | null;
  model: string;
  created_at: number; // unix seconds
}

// ---------------------------------------------------------------------------
// Aggregation helper
// ---------------------------------------------------------------------------

function aggregateRows(rows: ThreadRow[]): CodexUsage {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStartUnix = Math.floor(todayStart.getTime() / 1000);

  let totalTokens = 0;
  let todayTokens = 0;
  let recentModel = 'gpt-5.5';

  if (rows.length > 0) {
    recentModel = rows[0]!.model ?? 'gpt-5.5';
  }

  for (const row of rows) {
    const tokens = row.tokens_used ?? 0;
    totalTokens += tokens;
    if (row.created_at >= todayStartUnix) {
      todayTokens += tokens;
    }
  }

  return {
    totalTokens,
    todayTokens,
    sessionCount: rows.length,
    recentModel,
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

const QUERY = `SELECT id, tokens_used, model, created_at
               FROM threads
               WHERE source='exec' AND model_provider='openai'
               ORDER BY created_at DESC`;

export async function fetchCodexUsage(): Promise<CodexUsage | null> {
  const codexDir = path.join(os.homedir(), '.codex');
  const dbPath = path.join(codexDir, 'state_5.sqlite');

  // No .codex directory → Codex not installed
  if (!fs.existsSync(codexDir)) return null;

  // DB missing → return empty
  if (!fs.existsSync(dbPath)) {
    return { totalTokens: 0, todayTokens: 0, sessionCount: 0, recentModel: 'gpt-5.5', fetchedAt: Date.now() };
  }

  // ── Attempt 1: node:sqlite (Node ≥ 22.5) ──────────────────────────────────
  try {
    const { DatabaseSync } = await import('node:sqlite');
    // Open without write access. We cast because older @types/node may lack `readOnly`.
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare(QUERY).all() as unknown as ThreadRow[];
    db.close();
    return aggregateRows(rows);
  } catch {
    // node:sqlite unavailable or DB locked — fall through to execa
  }

  // ── Attempt 2: sqlite3 CLI via execa ──────────────────────────────────────
  try {
    const { execa } = await import('execa');
    const result = await execa('sqlite3', [dbPath, '-json', QUERY], {
      timeout: 10_000,
    });
    const rows = JSON.parse(result.stdout || '[]') as ThreadRow[];
    return aggregateRows(rows);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Display helper
// ---------------------------------------------------------------------------

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
