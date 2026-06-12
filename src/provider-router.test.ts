import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-provider-router-test/store',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ OPENROUTER_API_KEY: 'test-key' })),
}));

vi.mock('./agent-provider.js', async () => {
  const actual = await vi.importActual<typeof import('./agent-provider.js')>(
    './agent-provider.js',
  );
  const getProviderAvailability = vi.fn(() => ({
    claude: true,
    codex: true,
    opencode: true,
    ollama: true,
    openrouter: true,
    google: true,
    'openai-responses': true,
    'anthropic-messages': true,
    gemini: true,
    mistral: true,
    'openai-compatible': true,
  }));
  return {
    ...actual,
    getAgentProviderConfig: vi.fn(() => ({
      provider: 'codex',
      model: 'gpt-5.4',
      modelsByProvider: {
        codex: 'gpt-5.4',
        openrouter: 'openrouter/auto',
        ollama: 'gemma4:e2b',
      },
      baseUrlsByProvider: {
        openrouter: 'https://openrouter.example/api/v1',
        ollama: 'http://localhost:11434/v1',
      },
    })),
    getProviderAvailability,
  };
});

vi.mock('./providers/live-probe.js', () => ({
  liveProbeService: {
    probeModel: vi.fn(async () => ({
      model: 'openrouter/auto',
      capabilities: {
        toolCalls: true,
        structuredOutput: true,
        streaming: true,
        vision: true,
        codeStrength: 'high',
        contextWindow: 128000,
        costTier: 'medium',
        privacyTier: 'high',
        supportsMcpStrategy: true,
      },
      validated: true,
      ok: true,
      status: 'success',
      timestamp: new Date('2026-06-12T12:00:00.000Z'),
    })),
    getCachedProbe: vi.fn(() => null),
  },
}));

const TEST_ROOT = '/tmp/nanocrab-provider-router-test';

describe('provider-router persistence', () => {
  beforeEach(async () => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    const agentProvider = await import('./agent-provider.js');
    vi.mocked(agentProvider.getProviderAvailability).mockReturnValue({
      claude: true,
      codex: true,
      opencode: true,
      ollama: true,
      openrouter: true,
      google: true,
      'openai-responses': true,
      'anthropic-messages': true,
      gemini: true,
      mistral: true,
      'openai-compatible': true,
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('persists profile defaults and reloads saved profile settings', async () => {
    const { loadProviderProfiles, saveProviderProfile } =
      await import('./provider-router.js');

    const original = loadProviderProfiles().find(
      (profile) => profile.id === 'default_coding',
    )!;
    const saved = saveProviderProfile({
      ...original,
      provider: 'openrouter',
      model: 'openrouter/auto',
      baseUrl: 'https://openrouter.example/api/v1',
      fallbackProfileId: 'default_chat',
      toolPolicy: 'approval-required',
    });

    expect(saved.updatedAt).not.toBe(new Date(0).toISOString());
    const reloaded = loadProviderProfiles().find(
      (profile) => profile.id === 'default_coding',
    )!;
    expect(reloaded).toMatchObject({
      provider: 'openrouter',
      model: 'openrouter/auto',
      baseUrl: 'https://openrouter.example/api/v1',
      fallbackProfileId: 'default_chat',
    });
    expect(loadProviderProfiles()).toHaveLength(9);
  });

  it('records live probe details and bounded history in provider-probes.json', async () => {
    const {
      runLiveProviderProbe,
      loadProviderProfiles,
      getProviderProbeHistory,
    } = await import('./provider-router.js');
    const profile = {
      ...loadProviderProfiles().find((item) => item.id === 'default_chat')!,
      provider: 'openrouter' as const,
      model: 'openrouter/auto',
    };

    const result = await runLiveProviderProbe(profile);

    expect(result).toMatchObject({
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      live: true,
    });
    expect(result.latencyMs).toEqual(expect.any(Number));
    expect(result.capabilities).toMatchObject({
      streaming: true,
      tool_calls: true,
      structured_output: true,
      vision: true,
      context_window: 128000,
    });

    const stored = JSON.parse(
      fs.readFileSync(
        '/tmp/nanocrab-provider-router-test/store/provider-probes.json',
        'utf-8',
      ),
    );
    expect(stored.latestByProfile.default_chat).toMatchObject({
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
    });
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0]).toMatchObject({
      profileId: 'default_chat',
      provider: 'openrouter',
      model: 'openrouter/auto',
      streaming: true,
      latencyMs: expect.any(Number),
      toolSupport: true,
      schemaSupport: true,
      visionSupport: true,
      contextWindow: 128000,
      timestamp: expect.any(String),
    });
    expect(stored.history[0]).not.toHaveProperty('result');
    expect(stored.history[0]).not.toHaveProperty('providerId');
    expect(
      getProviderProbeHistory('openrouter', 'openrouter/auto'),
    ).toHaveLength(1);
  });

  it('includes actionable detail for failed live probes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })),
    );
    const { runLiveProviderProbe, loadProviderProfiles } =
      await import('./provider-router.js');
    const profile = {
      ...loadProviderProfiles().find((item) => item.id === 'default_chat')!,
      provider: 'openrouter' as const,
      model: 'openrouter/auto',
    };

    const result = await runLiveProviderProbe(profile);

    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain('models endpoint returned 401');
    expect(result.errors?.[0]).toContain('401');
  });

  it('persists actionable errorDetail for static check failures', async () => {
    const agentProvider = await import('./agent-provider.js');
    vi.mocked(agentProvider.getProviderAvailability).mockReturnValue({
      claude: true,
      codex: true,
      opencode: true,
      ollama: true,
      openrouter: false,
      google: true,
      'openai-responses': true,
      'anthropic-messages': true,
      gemini: true,
      mistral: true,
      'openai-compatible': true,
    } as never);
    const { runLiveProviderProbe, loadProviderProfiles } =
      await import('./provider-router.js');
    const profile = {
      ...loadProviderProfiles().find((item) => item.id === 'default_chat')!,
      provider: 'openrouter' as const,
      model: 'openrouter/auto',
    };

    const result = await runLiveProviderProbe(profile);

    expect(result.ok).toBe(false);
    expect(result.errorDetail).toContain(
      'Provider is missing credentials, CLI auth, or base URL configuration',
    );
    const stored = JSON.parse(
      fs.readFileSync(
        '/tmp/nanocrab-provider-router-test/store/provider-probes.json',
        'utf-8',
      ),
    );
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0].errorDetail).toContain(
      'Provider is missing credentials, CLI auth, or base URL configuration',
    );
    expect(stored.history[0]).not.toHaveProperty('result');
  });
});
