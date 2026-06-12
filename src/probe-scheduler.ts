import { liveProbeService } from './providers/live-probe.js';
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
  ok: boolean;
  lastProbeAt: string | null;
  errorMessage?: string;
  capabilities: string[];
}

export interface ProbeHealthData {
  entries: ProbeHealthEntry[];
  version: number;
}

let healthData: ProbeHealthData = { entries: [], version: 0 };

function collectHealth(): ProbeHealthEntry[] {
  const profiles = loadProviderProfiles();
  const stored = getStoredProviderProbes();
  return profiles.map((profile) => {
    const probe = stored[profile.id] ?? null;
    const caps: string[] = [];
    if (probe?.capabilities) {
      if (probe.capabilities.tool_calls) caps.push('tools');
      if (probe.capabilities.structured_output) caps.push('json');
      if (probe.capabilities.streaming) caps.push('stream');
      if (probe.capabilities.vision) caps.push('vision');
    }
    return {
      profileId: profile.id,
      provider: profile.provider,
      model: profile.model,
      purpose: profile.purpose || profile.id,
      ok: probe?.ok ?? false,
      lastProbeAt: probe?.lastProbeAt ?? null,
      errorMessage: probe?.errors?.[0],
      capabilities: caps,
    };
  });
}

export function getProbeHealth(): ProbeHealthData {
  return { entries: healthData.entries, version: healthData.version };
}

export function refreshProbeHealth(): void {
  healthData = {
    entries: collectHealth(),
    version: healthData.version + 1,
  };
}

export async function runAllProbes(): Promise<ProbeHealthData> {
  const profiles = loadProviderProfiles();
  const entries: ProbeHealthEntry[] = [];

  for (const profile of profiles) {
    try {
      const probe = await runLiveProviderProbe(profile);
      const caps: string[] = [];
      if (probe.capabilities) {
        if (probe.capabilities.tool_calls) caps.push('tools');
        if (probe.capabilities.structured_output) caps.push('json');
        if (probe.capabilities.streaming) caps.push('stream');
        if (probe.capabilities.vision) caps.push('vision');
      }
      entries.push({
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        purpose: profile.purpose || profile.id,
        ok: probe.ok ?? false,
        lastProbeAt: probe.lastProbeAt ?? null,
        errorMessage: probe.errors?.[0],
        capabilities: caps,
      });
    } catch (err) {
      logger.error({ err, profile: profile.id }, 'Probe scheduler: profile probe failed');
      entries.push({
        profileId: profile.id,
        provider: profile.provider,
        model: profile.model,
        purpose: profile.purpose || profile.id,
        ok: false,
        lastProbeAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
        capabilities: [],
      });
    }
  }

  healthData = { entries, version: healthData.version + 1 };
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
      logger.info({ count: data.entries.length }, 'Probe scheduler cycle completed');
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
  healthData = { entries: [], version: 0 };
}
