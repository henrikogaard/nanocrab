import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { DATA_DIR, STORE_DIR } from '../../config.js';

const router = Router();

// Pricing per million tokens (Anthropic Claude Sonnet)
const PRICE_INPUT = 3.0;
const PRICE_OUTPUT = 15.0;
const PRICE_CACHE_WRITE = 3.75;
const PRICE_CACHE_READ = 0.3;

interface DailyUsage {
  date: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  estimatedCost: number;
}

interface GroupUsage {
  group: string;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  cost: number;
}

function estimateCost(
  input: number,
  output: number,
  cacheWrite: number,
  cacheRead: number,
): number {
  return (
    (input / 1_000_000) * PRICE_INPUT +
    (output / 1_000_000) * PRICE_OUTPUT +
    (cacheWrite / 1_000_000) * PRICE_CACHE_WRITE +
    (cacheRead / 1_000_000) * PRICE_CACHE_READ
  );
}

async function scanTranscripts(): Promise<{
  daily: DailyUsage[];
  totals: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
    cost: number;
  };
  byGroup: GroupUsage[];
}> {
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  const dailyMap = new Map<
    string,
    { input: number; output: number; cacheWrite: number; cacheRead: number }
  >();
  const groupMap = new Map<
    string,
    { input: number; output: number; cacheWrite: number; cacheRead: number }
  >();
  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };

  if (!fs.existsSync(sessionsDir)) {
    return { daily: [], totals, byGroup: [] };
  }

  const groupDirs = fs.readdirSync(sessionsDir).filter((d) => {
    try {
      return fs.statSync(path.join(sessionsDir, d)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const group of groupDirs) {
    const transcriptDir = path.join(
      sessionsDir,
      group,
      '.claude',
      'projects',
      '-workspace-group',
    );
    if (!fs.existsSync(transcriptDir)) continue;

    const jsonlFiles: string[] = [];
    // Collect .jsonl files recursively (including subagents)
    const walk = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name));
          } else if (entry.name.endsWith('.jsonl')) {
            jsonlFiles.push(path.join(dir, entry.name));
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    };
    walk(transcriptDir);

    for (const filePath of jsonlFiles) {
      try {
        const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.includes('"usage"')) continue;
          try {
            const obj = JSON.parse(line);
            const usage = obj?.usage;
            if (!usage) continue;

            const input = (usage.input_tokens || 0) as number;
            const output = (usage.output_tokens || 0) as number;
            const cacheWrite = (usage.cache_creation_input_tokens ||
              0) as number;
            const cacheRead = (usage.cache_read_input_tokens || 0) as number;

            // Extract date from timestamp in the line
            const ts = obj.timestamp as string | undefined;
            const date = ts ? ts.slice(0, 10) : 'unknown';

            // Daily aggregation
            const existing = dailyMap.get(date) || {
              input: 0,
              output: 0,
              cacheWrite: 0,
              cacheRead: 0,
            };
            existing.input += input;
            existing.output += output;
            existing.cacheWrite += cacheWrite;
            existing.cacheRead += cacheRead;
            dailyMap.set(date, existing);

            // Group aggregation
            const gExisting = groupMap.get(group) || {
              input: 0,
              output: 0,
              cacheWrite: 0,
              cacheRead: 0,
            };
            gExisting.input += input;
            gExisting.output += output;
            gExisting.cacheWrite += cacheWrite;
            gExisting.cacheRead += cacheRead;
            groupMap.set(group, gExisting);

            // Totals
            totals.input += input;
            totals.output += output;
            totals.cacheWrite += cacheWrite;
            totals.cacheRead += cacheRead;
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  totals.cost = estimateCost(
    totals.input,
    totals.output,
    totals.cacheWrite,
    totals.cacheRead,
  );

  const daily: DailyUsage[] = Array.from(dailyMap.entries())
    .filter(([d]) => d !== 'unknown')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      input: d.input,
      output: d.output,
      cacheWrite: d.cacheWrite,
      cacheRead: d.cacheRead,
      estimatedCost: estimateCost(d.input, d.output, d.cacheWrite, d.cacheRead),
    }));

  const byGroup: GroupUsage[] = Array.from(groupMap.entries())
    .sort(([, a], [, b]) => b.input + b.output - (a.input + a.output))
    .map(([group, g]) => ({
      group,
      input: g.input,
      output: g.output,
      cacheWrite: g.cacheWrite,
      cacheRead: g.cacheRead,
      cost: estimateCost(g.input, g.output, g.cacheWrite, g.cacheRead),
    }));

  return { daily, totals, byGroup };
}

interface ProviderUsageEntry {
  timestamp: string;
  provider: string;
  service: string;
  model: string;
  estimatedCost: number;
  durationMs?: number;
  details?: string;
  prompt?: string;
  size?: string;
}

interface ProviderSummary {
  provider: string;
  service: string;
  count: number;
  totalCost: number;
  entries: ProviderUsageEntry[];
}

function scanProviderUsage(): {
  byProvider: ProviderSummary[];
  dailyCosts: Map<string, number>;
  totalCost: number;
} {
  const usageFiles = [path.join(STORE_DIR, 'provider-usage.jsonl')];

  // Also check group folders for container-logged usage
  const groupsDir = path.join(process.cwd(), 'groups');
  try {
    for (const group of fs.readdirSync(groupsDir)) {
      const f = path.join(groupsDir, group, 'provider-usage.jsonl');
      if (fs.existsSync(f)) usageFiles.push(f);
    }
  } catch {
    /* ignore */
  }

  const entries: ProviderUsageEntry[] = [];

  for (const filePath of usageFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line));
        } catch {
          /* skip */
        }
      }
    } catch {
      /* file doesn't exist */
    }
  }

  // Aggregate by provider+service
  const providerMap = new Map<string, ProviderSummary>();
  const dailyCosts = new Map<string, number>();
  let totalCost = 0;

  for (const e of entries) {
    const key = `${e.provider}:${e.service}`;
    const existing = providerMap.get(key) || {
      provider: e.provider,
      service: e.service,
      count: 0,
      totalCost: 0,
      entries: [],
    };
    existing.count++;
    existing.totalCost += e.estimatedCost || 0;
    existing.entries.push(e);
    providerMap.set(key, existing);

    totalCost += e.estimatedCost || 0;

    const date = e.timestamp?.slice(0, 10) || 'unknown';
    dailyCosts.set(date, (dailyCosts.get(date) || 0) + (e.estimatedCost || 0));
  }

  return {
    byProvider: Array.from(providerMap.values()).sort(
      (a, b) => b.totalCost - a.totalCost,
    ),
    dailyCosts,
    totalCost,
  };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const claude = await scanTranscripts();
    const providers = scanProviderUsage();

    // Merge provider daily costs into claude daily costs
    for (const [date, cost] of providers.dailyCosts) {
      const existing = claude.daily.find((d) => d.date === date);
      if (existing) {
        existing.estimatedCost += cost;
      }
    }

    // Recalculate total
    const combinedTotalCost = claude.totals.cost + providers.totalCost;

    res.json({
      ...claude,
      totals: {
        ...claude.totals,
        cost: combinedTotalCost,
        providerCost: providers.totalCost,
        claudeCost: claude.totals.cost,
      },
      byProvider: providers.byProvider,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to scan usage data' });
  }
});

export default router;
