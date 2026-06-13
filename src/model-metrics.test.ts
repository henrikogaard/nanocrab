import { describe, expect, it } from 'vitest';

import { buildModelMetricsData } from './model-metrics.js';

describe('model metrics', () => {
  it('aggregates cost, latency, context, and reliability by provider/model', () => {
    const metrics = buildModelMetricsData(
      [
        {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: 'openrouter/auto',
          ok: true,
          latencyMs: 100,
          streaming: true,
          streamingSupport: true,
          toolSupport: true,
          schemaSupport: true,
          visionSupport: true,
          contextWindow: 128000,
          timestamp: '2026-06-13T10:00:00.000Z',
        },
        {
          profileId: 'default_reports',
          provider: 'openrouter',
          model: 'openrouter/auto',
          ok: false,
          latencyMs: 250,
          streaming: true,
          streamingSupport: true,
          toolSupport: true,
          schemaSupport: true,
          visionSupport: true,
          contextWindow: 128000,
          errorDetail: 'timeout',
          timestamp: '2026-06-13T10:05:00.000Z',
        },
      ],
      {
        default_chat: {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: 'openrouter/auto',
          ok: true,
          latencyMs: 125,
          lastProbeAt: '2026-06-13T10:10:00.000Z',
          checks: [],
          capabilities: {
            tool_calls: true,
            structured_output: true,
            streaming: true,
            vision: true,
            code_strength: 'agentic',
            context_window: 200000,
            cost_tier: 'medium',
            privacy_tier: 'third-party',
            supports_mcp_strategy: 'container-loop',
          },
        },
      },
      new Date('2026-06-13T10:15:00.000Z'),
    );

    expect(metrics.summary).toMatchObject({
      totalModels: 1,
      healthyModels: 0,
      degradedModels: 1,
      averageSuccessRate: 0.5,
      averageLatencyMs: 175,
    });
    expect(metrics.models[0]).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/auto',
      profileIds: ['default_chat', 'default_reports'],
      sampleCount: 2,
      successCount: 1,
      failureCount: 1,
      successRate: 0.5,
      averageLatencyMs: 175,
      p95LatencyMs: 250,
      contextWindow: 200000,
      costTier: 'medium',
      lastProbeAt: '2026-06-13T10:10:00.000Z',
    });
  });

  it('ignores malformed latency samples and returns empty summaries safely', () => {
    const empty = buildModelMetricsData(
      [
        {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: '',
          ok: false,
          latencyMs: Number.NaN,
          streaming: false,
          streamingSupport: false,
          toolSupport: false,
          schemaSupport: false,
          visionSupport: false,
          contextWindow: 0,
          timestamp: 'bad',
        },
      ],
      {},
      new Date('2026-06-13T10:15:00.000Z'),
    );

    expect(empty.models).toEqual([]);
    expect(empty.summary).toEqual({
      totalModels: 0,
      healthyModels: 0,
      degradedModels: 0,
      averageSuccessRate: null,
      averageLatencyMs: null,
    });
  });

  it('clears stale history errors when the latest probe succeeds', () => {
    const metrics = buildModelMetricsData(
      [
        {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: 'openrouter/auto',
          ok: false,
          latencyMs: 500,
          streaming: true,
          streamingSupport: true,
          toolSupport: true,
          schemaSupport: true,
          visionSupport: true,
          contextWindow: 128000,
          errorDetail: 'old timeout',
          timestamp: '2026-06-13T10:00:00.000Z',
        },
      ],
      {
        default_chat: {
          profileId: 'default_chat',
          provider: 'openrouter',
          model: 'openrouter/auto',
          ok: true,
          latencyMs: 125,
          lastProbeAt: '2026-06-13T10:10:00.000Z',
          checks: [],
          capabilities: {
            tool_calls: true,
            structured_output: true,
            streaming: true,
            vision: true,
            code_strength: 'agentic',
            context_window: 200000,
            cost_tier: 'medium',
            privacy_tier: 'third-party',
            supports_mcp_strategy: 'container-loop',
          },
        },
      },
      new Date('2026-06-13T10:15:00.000Z'),
    );

    expect(metrics.models[0].lastProbeAt).toBe('2026-06-13T10:10:00.000Z');
    expect(metrics.models[0].lastError).toBeNull();
  });
});
