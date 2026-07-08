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
    airouter: true,
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
        airouter: 'Qwen3.6',
      },
      baseUrlsByProvider: {
        openrouter: 'https://openrouter.example/api/v1',
        ollama: 'http://localhost:11434/v1',
        airouter: 'https://api.airouter.ch/v1',
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
      airouter: true,
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
      airouter: true,
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

  it('creates a provider-fallback approval for write-capable fallback', async () => {
    const agentProvider = await import('./agent-provider.js');
    vi.mocked(agentProvider.getProviderAvailability).mockReturnValue({
      claude: true,
      codex: false,
      opencode: true,
      ollama: true,
      openrouter: true,
      google: true,
      'openai-responses': true,
      'anthropic-messages': true,
      gemini: true,
      mistral: true,
      airouter: true,
      'openai-compatible': true,
    } as never);
    const {
      loadProviderProfiles,
      resolveProviderFallbackForAction,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const { listApprovals } = await import('./approvals.js');
    const coding = loadProviderProfiles().find(
      (item) => item.id === 'default_coding',
    )!;
    const chat = loadProviderProfiles().find(
      (item) => item.id === 'default_chat',
    )!;
    saveProviderProfile({
      ...chat,
      provider: 'openrouter',
      model: 'openrouter/auto',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
    });
    saveProviderProfile({
      ...coding,
      provider: 'codex',
      model: 'gpt-5.4',
      toolPolicy: 'approval-required',
      fallbackProfileId: 'default_chat',
    });

    const decision = resolveProviderFallbackForAction({
      purpose: 'default_coding',
      action: 'coding-implementation',
      requester: 'provider-router-test',
      correlationId: 'job-123',
    });

    if (decision.approved) {
      throw new Error('write-capable fallback should require approval');
    }
    expect(decision.approvalId).toEqual(expect.any(String));
    const targetId =
      'default_coding:codex/gpt-5.4->default_chat:openrouter/openrouter/auto:coding-implementation';
    const approvals = listApprovals({
      kind: 'provider-fallback',
      targetType: 'provider-profile',
      targetId,
    });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      kind: 'provider-fallback',
      status: 'pending',
      requester: 'provider-router-test',
      correlationId: 'job-123',
      targetType: 'provider-profile',
      targetId,
    });
    expect(approvals[0].payload).toMatchObject({
      sourceProfileId: 'default_coding',
      targetProfileId: 'default_chat',
      action: 'coding-implementation',
    });
  });

  it('considers invalid preferred model unavailable and creates fallback approval', async () => {
    const {
      loadProviderProfiles,
      resolveProviderFallbackForAction,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const { listApprovals } = await import('./approvals.js');
    fs.mkdirSync('/tmp/nanocrab-provider-router-test/store', {
      recursive: true,
    });
    fs.writeFileSync(
      '/tmp/nanocrab-provider-router-test/store/provider-profiles.json',
      `${JSON.stringify(
        {
          default_chat: {
            ...loadProviderProfiles().find(
              (item) => item.id === 'default_chat',
            ),
            provider: 'openrouter',
            model: 'openrouter/auto',
            toolPolicy: 'read-only',
            fallbackProfileId: null,
          },
          default_coding: {
            ...loadProviderProfiles().find(
              (item) => item.id === 'default_coding',
            ),
            provider: 'codex',
            model: 'not-a-codex-model',
            toolPolicy: 'approval-required',
            fallbackProfileId: 'default_chat',
          },
        },
        null,
        2,
      )}\n`,
    );

    const decision = resolveProviderFallbackForAction({
      purpose: 'default_coding',
      action: 'coding-implementation',
      requester: 'provider-router-test',
    });

    if (decision.approved) {
      throw new Error('invalid model fallback should require approval');
    }
    expect(decision.reason).toContain('invalid model');
    expect(
      listApprovals({
        kind: 'provider-fallback',
        targetType: 'provider-profile',
        targetId:
          'default_coding:codex/not-a-codex-model->default_chat:openrouter/openrouter/auto:coding-implementation',
      }),
    ).toHaveLength(1);
  });

  it('considers failed stored profile probe unavailable and creates fallback approval', async () => {
    const {
      loadProviderProfiles,
      getStoredProviderProbes,
      resolveProviderFallbackForAction,
      runLiveProviderProbe,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const { listApprovals } = await import('./approvals.js');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })),
    );
    const chat = loadProviderProfiles().find(
      (item) => item.id === 'default_chat',
    )!;
    const reports = loadProviderProfiles().find(
      (item) => item.id === 'default_reports',
    )!;
    const source = saveProviderProfile({
      ...chat,
      provider: 'openrouter',
      model: 'openrouter/auto',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_reports',
    });
    saveProviderProfile({
      ...reports,
      provider: 'google',
      model: 'gemini-2.5-flash',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
    });
    await runLiveProviderProbe(source);
    expect(getStoredProviderProbes().default_chat.ok).toBe(false);

    const decision = resolveProviderFallbackForAction({
      purpose: 'default_chat',
      action: 'external-message',
      requester: 'provider-router-test',
    });

    if (decision.approved) {
      throw new Error('failed probe fallback should require approval');
    }
    expect(decision.reason).toContain('failed stored probe');
    expect(
      listApprovals({
        kind: 'provider-fallback',
        targetType: 'provider-profile',
        targetId:
          'default_chat:openrouter/openrouter/auto->default_reports:google/gemini-2.5-flash:external-message',
      }),
    ).toHaveLength(1);
  });

  it('creates approval for read fallback crossing local/private to hosted boundary', async () => {
    const agentProvider = await import('./agent-provider.js');
    vi.mocked(agentProvider.getProviderAvailability).mockReturnValue({
      claude: true,
      codex: true,
      opencode: true,
      ollama: false,
      openrouter: true,
      google: true,
      'openai-responses': true,
      'anthropic-messages': true,
      gemini: true,
      mistral: true,
      airouter: true,
      'openai-compatible': true,
    } as never);
    const {
      loadProviderProfiles,
      resolveProviderFallbackForAction,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const { listApprovals } = await import('./approvals.js');
    const chat = loadProviderProfiles().find(
      (item) => item.id === 'default_chat',
    )!;
    const reports = loadProviderProfiles().find(
      (item) => item.id === 'default_reports',
    )!;
    saveProviderProfile({
      ...chat,
      provider: 'ollama',
      model: 'gemma4:e2b',
      toolPolicy: 'read-only',
      fallbackProfileId: 'default_reports',
    });
    saveProviderProfile({
      ...reports,
      provider: 'google',
      model: 'gemini-2.5-flash',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
    });

    const decision = resolveProviderFallbackForAction({
      purpose: 'default_chat',
      action: 'read',
      requester: 'provider-router-test',
    });

    if (decision.approved) {
      throw new Error('privacy boundary fallback should require approval');
    }
    expect(decision.reason).toContain('local/private');
    expect(
      listApprovals({
        kind: 'provider-fallback',
        targetType: 'provider-profile',
        targetId:
          'default_chat:ollama/gemma4:e2b->default_reports:google/gemini-2.5-flash:read',
      }),
    ).toHaveLength(1);
  });

  it('preserves an explicitly requested provider and model when no fallback is needed', async () => {
    const {
      loadProviderProfiles,
      resolveProviderFallbackForAction,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const chat = loadProviderProfiles().find(
      (item) => item.id === 'default_chat',
    )!;
    const reports = loadProviderProfiles().find(
      (item) => item.id === 'default_reports',
    )!;
    saveProviderProfile({
      ...chat,
      provider: 'codex',
      model: 'not-a-codex-model',
      fallbackProfileId: 'default_reports',
    });
    saveProviderProfile({
      ...reports,
      provider: 'google',
      model: 'gemini-2.5-flash',
      fallbackProfileId: null,
    });

    const decision = resolveProviderFallbackForAction({
      purpose: 'default_chat',
      action: 'external-message',
      requester: 'provider-router-test',
      sourceProvider: 'openrouter',
      sourceModel: 'openrouter/auto',
    });

    expect(decision).toMatchObject({
      approved: true,
      provider: 'openrouter',
      model: 'openrouter/auto',
    });
  });

  it('requires a new approval when a previously approved fallback changes provider or model', async () => {
    const agentProvider = await import('./agent-provider.js');
    vi.mocked(agentProvider.getProviderAvailability).mockReturnValue({
      claude: true,
      codex: false,
      opencode: true,
      ollama: true,
      openrouter: true,
      google: true,
      'openai-responses': true,
      'anthropic-messages': true,
      gemini: true,
      mistral: true,
      airouter: true,
      'openai-compatible': true,
    } as never);
    const {
      loadProviderProfiles,
      resolveProviderFallbackForAction,
      saveProviderProfile,
    } = await import('./provider-router.js');
    const { listApprovals, reviewApproval } = await import('./approvals.js');
    const chat = loadProviderProfiles().find(
      (item) => item.id === 'default_chat',
    )!;
    const coding = loadProviderProfiles().find(
      (item) => item.id === 'default_coding',
    )!;
    saveProviderProfile({
      ...chat,
      provider: 'openrouter',
      model: 'openrouter/auto',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
    });
    saveProviderProfile({
      ...coding,
      provider: 'codex',
      model: 'gpt-5.4',
      toolPolicy: 'approval-required',
      fallbackProfileId: 'default_chat',
    });

    const first = resolveProviderFallbackForAction({
      purpose: 'default_coding',
      action: 'coding-implementation',
      requester: 'provider-router-test',
    });
    if (first.approved || !first.approvalId) {
      throw new Error('first fallback should request approval');
    }
    reviewApproval(first.approvalId, 'approved', 'provider-router-test');
    expect(
      resolveProviderFallbackForAction({
        purpose: 'default_coding',
        action: 'coding-implementation',
        requester: 'provider-router-test',
      }),
    ).toMatchObject({ approved: true, provider: 'openrouter' });

    saveProviderProfile({
      ...chat,
      provider: 'google',
      model: 'gemini-2.5-flash',
      toolPolicy: 'read-only',
      fallbackProfileId: null,
    });

    const second = resolveProviderFallbackForAction({
      purpose: 'default_coding',
      action: 'coding-implementation',
      requester: 'provider-router-test',
    });

    if (second.approved) {
      throw new Error('changed fallback target should require new approval');
    }
    expect(second.approvalId).toEqual(expect.any(String));
    expect(
      listApprovals({
        kind: 'provider-fallback',
        targetType: 'provider-profile',
      }),
    ).toHaveLength(2);
  });

  it('classifies provider purposes into fallback actions', async () => {
    const { fallbackActionForProviderPurpose } =
      await import('./provider-router.js');

    expect(fallbackActionForProviderPurpose('default_chat')).toBe('read');
    expect(fallbackActionForProviderPurpose('default_reports')).toBe('read');
    expect(fallbackActionForProviderPurpose('default_automation')).toBe(
      'automation-execution',
    );
    expect(fallbackActionForProviderPurpose('default_skill_factory')).toBe(
      'skill-installation',
    );
  });
});
