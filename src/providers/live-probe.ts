import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../config.js';
import { getProviderById } from './index.js';
import type { ProviderCapabilitiesResult } from './openai-responses/provider.js';

export interface LiveProbeResult {
  model: string;
  capabilities: ProviderCapabilitiesResult;
  validated: boolean;
  ok: boolean;
  status: 'success' | 'failed' | 'timeout';
  errorMessage?: string;
  timestamp: Date;
}

export interface LiveProbeAllResult {
  model: string;
  capabilities: ProviderCapabilitiesResult | null;
  validated: boolean;
  ok: boolean;
  status: 'success' | 'failed' | 'timeout';
  errorMessage?: string;
  timestamp: Date;
}

export interface LiveProbeStatus {
  validated: boolean;
  capabilities: ProviderCapabilitiesResult | null;
}

export interface ProbeHistoryEntry {
  providerId: string;
  provider: string;
  model: string;
  result: LiveProbeResult;
  timestamp: string;
}

interface ProbeHistoryStore {
  latestByProfile?: Record<string, unknown>;
  history: ProbeHistoryEntry[];
}

interface CacheEntry {
  result: LiveProbeResult;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 60_000;
const PROBE_HISTORY_PATH = path.join(STORE_DIR, 'provider-probes.json');
const MAX_HISTORY_PER_MODEL = 20;

function readProbeHistory(): ProbeHistoryEntry[] {
  try {
    const raw = fs.readFileSync(PROBE_HISTORY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as ProbeHistoryStore).history)
    ) {
      return (parsed as ProbeHistoryStore).history;
    }
    return [];
  } catch {
    return [];
  }
}

function writeProbeHistory(entries: ProbeHistoryEntry[]): void {
  let latestByProfile: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(PROBE_HISTORY_PATH, 'utf-8'));
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      parsed.latestByProfile &&
      typeof parsed.latestByProfile === 'object'
    ) {
      latestByProfile = parsed.latestByProfile as Record<string, unknown>;
    }
  } catch {}
  fs.mkdirSync(path.dirname(PROBE_HISTORY_PATH), { recursive: true });
  fs.writeFileSync(
    PROBE_HISTORY_PATH,
    `${JSON.stringify({ latestByProfile, history: entries }, null, 2)}\n`,
  );
}

function pruneHistory(
  entries: ProbeHistoryEntry[],
  providerId: string,
  model: string,
): ProbeHistoryEntry[] {
  const other = entries.filter(
    (e) => e.providerId !== providerId || e.model !== model,
  );
  const self = entries
    .filter((e) => e.providerId === providerId && e.model === model)
    .slice(-(MAX_HISTORY_PER_MODEL - 1));
  return [...other, ...self];
}

export class LiveProbeService {
  private cache = new Map<string, CacheEntry>();
  private cacheTtlMs: number;

  constructor(options?: { cacheTtlMs?: number }) {
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  private cacheKey(providerId: string, model: string): string {
    return `${providerId}:${model}`;
  }

  private getCached(providerId: string, model: string): LiveProbeResult | null {
    const key = this.cacheKey(providerId, model);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(
    providerId: string,
    model: string,
    result: LiveProbeResult,
  ): void {
    const key = this.cacheKey(providerId, model);
    this.cache.set(key, { result, expiresAt: Date.now() + this.cacheTtlMs });
  }

  private appendHistory(
    providerId: string,
    model: string,
    result: LiveProbeResult,
  ): void {
    const entries = readProbeHistory();
    const entry: ProbeHistoryEntry = {
      providerId,
      provider: providerId,
      model,
      result,
      timestamp: new Date().toISOString(),
    };
    const pruned = pruneHistory(entries, providerId, model);
    pruned.push(entry);
    writeProbeHistory(pruned);
  }

  getCachedProbe(providerId: string, model: string): LiveProbeResult | null {
    return this.getCached(providerId, model);
  }

  getProbeHistory(
    providerId?: string,
    model?: string,
    limit?: number,
  ): ProbeHistoryEntry[] {
    const entries = readProbeHistory();
    let filtered = entries;
    if (providerId) {
      filtered = filtered.filter((e) => e.providerId === providerId);
    }
    if (model) {
      filtered = filtered.filter((e) => e.model === model);
    }
    const cap = limit ?? MAX_HISTORY_PER_MODEL;
    return filtered.slice(-cap);
  }

  clearCache(providerId?: string, model?: string): void {
    if (providerId && model) {
      this.cache.delete(this.cacheKey(providerId, model));
    } else if (providerId) {
      const prefix = `${providerId}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) this.cache.delete(key);
      }
    } else {
      this.cache.clear();
    }
  }

  async probeModel(
    providerId: string,
    model: string,
  ): Promise<LiveProbeResult> {
    const cached = this.getCached(providerId, model);
    if (cached) return cached;

    const provider = getProviderById(providerId);
    if (!provider) {
      const result: LiveProbeResult = {
        model,
        capabilities: {
          toolCalls: false,
          structuredOutput: false,
          streaming: false,
          vision: false,
          codeStrength: 'low',
          contextWindow: 0,
          costTier: 'low',
          privacyTier: 'low',
          supportsMcpStrategy: false,
        },
        validated: false,
        ok: false,
        status: 'failed',
        errorMessage: `Provider '${providerId}' not found in registry`,
        timestamp: new Date(),
      };
      this.setCache(providerId, model, result);
      this.appendHistory(providerId, model, result);
      return result;
    }

    try {
      const [validated, capabilities] = await Promise.all([
        provider.validateModel(model),
        provider.getCapabilities(model),
      ]);

      const result: LiveProbeResult = {
        model,
        capabilities,
        validated,
        ok: validated,
        status: 'success',
        timestamp: new Date(),
      };
      this.setCache(providerId, model, result);
      this.appendHistory(providerId, model, result);
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const result: LiveProbeResult = {
        model,
        capabilities: {
          toolCalls: false,
          structuredOutput: false,
          streaming: false,
          vision: false,
          codeStrength: 'low',
          contextWindow: 0,
          costTier: 'low',
          privacyTier: 'low',
          supportsMcpStrategy: false,
        },
        validated: false,
        ok: false,
        status: 'failed',
        errorMessage,
        timestamp: new Date(),
      };
      this.appendHistory(providerId, model, result);
      const key = this.cacheKey(providerId, model);
      this.cache.set(key, {
        result,
        expiresAt: Date.now() + Math.min(this.cacheTtlMs, 5000),
      });
      return result;
    }
  }

  async probeAllModels(
    providerId: string,
    models: string[],
  ): Promise<LiveProbeAllResult[]> {
    const results = await Promise.allSettled(
      models.map((model) => this.probeModel(providerId, model)),
    );

    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        model: models[i],
        capabilities: null,
        validated: false,
        ok: false,
        status: 'failed' as const,
        errorMessage:
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        timestamp: new Date(),
      };
    });
  }

  async getLiveProbeStatus(
    providerId: string,
    model: string,
  ): Promise<LiveProbeStatus> {
    const cached = this.getCached(providerId, model);
    if (cached) {
      return { validated: cached.validated, capabilities: cached.capabilities };
    }

    const provider = getProviderById(providerId);
    if (!provider) {
      return { validated: false, capabilities: null };
    }

    try {
      const [validated, capabilities] = await Promise.all([
        provider.validateModel(model),
        provider.getCapabilities(model),
      ]);

      const result: LiveProbeResult = {
        model,
        capabilities,
        validated,
        ok: validated,
        status: 'success',
        timestamp: new Date(),
      };
      this.setCache(providerId, model, result);
      return { validated, capabilities };
    } catch {
      return { validated: false, capabilities: null };
    }
  }
}

export const liveProbeService = new LiveProbeService();
