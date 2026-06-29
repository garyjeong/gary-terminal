import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', 'build', 'coverage',
  '.cache', '__pycache__', '.tox', 'target', 'out', '.turbo',
]);

export const MAX_FILES = 5000;

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

export interface ScanResult {
  files: string[];      // relative paths from cwd
  truncated: boolean;   // true when MAX_FILES cap was hit
}

/**
 * Synchronously scan all files in cwd (iterative DFS).
 * Ignores: hidden files/dirs (starting with '.'), IGNORE_DIRS, symlinks.
 * Caps at MAX_FILES entries and sets truncated=true if exceeded.
 */
export function scanFilesSync(cwd: string): ScanResult {
  const files: string[] = [];
  const stack: string[] = [cwd];
  let truncated = false;

  outer: while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Skip hidden entries
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        stack.push(fullPath);
      } else if (entry.isFile()) {
        if (files.length >= MAX_FILES) {
          truncated = true;
          break outer;
        }
        files.push(path.relative(cwd, fullPath));
      }
    }
  }

  return { files, truncated };
}

// ---------------------------------------------------------------------------
// Fuzzy matching / scoring
// ---------------------------------------------------------------------------

/**
 * Compute a fuzzy match score for filePath against query.
 * Returns 0 if no match (all query chars must appear in order in path).
 */
function fuzzyScore(filePath: string, query: string): number {
  const lower = filePath.toLowerCase();
  const q = query.toLowerCase();

  // Fast check: all chars must appear in order (basic fuzzy requirement)
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  if (qi < q.length) return 0;

  // Compute richer score
  let score = 100;
  qi = 0;
  let consecutive = 0;

  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      score += 5;
      // Word-boundary bonus
      const prev = i > 0 ? lower[i - 1]! : '';
      if (i === 0 || '/-_. '.includes(prev)) score += 10;
      // Consecutive bonus (accumulates)
      score += consecutive * 2;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }

  // Basename bonuses (prefer a match in the filename over the path)
  const basename = path.basename(filePath).toLowerCase();
  if (basename === q) score += 150;
  else if (basename.startsWith(q)) score += 80;
  else if (basename.includes(q)) score += 30;

  // Small penalty for depth (shorter paths rank higher when equal)
  const depth = filePath.split(path.sep).length;
  score -= depth * 2;

  return score;
}

/**
 * Filter and rank files by fuzzy match score against query.
 * Returns at most `max` results (default 8).
 */
export function filterFiles(files: string[], query: string, max = 8): string[] {
  if (!query) return files.slice(0, max);

  const scored: Array<{ file: string; score: number }> = [];
  for (const file of files) {
    const score = fuzzyScore(file, query);
    if (score > 0) scored.push({ file, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.file);
}
