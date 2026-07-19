import { describe, expect, it } from 'vitest';

import {
  buildProductionDiagnostics,
  formatDiagnosticsSummary,
  ProductionDiagnosticsOptions,
} from './production-diagnostics.js';
import type { Channel, AgentRuntimeHealth } from './types.js';
import type { CodingJob } from './coding-jobs.js';
import type { GroupQueue } from './group-queue.js';
import type { GitHubConnectorHealthInput } from './github-connector-health.js';

function fakeQueue(
  overrides: Partial<ReturnType<GroupQueue['getQueueDiagnostics']>> = {},
): GroupQueue {
  return {
    getQueueDiagnostics: () => ({
      activeCount: 0,
      waitingCount: 0,
      pendingTasks: 0,
      pendingMessages: 0,
      groups: [],
      ...overrides,
    }),
  } as unknown as GroupQueue;
}

function fakeChannel(
  name: string,
  connected: boolean,
  overrides: Partial<Channel> = {},
): Channel {
  return {
    name,
    isConnected: () => connected,
    connect: async () => {},
    disconnect: async () => {},
    sendMessage: async () => {},
    ownsJid: () => false,
    ...overrides,
  } as unknown as Channel;
}

function healthyRuntime(cli: string): AgentRuntimeHealth {
  return {
    cli: cli as AgentRuntimeHealth['cli'],
    executable: cli,
    status: 'healthy',
    version: '1.0',
    checkedAt: new Date().toISOString(),
    detail: 'version 1.0',
  };
}

function baseOptions(
  overrides: Partial<ProductionDiagnosticsOptions> = {},
): ProductionDiagnosticsOptions {
  const githubInput: GitHubConnectorHealthInput = {
    webhookUrl: '/api/webhooks/github',
    config: {
      enabled: true,
      secret: '****',
      events: ['push', 'pull_request', 'issues'],
      targetJid: 'wa:main',
    },
    events: [
      {
        timestamp: new Date().toISOString(),
        event: 'push',
        repo: 'owner/repo',
        status: 'handled',
      },
    ],
    tokenConfigured: true,
    webhookSecretConfigured: true,
    targetGroupExists: true,
  };

  const queue = fakeQueue();

  return {
    state: {
      channels: [fakeChannel('whatsapp', true)],
      registeredGroups: () => ({
        'wa:main': {
          name: 'Main',
          folder: 'main',
          trigger: '@',
          added_at: new Date().toISOString(),
          jid: 'wa:main',
          channel: 'whatsapp',
          enabled: true,
        } as any,
      }),
      queue,
      sendMessage: async () => {},
      startTime: Date.now(),
    },
    queue,
    now: new Date(),
    codingReadiness: [healthyRuntime('claude')],
    agentRuntimes: [healthyRuntime('claude')],
    codingJobs: [],
    inferenceHealth: {
      summary: {
        total: 1,
        healthy: 1,
        degraded: 0,
        local: 0,
        remote: 1,
        stale: 0,
      },
      items: [
        {
          profileId: 'default_chat',
          label: 'Chat',
          provider: 'claude',
          model: 'claude-sonnet',
          locality: 'remote',
          configured: true,
          ok: true,
          status: 'healthy',
          lastProbeAt: new Date().toISOString(),
          failedChecks: [],
          toolPolicy: 'read-only',
        },
      ],
    },
    githubConnectorInput: githubInput,
    ...overrides,
  };
}

describe('buildProductionDiagnostics', () => {
  it('returns ready when all systems are healthy', async () => {
    const result = await buildProductionDiagnostics(baseOptions());

    expect(result.status).toBe('ready');
    expect(result.summary.passed).toBeGreaterThan(0);
    expect(result.summary.failedRequired).toBe(0);
    expect(result.summary.failedAdvisory).toBe(0);
    expect(result.stale).toBe(false);
    expect(result.sections.map((s) => s.id)).toContain('runtime');
    expect(result.sections.map((s) => s.id)).toContain('queue');
    expect(result.sections.map((s) => s.id)).toContain('channels');
    expect(result.sections.map((s) => s.id)).toContain('connectors');
  });

  it('is blocked when a required runtime fails', async () => {
    const options = baseOptions({
      codingReadiness: [
        {
          cli: 'devin',
          executable: 'devin',
          status: 'error',
          version: null,
          checkedAt: new Date().toISOString(),
          detail: 'Devin sandbox auth handoff is not available',
        } as AgentRuntimeHealth,
      ],
      agentRuntimes: [
        {
          cli: 'devin',
          executable: 'devin',
          status: 'error',
          version: null,
          checkedAt: new Date().toISOString(),
          detail: 'Devin sandbox auth handoff is not available',
        } as AgentRuntimeHealth,
      ],
    });

    const result = await buildProductionDiagnostics(options);

    expect(result.status).toBe('blocked');
    const sandbox = result.sections
      .find((s) => s.id === 'sandbox')
      ?.checks.find((c) => c.id === 'sandbox-devin');
    expect(sandbox?.ok).toBe(false);
    expect(sandbox?.severity).toBe('required');
  });

  it('flags stale jobs older than the threshold', async () => {
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const job: CodingJob = {
      id: 'job-123',
      repo: 'owner/repo',
      branch: 'feature/issue',
      status: 'ci_running',
      updatedAt: staleAt,
      createdAt: staleAt,
      transitionedAt: { ci_running: staleAt },
    } as unknown as CodingJob;

    const result = await buildProductionDiagnostics(
      baseOptions({
        codingJobs: [job],
        staleJobThresholdMs: 30 * 60 * 1000,
      }),
    );

    const staleSection = result.sections.find((s) => s.id === 'stale-jobs');
    expect(staleSection).toBeDefined();
    const staleCheck = staleSection?.checks.find((c) =>
      c.id.startsWith('stale-job-'),
    );
    expect(staleCheck?.ok).toBe(false);
    expect(staleCheck?.stale).toBe(true);
    expect(staleCheck?.detail).toContain('feature/issue');
    expect(result.stale).toBe(true);
  });

  it('reports queue latency and pending work', async () => {
    const queue = fakeQueue({
      activeCount: 5,
      waitingCount: 2,
      pendingTasks: 3,
      pendingMessages: 1,
    });

    const result = await buildProductionDiagnostics(baseOptions({ queue }));

    const queueSection = result.sections.find((s) => s.id === 'queue');
    expect(queueSection?.checks.find((c) => c.id === 'queue-waiting')?.ok).toBe(
      false,
    );
    expect(
      queueSection?.checks.find((c) => c.id === 'queue-pending-tasks')?.ok,
    ).toBe(false);
    expect(result.status).toBe('blocked');
  });

  it('redacts private paths and tokens from details', async () => {
    const detail = `/home/user/.secret token=ghp_super_secret`;
    const options = baseOptions({
      codingReadiness: [
        {
          cli: 'claude',
          executable: '/home/user/.local/bin/claude',
          status: 'error',
          version: null,
          checkedAt: new Date().toISOString(),
          detail,
        } as AgentRuntimeHealth,
      ],
      agentRuntimes: [
        {
          cli: 'claude',
          executable: '/home/user/.local/bin/claude',
          status: 'error',
          version: null,
          checkedAt: new Date().toISOString(),
          detail,
        } as AgentRuntimeHealth,
      ],
    });

    const result = await buildProductionDiagnostics(options);

    const json = JSON.stringify(result);
    expect(json).not.toContain('/home/user/.secret');
    expect(json).not.toContain('ghp_super_secret');
    expect(json).toContain('[redacted');
  });

  it('marks offline channels as required failures', async () => {
    const result = await buildProductionDiagnostics(
      baseOptions({
        state: {
          channels: [fakeChannel('whatsapp', false)],
          registeredGroups: () => ({
            'wa:main': {
              name: 'Main',
              folder: 'main',
              trigger: '@',
              added_at: new Date().toISOString(),
              jid: 'wa:main',
              channel: 'whatsapp',
              enabled: true,
            } as any,
          }),
          queue: fakeQueue(),
          sendMessage: async () => {},
          startTime: Date.now(),
        },
      }),
    );

    expect(result.status).toBe('blocked');
    const channelCheck = result.sections
      .find((s) => s.id === 'channels')
      ?.checks.find((c) => c.id === 'channel-whatsapp');
    expect(channelCheck?.ok).toBe(false);
    expect(channelCheck?.severity).toBe('required');
  });
});

describe('formatDiagnosticsSummary', () => {
  it('uses the shared status vocabulary and mentions stale data', () => {
    const summary = formatDiagnosticsSummary({
      status: 'attention',
      generatedAt: new Date().toISOString(),
      summary: { total: 5, passed: 4, failedRequired: 0, failedAdvisory: 1 },
      sections: [
        {
          id: 'runtime',
          title: 'Agent runtimes',
          checks: [
            {
              id: 'runtime-pi',
              label: 'pi runtime',
              ok: false,
              severity: 'advisory',
              detail: 'Container image unavailable',
              hint: 'Rebuild or pull the agent container image',
            },
          ],
        },
      ],
      loadIssues: [],
      stale: true,
    });

    expect(summary).toContain('Status: attention');
    expect(summary).toContain('Advisory failures: 1');
    expect(summary).toContain('Stale data detected');
    expect(summary).toContain('Agent runtimes');
    expect(summary).toContain('Rebuild or pull the agent container image');
  });
});
