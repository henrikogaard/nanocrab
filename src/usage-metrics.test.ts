import { describe, expect, it } from 'vitest';

import { summarizeModelMetrics } from './admin/routes/usage.js';

describe('usage model metrics', () => {
  it('summarizes cost, latency, context, and reliability by model', () => {
    const metrics = summarizeModelMetrics([
      {
        timestamp: '2026-06-10T00:00:00.000Z',
        provider: 'openrouter',
        service: 'chat',
        model: 'openrouter/auto',
        estimatedCost: 0.12,
        durationMs: 1200,
        inputTokens: 1000,
        outputTokens: 200,
        contextTokens: 3000,
        success: true,
      },
      {
        timestamp: '2026-06-10T00:02:00.000Z',
        provider: 'openrouter',
        service: 'chat',
        model: 'openrouter/auto',
        estimatedCost: 0.08,
        durationMs: 1800,
        inputTokens: 800,
        outputTokens: 150,
        contextTokens: 2800,
        error: 'rate limited',
      },
    ]);

    expect(metrics).toEqual([
      expect.objectContaining({
        provider: 'openrouter',
        model: 'openrouter/auto',
        calls: 2,
        failures: 1,
        successRate: 50,
        totalCost: 0.2,
        avgLatencyMs: 1500,
        contextTokens: 3000,
        lastError: 'rate limited',
      }),
    ]);
  });
});
