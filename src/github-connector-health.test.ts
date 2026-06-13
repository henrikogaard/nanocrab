import { describe, expect, it } from 'vitest';

import { buildGitHubConnectorHealth } from './github-connector-health.js';

describe('github connector health', () => {
  it('reports ready when GitHub token, webhook setup, and events are present', () => {
    const result = buildGitHubConnectorHealth({
      webhookUrl: 'https://example.com/api/webhooks/github',
      config: {
        enabled: true,
        secret: 'not-returned',
        events: ['push', 'pull_request', 'issues'],
        targetJid: 'wa:main',
      },
      events: [
        {
          timestamp: '2026-06-13T10:00:00.000Z',
          event: 'issues',
          repo: 'owner/repo',
          status: 'handled',
        },
      ],
      tokenConfigured: true,
      webhookSecretConfigured: true,
      targetGroupExists: true,
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.summary.failedRequired).toBe(0);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'github-token', ok: true }),
    );
  });

  it('blocks enabled webhook setup without leaking secret values', () => {
    const result = buildGitHubConnectorHealth({
      webhookUrl: 'https://example.com/api/webhooks/github',
      config: {
        enabled: true,
        secret: 'super-secret-webhook-value',
        events: ['push'],
        targetJid: 'wa:missing',
      },
      events: [],
      tokenConfigured: false,
      webhookSecretConfigured: false,
      targetGroupExists: false,
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('blocked');
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'github-token',
        ok: false,
        severity: 'required',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('super-secret-webhook-value');
  });
});
