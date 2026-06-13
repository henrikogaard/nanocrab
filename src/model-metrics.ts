import {
  getProviderProbeHistory,
  getStoredProviderProbes,
  type ProviderProbeHistoryEntry,
  type ProviderProbeResult,
} from './provider-router.js';

export interface ModelMetricRow {
  provider: string;
  model: string;
  profileIds: string[];
  sampleCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  contextWindow: number | null;
  costTier: string;
  lastProbeAt: string | null;
  lastError: string | null;
}

export interface ModelMetricsSummary {
  totalModels: number;
  healthyModels: number;
  degradedModels: number;
  averageSuccessRate: number | null;
  averageLatencyMs: number | null;
}

export interface ModelMetricsData {
  generatedAt: string;
  summary: ModelMetricsSummary;
  models: ModelMetricRow[];
}

function finiteLatency(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function percentile(values: number[], percentileRank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

function latestByTimestamp<
  T extends { timestamp?: string; lastProbeAt?: string },
>(entries: T[]): T | undefined {
  return entries
    .slice()
    .sort((a, b) =>
      String(b.timestamp || b.lastProbeAt || '').localeCompare(
        String(a.timestamp || a.lastProbeAt || ''),
      ),
    )[0];
}

function buildSummary(models: ModelMetricRow[]): ModelMetricsSummary {
  const successRates = models.map((model) => model.successRate);
  const latencies = models
    .map((model) => model.averageLatencyMs)
    .filter(finiteLatency);
  return {
    totalModels: models.length,
    healthyModels: models.filter((model) => model.successRate >= 0.8).length,
    degradedModels: models.filter((model) => model.successRate < 0.8).length,
    averageSuccessRate: successRates.length
      ? Number(
          (
            successRates.reduce((total, rate) => total + rate, 0) /
            successRates.length
          ).toFixed(3),
        )
      : null,
    averageLatencyMs: latencies.length
      ? Math.round(
          latencies.reduce((total, latency) => total + latency, 0) /
            latencies.length,
        )
      : null,
  };
}

export function buildModelMetricsData(
  history: ProviderProbeHistoryEntry[],
  latestByProfile: Record<string, ProviderProbeResult>,
  now = new Date(),
): ModelMetricsData {
  const grouped = new Map<string, ProviderProbeHistoryEntry[]>();
  for (const entry of history) {
    if (!entry.provider || !entry.model) continue;
    const key = `${entry.provider}\u0000${entry.model}`;
    grouped.set(key, [...(grouped.get(key) || []), entry]);
  }

  for (const [profileId, probe] of Object.entries(latestByProfile)) {
    if (!probe.provider || !probe.model) continue;
    const key = `${probe.provider}\u0000${probe.model}`;
    if (!grouped.has(key)) {
      grouped.set(key, [
        {
          profileId: profileId as ProviderProbeHistoryEntry['profileId'],
          provider: probe.provider,
          model: probe.model,
          ok: probe.ok,
          latencyMs: probe.latencyMs,
          streaming: probe.capabilities?.streaming,
          streamingSupport: probe.capabilities?.streaming ?? false,
          toolSupport: probe.capabilities?.tool_calls ?? false,
          schemaSupport: probe.capabilities?.structured_output ?? false,
          visionSupport: probe.capabilities?.vision ?? false,
          contextWindow: probe.capabilities?.context_window ?? 0,
          errorDetail: probe.errorDetail || probe.errors?.[0],
          timestamp: probe.lastProbeAt || now.toISOString(),
        },
      ]);
    }
  }

  const models: ModelMetricRow[] = Array.from(grouped.entries()).map(
    ([key, entries]) => {
      const [provider, model] = key.split('\u0000');
      const latestHistory = latestByTimestamp(entries);
      const latestProbe = Object.entries(latestByProfile)
        .filter(
          ([, probe]) => probe.provider === provider && probe.model === model,
        )
        .map(([profileId, probe]) => ({ ...probe, profileId }))
        .sort((a, b) =>
          String(b.lastProbeAt || '').localeCompare(
            String(a.lastProbeAt || ''),
          ),
        )[0];
      const latencies = entries
        .map((entry) => entry.latencyMs)
        .filter(finiteLatency);
      const successCount = entries.filter((entry) => entry.ok).length;
      const historyProfileIds = entries
        .map((entry) => entry.profileId)
        .filter(Boolean)
        .map((profileId) => String(profileId));
      const profileIds: string[] = Array.from(
        new Set(
          latestProbe?.profileId
            ? [...historyProfileIds, latestProbe.profileId]
            : historyProfileIds,
        ),
      ).sort();
      const contextWindow =
        latestProbe?.capabilities?.context_window ||
        latestHistory?.contextWindow ||
        null;
      return {
        provider,
        model,
        profileIds,
        sampleCount: entries.length,
        successCount,
        failureCount: entries.length - successCount,
        successRate: entries.length
          ? Number((successCount / entries.length).toFixed(3))
          : 0,
        averageLatencyMs: latencies.length
          ? Math.round(
              latencies.reduce((total, latency) => total + latency, 0) /
                latencies.length,
            )
          : null,
        p95LatencyMs: percentile(latencies, 95),
        contextWindow:
          contextWindow && contextWindow > 0 ? contextWindow : null,
        costTier: latestProbe?.capabilities?.cost_tier || 'unknown',
        lastProbeAt:
          latestProbe?.lastProbeAt || latestHistory?.timestamp || null,
        lastError: latestProbe
          ? latestProbe.ok
            ? null
            : latestProbe.errorDetail || latestProbe.errors?.[0] || null
          : latestHistory?.errorDetail || null,
      };
    },
  );

  models.sort(
    (a, b) =>
      a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
  );
  return {
    generatedAt: now.toISOString(),
    summary: buildSummary(models),
    models,
  };
}

export function getModelMetricsData(): ModelMetricsData {
  return buildModelMetricsData(
    getProviderProbeHistory(undefined, undefined, 200),
    getStoredProviderProbes(),
  );
}
