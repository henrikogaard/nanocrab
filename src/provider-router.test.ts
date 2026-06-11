import fs from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-provider-router-test/store',
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { createApproval } from './approvals.js';
import {
  getProviderProfile,
  getStoredProviderProbes,
  providerCanFallbackAutomatically,
  runLiveProviderProbe,
  saveProviderProfile,
} from './provider-router.js';

const TEST_ROOT = '/tmp/nanocrab-provider-router-test';

describe('provider router', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('persists live provider probe results with timestamp and errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      })),
    );
    const profile = saveProviderProfile({
      ...getProviderProfile('default_chat')!,
      provider: 'ollama',
      model: 'llama3.2',
      baseUrl: 'http://localhost:11434/v1',
    });

    const result = await runLiveProviderProbe(profile);

    expect(result.live).toBe(true);
    expect(result.lastProbeAt).toEqual(expect.any(String));
    expect(result.errors).toContain('models endpoint returned 503');
    expect(getStoredProviderProbes().default_chat).toMatchObject({
      provider: 'ollama',
      model: 'llama3.2',
      live: true,
      lastProbeAt: result.lastProbeAt,
    });
  });

  it('allows read-only fallback automatically when configured', () => {
    const source = saveProviderProfile({
      ...getProviderProfile('default_reports')!,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      fallbackProfileId: 'default_chat',
    });
    const target = getProviderProfile('default_chat')!;

    expect(
      providerCanFallbackAutomatically({
        source,
        target,
        action: 'read',
      }),
    ).toBe(true);
  });

  it('requires approved provider fallback before write-capable fallback can run', async () => {
    const source = saveProviderProfile({
      ...getProviderProfile('default_coding')!,
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      fallbackProfileId: 'default_chat',
    });
    const target = getProviderProfile('default_chat')!;

    expect(
      providerCanFallbackAutomatically({
        source,
        target,
        action: 'write',
      }),
    ).toBe(false);

    const approval = createApproval({
      kind: 'provider-fallback',
      title: 'Approve fallback',
      summary: 'Allow fallback for coding.',
      targetType: 'provider-profile',
      targetId: source.id,
      payload: { sourceProfileId: source.id, targetProfileId: target.id },
    });
    createApproval({
      kind: 'provider-fallback',
      title: 'Approve fallback',
      summary: 'Allow fallback for coding.',
      targetType: 'provider-profile',
      targetId: source.id,
      payload: { sourceProfileId: source.id, targetProfileId: target.id },
    });
    const { reviewApproval } = await import('./approvals.js');
    reviewApproval(approval.id, 'approved', 'tester');

    expect(
      providerCanFallbackAutomatically({
        source,
        target,
        action: 'write',
      }),
    ).toBe(true);
  });
});
