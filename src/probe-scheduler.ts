import { liveProbeService as _liveProbeService } from './providers/live-probe.js';
import {
  loadProviderProfiles,
  runLiveProviderProbe,
  getStoredProviderProbes,
} from './provider-router.js';
import { logger } from './logger.js';

let probeSchedulerRunning = false;
let probeTimer: ReturnType<typeof setTimeout> | null = null;

export const PROBE_INTERVAL_MS = 5 * 60 * 1000;

export interface ProbeHealthEntry {
  profileId: string;
  provider: string;
  model: string;
  purpose: string;
  location: 'local' | 'remote';
  ok: boolean;
  lastProbeAt: string | null;
  latencyMs?: number;
  errorMessage?: string;
  capabilities: string[];
  capabilityFlags: {
    tools: boolean;
    json: boolean;
    stream: boolean;
    vision: boolean;
  };
  stale: boolean;
}

export interface ProbeHealthData {
  entries: ProbeHealthEntry[];
  version: number;
  generatedAt: string;
  summary: ProbeHealthSummary;
}

export interface ProbeHealthSummary {
  total: number;
  ok: number;
  failed: number;
  stale: number;
  local: {
    total: number;
    ok: number;
    failed: number;
  };
  remote: {
    total: number;
    ok: number;
    failed: number;
  };
  averageLatencyMs: number | null;
}

const PROBE_STALE_MS = 15 * 60 * 1000;

function emptySummary(): ProbeHealthSummary {
  return {
    total: 0,
    ok: 0,
    failed: 0,
    stale: 0,
    local: { total: 0, ok: 0, failed: 0 },
    remote: { total: 0, ok: 0, failed: 0 },
    averageLatencyMs: null,
  };
}

let healthData: ProbeHealthData = {
  entries: [],
  version: 0,
  generatedAt: new Date(0).toISOString(),
  summary: emptySummary(),
};

function providerLocation(provider: string): 'local' | 'remote' {
  return provider === 'ollama' ? 'local' : 'remote';
}

function isStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed > PROBE_STALE_MS;
}

function capabilityTags(
  probe: ReturnType<typeof getStoredProviderProbes>[string] | null,
): string[] {
  const caps: string[] = [];
  if (probe?.capabilities) {
    if (probe.capabilities.tool_calls) caps.push('tools');
    if (probe.capabilities.structured_output) caps.push('json');
    if (probe.capabilities.streaming) caps.push('stream');
    if (probe.capabilities.vision) caps.push('vision');
  }
  return caps;
}

function capabilityFlags(
  capabilities: string[],
): ProbeHealthEntry['capabilityFlags'] {
  return {
    tools: capabilities.includes('tools'),
    json: capabilities.includes('json'),
    stream: capabilities.includes('stream'),
    vision: capabilities.includes('vision'),
  };
}

function buildSummary(entries: ProbeHealthEntry[]): ProbeHealthSummary {
  const summary = emptySummary();
  summary.total = entries.length;
  summary.ok = entries.filter((entry) => entry.ok).length;
  summary.failed = summary.total - summary.ok;
  summary.stale = entries.filter((entry) => entry.stale).length;
  const latencies = entries
    .map((entry) => entry.latencyMs)
    .filter((latency): latency is number => Number.isFinite(latency));
  summary.averageLatencyMs = latencies.length
    ? Math.round(
        latencies.reduce((total, latency) => total + latency, 0) /
          latencies.length,
      )
    : null;
  for (const location of ['local', 'remote'] as const) {
    const scoped = entries.filter((entry) => entry.location === location);
    summary[location].total = scoped.length;
    summary[location].ok = scoped.filter((entry) => entry.ok).length;
    summary[location].failed = summary[location].total - summary[location].ok;
  }
  return summary;
}

function collectHealth(): ProbeHealthEntry[] {
  const profiles = loadProviderProfiles();
  const stored = getStoredProviderProbes();
  return profiles.map((profile) => {
    const probe = stored[profile.id] ?? null;
    const capabilities = capabilityTags(probe);
    const lastProbeAt = probe?.lastProbeAt ?? null;
    return {
      profileId: profile.id,
      provider: profile.provider,
      model: profile.model,
      purpose: profile.purpose || profile.id,
      location: providerLocation(profile.provider),
      ok: probe?.ok ?? false,
      lastProbeAt,
      latencyMs: probe?.latencyMs,
      errorMessage: probe?.errors?.[0],
      capabilities,
      capabilityFlags: capabilityFlags(capabilities),
      stale: isStale(lastProbeAt),
    };
  });
}

export function getProbeHealth(): ProbeHealthData {
  return {
    entries: healthData.entries,
    version: healthData.version,
    generatedAt: healthData.generatedAt,
    summary: healthData.summary,
  };
}

export function refreshProbeHealth(): void {
  const entries = collectHealth();
  healthData = {
    entries,
    version: healthData.version + 1,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(entries),
  };
}

export async function runAllProbes(): Promise<ProbeHealthData> {
  const profiles = loadProviderProfiles();
  const entries: ProbeHealthEntry[] = [];

  for (const profile of profiles) {
    try {
      const probe = await runLiveProviderProbe(profile);
      const capabilities = capabilityTags(probe);
      const lastProbeAt = probe.lastProbeAt ?? null;
      entries.push({
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        purpose: profile.purpose || profile.id,
        location: providerLocation(profile.provider),
        ok: probe.ok ?? false,
        lastProbeAt,
        latencyMs: probe.latencyMs,
        errorMessage: probe.errors?.[0],
        capabilities,
        capabilityFlags: capabilityFlags(capabilities),
        stale: isStale(lastProbeAt),
      });
    } catch (err) {
      logger.error(
        { err, profile: profile.id },
        'Probe scheduler: profile probe failed',
      );
      entries.push({
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        purpose: profile.purpose || profile.id,
        location: providerLocation(profile.provider),
        ok: false,
        lastProbeAt: new Date().toISOString(),
        latencyMs: undefined,
        errorMessage: err instanceof Error ? err.message : String(err),
        capabilities: [],
        capabilityFlags: capabilityFlags([]),
        stale: false,
      });
    }
  }

  healthData = {
    entries,
    version: healthData.version + 1,
    generatedAt: new Date().toISOString(),
    summary: buildSummary(entries),
  };
  return healthData;
}

export function startProbeScheduler(
  broadcast?: (data: ProbeHealthData) => void,
): void {
  if (probeSchedulerRunning) {
    logger.debug('Probe scheduler already running, skipping duplicate start');
    return;
  }
  probeSchedulerRunning = true;
  logger.info({ intervalMs: PROBE_INTERVAL_MS }, 'Probe scheduler started');

  const loop = async () => {
    try {
      const data = await runAllProbes();
      logger.info(
        { count: data.entries.length },
        'Probe scheduler cycle completed',
      );
      if (broadcast) {
        broadcast(data);
      }
    } catch (err) {
      logger.error({ err }, 'Probe scheduler cycle failed');
    }
    probeTimer = setTimeout(loop, PROBE_INTERVAL_MS);
  };

  loop();
}

export function stopProbeScheduler(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
  probeSchedulerRunning = false;
  logger.info('Probe scheduler stopped');
}

export function _resetProbeSchedulerForTests(): void {
  stopProbeScheduler();
  healthData = {
    entries: [],
    version: 0,
    generatedAt: new Date(0).toISOString(),
    summary: emptySummary(),
  };
}
