import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitWindow {
  utilization: number; // 0-100
  resetsAt: string;    // ISO 8601
}

export interface ClaudeUsage {
  fiveHour: RateLimitWindow;
  sevenDay?: RateLimitWindow;
  sevenDaySonnet?: RateLimitWindow;
  subscriptionType: string;
  fetchedAt: number; // Date.now()
}

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

let _cache: ClaudeUsage | null = null;
let _cacheTime = 0;
let _retryAfter = 0;

const CACHE_TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Token procurement
// ---------------------------------------------------------------------------

interface CredentialsJson {
  claudeAiOauth?: {
    accessToken?: string;
    subscriptionType?: string;
  };
}

function getOAuthToken(): { token: string; subscriptionType: string } | null {
  // 1) macOS Keychain
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    if (raw) {
      const parsed = JSON.parse(raw) as CredentialsJson;
      const token = parsed.claudeAiOauth?.accessToken;
      if (token) {
        return {
          token,
          subscriptionType: parsed.claudeAiOauth?.subscriptionType ?? 'pro',
        };
      }
    }
  } catch {
    // Keychain unavailable or access denied — fall through
  }

  // 2) ~/.claude/.credentials.json fallback
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const raw = fs.readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw) as CredentialsJson;
    const token = parsed.claudeAiOauth?.accessToken;
    if (token) {
      return {
        token,
        subscriptionType: parsed.claudeAiOauth?.subscriptionType ?? 'pro',
      };
    }
  } catch {
    // ignore
  }

  return null;
}

// ---------------------------------------------------------------------------
// Plan helpers
// ---------------------------------------------------------------------------

/** max / max100 / max200 / team plans expose the 7-day window. */
function isMaxPlan(subscriptionType: string): boolean {
  return (
    subscriptionType.startsWith('max') ||
    subscriptionType === 'team'
  );
}

// ---------------------------------------------------------------------------
// API response shape
// ---------------------------------------------------------------------------

interface UsageWindow {
  utilization?: number;
  resets_at?: string;
}

interface UsageApiResponse {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

export async function fetchClaudeUsage(): Promise<ClaudeUsage | null> {
  const now = Date.now();

  // Serve from cache if fresh
  if (_cache !== null && now - _cacheTime < CACHE_TTL_MS) return _cache;

  // Respect 429 back-off
  if (_retryAfter > now) return _cache;

  const cred = getOAuthToken();
  if (!cred) return null;

  const { token, subscriptionType } = cred;

  try {
    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (resp.status === 429) {
      const retryHeader = resp.headers.get('Retry-After');
      const delayMs = retryHeader ? parseInt(retryHeader, 10) * 1000 : 5 * 60_000;
      _retryAfter = now + delayMs;
      return _cache;
    }

    if (!resp.ok) return _cache;

    const data = (await resp.json()) as UsageApiResponse;

    const fiveHour: RateLimitWindow = {
      utilization: data.five_hour?.utilization ?? 0,
      resetsAt: data.five_hour?.resets_at ?? '',
    };

    const result: ClaudeUsage = {
      fiveHour,
      subscriptionType,
      fetchedAt: now,
    };

    if (isMaxPlan(subscriptionType)) {
      if (data.seven_day) {
        result.sevenDay = {
          utilization: data.seven_day.utilization ?? 0,
          resetsAt: data.seven_day.resets_at ?? '',
        };
      }
      if (data.seven_day_sonnet) {
        result.sevenDaySonnet = {
          utilization: data.seven_day_sonnet.utilization ?? 0,
          resetsAt: data.seven_day_sonnet.resets_at ?? '',
        };
      }
    }

    _cache = result;
    _cacheTime = now;
    _retryAfter = 0;
    return result;
  } catch {
    // Network error — return stale cache
    return _cache;
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format time remaining until reset. */
export function formatResetTime(isoTime: string): string {
  if (!isoTime) return '';
  const target = new Date(isoTime).getTime();
  const diffMs = target - Date.now();
  if (diffMs <= 0) return '곧';
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

/** Map utilization percentage to an ink color string. */
export function utilizationColor(pct: number): string {
  if (pct >= 90) return 'red';
  if (pct >= 75) return 'yellow';
  if (pct >= 50) return 'yellowBright';
  return 'green';
}

/** Render a compact ASCII bar (width chars wide). */
export function utilizationBar(pct: number, width = 10): string {
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
