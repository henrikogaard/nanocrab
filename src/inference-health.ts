import { getProviderAvailability } from './agent-provider.js';
import {
  loadProviderProfiles,
  probeAllProviderProfiles,
  ProviderProbeResult,
  ProviderProfile,
} from './provider-router.js';

export interface InferenceHealthItem {
  profileId: string;
  label: string;
  provider: string;
  model: string;
  locality: 'local' | 'remote';
  configured: boolean;
  ok: boolean;
  status: 'healthy' | 'stale' | 'degraded' | 'unconfigured';
  lastProbeAt: string | null;
  failedChecks: string[];
  toolPolicy: string;
}

export interface InferenceHealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  local: number;
  remote: number;
  stale: number;
}

function isLocalProfile(profile: ProviderProfile): boolean {
  if (profile.provider === 'ollama') return true;
  const baseUrl = profile.baseUrl || '';
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/.test(baseUrl);
}

function isStale(probe: ProviderProbeResult | undefined): boolean {
  if (!probe?.lastProbeAt) return true;
  return Date.now() - Date.parse(probe.lastProbeAt) > 24 * 60 * 60 * 1000;
}

export function buildInferenceHealth(): {
  summary: InferenceHealthSummary;
  items: InferenceHealthItem[];
} {
  const availability = getProviderAvailability();
  const probesById = new Map(
    probeAllProviderProfiles()
      .filter((probe) => probe.profileId)
      .map((probe) => [probe.profileId!, probe]),
  );
  const items = loadProviderProfiles().map((profile): InferenceHealthItem => {
    const probe = probesById.get(profile.id);
    const configured = availability[profile.provider] === true;
    const stale = isStale(probe);
    const failedChecks = (probe?.checks || [])
      .filter((check) => !check.ok)
      .map((check) => check.detail || check.label);
    const ok = configured && probe?.ok === true && failedChecks.length === 0;
    const status = !configured
      ? 'unconfigured'
      : ok && !stale
        ? 'healthy'
        : stale
          ? 'stale'
          : 'degraded';
    return {
      profileId: profile.id,
      label: profile.label,
      provider: profile.provider,
      model: profile.model,
      locality: isLocalProfile(profile) ? 'local' : 'remote',
      configured,
      ok,
      status,
      lastProbeAt: probe?.lastProbeAt || null,
      failedChecks,
      toolPolicy: profile.toolPolicy,
    };
  });
  const summary = {
    total: items.length,
    healthy: items.filter((item) => item.status === 'healthy').length,
    degraded: items.filter((item) =>
      ['degraded', 'unconfigured'].includes(item.status),
    ).length,
    local: items.filter((item) => item.locality === 'local').length,
    remote: items.filter((item) => item.locality === 'remote').length,
    stale: items.filter((item) => item.status === 'stale').length,
  };
  return { summary, items };
}
