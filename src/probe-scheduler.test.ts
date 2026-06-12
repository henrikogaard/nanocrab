import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./providers/live-probe.js', () => ({
  liveProbeService: {
    probeModel: vi.fn().mockResolvedValue({
      ok: true,
      validated: true,
      status: 'success',
      model: 'test-model',
      capabilities: {
        tool_calls: true,
        structured_output: true,
        streaming: true,
        vision: false,
        code_strength: 'basic',
        context_window: 128000,
        cost_tier: 'standard',
        privacy_tier: 'hosted',
        supports_mcp_strategy: 'none',
      },
      timestamp: new Date().toISOString(),
    }),
    getCachedProbe: vi.fn().mockReturnValue(null),
    clearCache: vi.fn(),
  },
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('./provider-router.js', () => {
  const mockProfiles = [
    { id: 'default_chat', provider: 'openrouter', model: 'openrouter/auto', purpose: 'default_chat' },
    { id: 'default_coding', provider: 'codex', model: 'gpt-5.4', purpose: 'default_coding' },
  ];

  const mockProbes: Record<string, any> = {};

  return {
    loadProviderProfiles: vi.fn().mockReturnValue(mockProfiles),
    getStoredProviderProbes: vi.fn().mockReturnValue(mockProbes),
    runLiveProviderProbe: vi.fn().mockImplementation(
      async () =>
        ({
          ok: true,
          errors: undefined,
          lastProbeAt: new Date().toISOString(),
          capabilities: {
            tool_calls: true,
            structured_output: true,
            streaming: true,
            vision: false,
            code_strength: 'none',
            context_window: 128000,
            cost_tier: 'standard',
            privacy_tier: 'standard',
            supports_mcp_strategy: 'none',
          },
          checks: [],
          live: true,
        }) as any,
    ),
    runLiveCapabilityProbe: vi.fn(),
  };
});

describe('probe-scheduler', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    const providerRouter = await import('./provider-router.js');
    vi.mocked(providerRouter.runLiveProviderProbe).mockReset();
    vi.mocked(providerRouter.runLiveProviderProbe).mockImplementation(
      async () =>
        ({
          ok: true,
          errors: undefined,
          lastProbeAt: new Date().toISOString(),
          capabilities: {
            tool_calls: true,
            structured_output: true,
            streaming: true,
            vision: false,
            code_strength: 'none',
            context_window: 128000,
            cost_tier: 'standard',
            privacy_tier: 'standard',
            supports_mcp_strategy: 'none',
          },
          checks: [],
          live: true,
        }) as any,
    );
    const mod = await import('./probe-scheduler.js');
    mod._resetProbeSchedulerForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('getProbeHealth returns empty when no probes have run', async () => {
    const mod = await import('./probe-scheduler.js');
    const health = mod.getProbeHealth();
    expect(health.entries).toEqual([]);
    expect(health.version).toBe(0);
  });

  it('runAllProbes probes all profiles and returns health data', async () => {
    const mod = await import('./probe-scheduler.js');
    const result = await mod.runAllProbes();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].profileId).toBe('default_chat');
    expect(result.entries[0].ok).toBe(true);
    expect(result.entries[1].profileId).toBe('default_coding');
    expect(result.entries[1].ok).toBe(true);
  });

  it('runAllProbes increments version on each run', async () => {
    const mod = await import('./probe-scheduler.js');
    const first = await mod.runAllProbes();
    const second = await mod.runAllProbes();
    expect(second.version).toBeGreaterThan(first.version);
  });

  it('runAllProbes handles probe failures gracefully', async () => {
    const providerRouter = await import('./provider-router.js');
    vi.mocked(providerRouter.runLiveProviderProbe).mockRejectedValue(
      new Error('Connection refused'),
    );

    const mod = await import('./probe-scheduler.js');
    const result = await mod.runAllProbes();
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].ok).toBe(false);
    expect(result.entries[0].errorMessage).toBe('Connection refused');
  });

  it('getProbeHealth returns latest data after runAllProbes', async () => {
    const mod = await import('./probe-scheduler.js');
    await mod.runAllProbes();
    const health = mod.getProbeHealth();
    expect(health.version).toBe(1);
    expect(health.entries).toHaveLength(2);
  });

  it('probe health entries include capability tags from probe results', async () => {
    // Check that the mock returns capabilities correctly
    const providerRouter = await import('./provider-router.js');
    const mockProbe = await providerRouter.runLiveProviderProbe(
      null as any,
    );
    expect((mockProbe as any).capabilities).toBeDefined();
    expect((mockProbe as any).capabilities.tool_calls).toBe(true);

    const mod = await import('./probe-scheduler.js');
    const result = await mod.runAllProbes();
    expect(result.entries.length).toBeGreaterThan(0);
    const entry = result.entries[0];
    expect(entry.capabilities).toEqual(
      expect.arrayContaining(['tools', 'json', 'stream']),
    );
  });

  it('startProbeScheduler runs the first cycle immediately', async () => {
    const mod = await import('./probe-scheduler.js');
    const broadcast = vi.fn();
    mod.startProbeScheduler(broadcast);
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcast).toHaveBeenCalledTimes(1);
    mod.stopProbeScheduler();
  });

  it('startProbeScheduler does not start a duplicate loop', async () => {
    const mod = await import('./probe-scheduler.js');
    const broadcast = vi.fn();
    mod.startProbeScheduler(broadcast);
    mod.startProbeScheduler(broadcast);
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcast).toHaveBeenCalledTimes(1);
    mod.stopProbeScheduler();
  });

  it('refreshProbeHealth re-collects from stored probes', async () => {
    const mod = await import('./probe-scheduler.js');
    mod.refreshProbeHealth();
    const health = mod.getProbeHealth();
    expect(health.version).toBe(1);
    expect(Array.isArray(health.entries)).toBe(true);
  });
});
