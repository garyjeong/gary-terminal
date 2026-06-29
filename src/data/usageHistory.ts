import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { createReadStream } from 'fs';

export interface ModelBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface UsageHistory {
  todayCostUsd: number;
  monthCostUsd: number;
  todayTokens: number;
  monthTokens: number;
  byModel: ModelBreakdown[];
  isEstimate: boolean;
  scannedAt: Date;
}

// Pricing table: [input$/M, output$/M, cacheWrite$/M, cacheRead$/M] — estimates
const PRICING: ReadonlyArray<readonly [string, readonly [number, number, number, number]]> = [
  ['claude-opus-4', [15, 75, 18.75, 1.875]],
  ['claude-opus', [15, 75, 18.75, 1.875]],
  ['claude-sonnet-4', [3, 15, 3.75, 0.30]],
  ['claude-sonnet', [3, 15, 3.75, 0.30]],
  ['claude-haiku', [0.80, 4, 1.0, 0.08]],
] as const;

const DEFAULT_PRICING: readonly [number, number, number, number] = [3, 15, 3.75, 0.30];

function getPricing(model: string): readonly [number, number, number, number] {
  for (const [prefix, price] of PRICING) {
    if (model.startsWith(prefix)) return price;
  }
  return DEFAULT_PRICING;
}

interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

function computeCost(model: string, usage: UsageFields): number {
  const [inputRate, outputRate, cacheWriteRate, cacheReadRate] = getPricing(model);
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (input / 1_000_000) * inputRate +
    (output / 1_000_000) * outputRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (cacheRead / 1_000_000) * cacheReadRate
  );
}

async function findJsonlFiles(dir: string, cutoff: Date): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await findJsonlFiles(fullPath, cutoff);
        results.push(...sub);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.mtime >= cutoff) {
            results.push(fullPath);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // directory doesn't exist or not readable
  }
  return results;
}

interface UsageRecord {
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

async function parseJsonlFile(filePath: string): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  try {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj['type'] !== 'assistant') continue;

        const message = obj['message'] as Record<string, unknown> | undefined;
        if (!message) continue;

        const usage = message['usage'] as UsageFields | undefined;
        if (!usage) continue;

        // Model can be on message or on the top-level record
        const model =
          (message['model'] as string | undefined) ??
          (obj['model'] as string | undefined) ??
          '';
        if (!model) continue;

        const timestamp = (obj['timestamp'] as string | undefined) ?? '';
        const inputTokens = (usage.input_tokens ?? 0);
        const outputTokens = (usage.output_tokens ?? 0);
        const costUsd = computeCost(model, usage);

        records.push({ timestamp, model, inputTokens, outputTokens, costUsd });
      } catch {
        // malformed JSON line — skip
      }
    }
  } catch {
    // file read error — skip
  }
  return records;
}

export async function aggregateUsageHistory(): Promise<UsageHistory> {
  const home = os.homedir();
  const projectsDir = path.join(home, '.claude', 'projects');
  const now = new Date();
  const cutoff = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);

  const todayStr = now.toISOString().slice(0, 10);  // YYYY-MM-DD
  const monthStr = now.toISOString().slice(0, 7);   // YYYY-MM

  const files = await findJsonlFiles(projectsDir, cutoff);

  let todayCostUsd = 0;
  let monthCostUsd = 0;
  let todayTokens = 0;
  let monthTokens = 0;
  const modelMap = new Map<string, ModelBreakdown>();

  for (const file of files) {
    const records = await parseJsonlFile(file);
    for (const record of records) {
      const dateStr = record.timestamp.slice(0, 10);
      const monthOfRecord = record.timestamp.slice(0, 7);
      const recordTokens = record.inputTokens + record.outputTokens;

      if (dateStr === todayStr) {
        todayCostUsd += record.costUsd;
        todayTokens += recordTokens;
      }
      if (monthOfRecord === monthStr) {
        monthCostUsd += record.costUsd;
        monthTokens += recordTokens;
      }

      const existing = modelMap.get(record.model);
      if (existing) {
        existing.inputTokens += record.inputTokens;
        existing.outputTokens += record.outputTokens;
        existing.costUsd += record.costUsd;
      } else {
        modelMap.set(record.model, {
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          costUsd: record.costUsd,
        });
      }
    }
  }

  const byModel = Array.from(modelMap.values()).sort((a, b) => b.costUsd - a.costUsd);

  return {
    todayCostUsd,
    monthCostUsd,
    todayTokens,
    monthTokens,
    byModel,
    isEstimate: true,
    scannedAt: now,
  };
}
