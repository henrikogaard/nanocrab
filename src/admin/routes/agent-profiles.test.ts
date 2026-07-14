import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-agent-profiles-route-test-${Date.now()}`,
);
const DATA_DIR = path.join(
  os.tmpdir(),
  `nanocrab-agent-profiles-route-data-${Date.now()}`,
);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-agent-profiles-route-groups-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  GROUPS_DIR,
  ASSISTANT_NAME: 'Assistant',
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
  },
  DEVIN_CREDENTIAL_PATH: null,
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../security.js', () => ({
  auditLog: vi.fn(),
}));

const { _closeDatabase, _initTestDatabase } = await import('../../db.js');
const { recordAgentProfileActivity } = await import('../../agent-profiles.js');
const { auditLog } = await import('../security.js');
const { default: agentProfilesRouter } = await import('./agent-profiles.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/agent-profiles', agentProfilesRouter);
  return app;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to a port');
    }
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function postJson<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as T };
}

async function putJson<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as T };
}

function profileRequest(handle = 'RepoFixer') {
  return {
    handle,
    displayName: 'Repo Fixer',
    providerProfileId: 'default_coding',
    taskKinds: ['coding_job'],
    toolPolicy: 'approval-required',
  };
}

function subscriptionRequest() {
  return {
    sourceType: 'github',
    enabled: true,
    filters: {
      repo: 'henrikogaard/nanocrab',
      labels: ['autofix'],
    },
    taskKind: 'coding_job',
    autonomyMode: 'investigate_then_pause',
  };
}

describe('/api/agent-profiles', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    vi.clearAllMocks();
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  it('POST /api/agent-profiles creates a profile and normalizes handle', async () => {
    await withServer(async (base) => {
      const { res, body } = await postJson<{
        ok: true;
        profile: {
          id: string;
          handle: string;
          displayName: string;
          providerProfileId: string;
          taskKinds: string[];
        };
      }>(base, '/api/agent-profiles', profileRequest('@RepoFixer'));

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.profile.id).toMatch(/^agent_/);
      expect(body.profile.handle).toBe('repofixer');
      expect(body.profile.displayName).toBe('Repo Fixer');
      expect(body.profile.providerProfileId).toBe('default_coding');
      expect(body.profile.taskKinds).toEqual(['coding_job']);
    });
  });

  it('POST /api/agent-profiles rejects duplicate handles', async () => {
    await withServer(async (base) => {
      const first = await postJson(
        base,
        '/api/agent-profiles',
        profileRequest(),
      );
      expect(first.res.status).toBe(200);

      const { res, body } = await postJson<{ error: string }>(
        base,
        '/api/agent-profiles',
        profileRequest('@REPOFIXER'),
      );

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/already exists/i);
    });
  });

  it('GET /api/agent-profiles lists roster summaries', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const subscription = await postJson<{
        subscription: { id: string };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions`,
        subscriptionRequest(),
      );
      expect(subscription.res.status).toBe(200);

      recordAgentProfileActivity({
        agentProfileId: created.body.profile.id,
        subscriptionId: subscription.body.subscription.id,
        kind: 'subscription_match',
        sourceType: 'github',
        sourceId: 'henrikogaard/nanocrab',
        summary: 'Matched autofix issue',
        runId: null,
        approvalId: null,
        metadata: {},
      });

      const disabled = await postJson(base, '/api/agent-profiles', {
        ...profileRequest('ManualHost'),
        displayName: 'Manual Host',
        enabled: false,
      });
      expect(disabled.res.status).toBe(200);

      const res = await fetch(`${base}/api/agent-profiles`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        id: string;
        handle: string;
        enabled: boolean;
        rosterState: string;
        subscriptionsCount: number;
        enabledSubscriptionsCount: number;
        activityCount: number;
        lastActivityAt: string | null;
      }>;

      const repoFixer = body.find((profile) => profile.handle === 'repofixer');
      expect(repoFixer).toMatchObject({
        enabled: true,
        rosterState: 'enabled',
        subscriptionsCount: 1,
        enabledSubscriptionsCount: 1,
        activityCount: 1,
      });
      expect(repoFixer?.lastActivityAt).toEqual(expect.any(String));

      const manualHost = body.find(
        (profile) => profile.handle === 'manualhost',
      );
      expect(manualHost).toMatchObject({
        enabled: false,
        rosterState: 'disabled',
        subscriptionsCount: 0,
        enabledSubscriptionsCount: 0,
        activityCount: 0,
        lastActivityAt: null,
      });
    });
  });

  it('POST /api/agent-profiles/:id/subscriptions creates a GitHub subscription', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const { res, body } = await postJson<{
        ok: true;
        subscription: {
          id: string;
          agentProfileId: string;
          sourceType: string;
          enabled: boolean;
          filters: Record<string, unknown>;
          taskKind: string;
          autonomyMode: string;
        };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions`,
        subscriptionRequest(),
      );

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.subscription.id).toMatch(/^sub_/);
      expect(body.subscription.agentProfileId).toBe(created.body.profile.id);
      expect(body.subscription.sourceType).toBe('github');
      expect(body.subscription.enabled).toBe(true);
      expect(body.subscription.filters).toEqual({
        repo: 'henrikogaard/nanocrab',
        labels: ['autofix'],
      });
      expect(body.subscription.taskKind).toBe('coding_job');
      expect(body.subscription.autonomyMode).toBe('investigate_then_pause');
    });
  });

  it('PUT /api/agent-profiles/:id/subscriptions/:subscriptionId updates filters/task/enabled state', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const subscription = await postJson<{
        subscription: { id: string; agentProfileId: string; createdAt: string };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions`,
        subscriptionRequest(),
      );
      expect(subscription.res.status).toBe(200);

      const { res, body } = await putJson<{
        ok: true;
        subscription: {
          id: string;
          agentProfileId: string;
          sourceType: string;
          enabled: boolean;
          filters: Record<string, unknown>;
          taskKind: string;
          autonomyMode: string;
          createdAt: string;
          updatedAt: string;
        };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions/${subscription.body.subscription.id}`,
        {
          id: 'sub_malicious',
          agentProfileId: 'agent_malicious',
          sourceType: 'channel_mention',
          createdAt: '2000-01-01T00:00:00.000Z',
          enabled: false,
          filters: {
            repo: 'henrikogaard/nanocrab',
            labels: ['agent-profiles'],
          },
          taskKind: 'report',
        },
      );

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.subscription.id).toBe(subscription.body.subscription.id);
      expect(body.subscription.agentProfileId).toBe(created.body.profile.id);
      expect(body.subscription.sourceType).toBe('github');
      expect(body.subscription.createdAt).toBe(
        subscription.body.subscription.createdAt,
      );
      expect(body.subscription.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(body.subscription.enabled).toBe(false);
      expect(body.subscription.filters).toEqual({
        repo: 'henrikogaard/nanocrab',
        labels: ['agent-profiles'],
      });
      expect(body.subscription.taskKind).toBe('report');
      expect(body.subscription.autonomyMode).toBe('investigate_then_pause');
    });
  });

  it.each([
    ['enabled', { enabled: 'yes' }],
    ['filters', { filters: [] }],
  ])(
    'PUT /api/agent-profiles/:id/subscriptions/:subscriptionId rejects invalid %s patches',
    async (field, patch) => {
      await withServer(async (base) => {
        const created = await postJson<{
          profile: { id: string };
        }>(base, '/api/agent-profiles', profileRequest());
        expect(created.res.status).toBe(200);

        const subscription = await postJson<{
          subscription: { id: string };
        }>(
          base,
          `/api/agent-profiles/${created.body.profile.id}/subscriptions`,
          subscriptionRequest(),
        );
        expect(subscription.res.status).toBe(200);

        const { res, body } = await putJson<{ error: string }>(
          base,
          `/api/agent-profiles/${created.body.profile.id}/subscriptions/${subscription.body.subscription.id}`,
          patch,
        );

        expect(res.status).toBe(400);
        expect(body.error).toMatch(new RegExp(field, 'i'));
      });
    },
  );

  it('POST /api/agent-profiles/:id/subscriptions/:subscriptionId/disable flips enabled false and updates roster count', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const subscription = await postJson<{
        subscription: { id: string };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions`,
        subscriptionRequest(),
      );
      expect(subscription.res.status).toBe(200);

      const disabled = await postJson<{
        ok: true;
        subscription: { id: string; enabled: boolean };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions/${subscription.body.subscription.id}/disable`,
        {},
      );

      expect(disabled.res.status).toBe(200);
      expect(disabled.body.ok).toBe(true);
      expect(disabled.body.subscription.enabled).toBe(false);

      const listRes = await fetch(`${base}/api/agent-profiles`);
      expect(listRes.status).toBe(200);
      const profiles = (await listRes.json()) as Array<{
        id: string;
        subscriptionsCount: number;
        enabledSubscriptionsCount: number;
      }>;
      expect(
        profiles.find((profile) => profile.id === created.body.profile.id),
      ).toMatchObject({
        subscriptionsCount: 1,
        enabledSubscriptionsCount: 0,
      });
    });
  });

  it('POST /api/agent-profiles/:id/subscriptions/:subscriptionId/enable flips enabled true', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const subscription = await postJson<{
        subscription: { id: string };
      }>(base, `/api/agent-profiles/${created.body.profile.id}/subscriptions`, {
        ...subscriptionRequest(),
        enabled: false,
      });
      expect(subscription.res.status).toBe(200);

      const enabled = await postJson<{
        ok: true;
        subscription: { id: string; enabled: boolean };
      }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/subscriptions/${subscription.body.subscription.id}/enable`,
        {},
      );

      expect(enabled.res.status).toBe(200);
      expect(enabled.body.ok).toBe(true);
      expect(enabled.body.subscription.enabled).toBe(true);
    });
  });

  it('PUT /api/agent-profiles/:id/subscriptions/:subscriptionId returns 404 for another profile subscription', async () => {
    await withServer(async (base) => {
      const first = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest('RepoFixer'));
      expect(first.res.status).toBe(200);

      const second = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', {
        ...profileRequest('ReportHost'),
        displayName: 'Report Host',
      });
      expect(second.res.status).toBe(200);

      const subscription = await postJson<{
        subscription: { id: string };
      }>(
        base,
        `/api/agent-profiles/${second.body.profile.id}/subscriptions`,
        subscriptionRequest(),
      );
      expect(subscription.res.status).toBe(200);

      const { res, body } = await putJson<{ error: string }>(
        base,
        `/api/agent-profiles/${first.body.profile.id}/subscriptions/${subscription.body.subscription.id}`,
        { enabled: false },
      );

      expect(res.status).toBe(404);
      expect(body.error).toBe('Agent subscription not found');
    });
  });

  it('POST /api/agent-profiles/:id/disable prevents enabled roster state', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const disabled = await postJson<{
        ok: true;
        profile: { id: string; enabled: boolean };
      }>(base, `/api/agent-profiles/${created.body.profile.id}/disable`, {});

      expect(disabled.res.status).toBe(200);
      expect(disabled.body.ok).toBe(true);
      expect(disabled.body.profile.enabled).toBe(false);

      const listRes = await fetch(`${base}/api/agent-profiles`);
      expect(listRes.status).toBe(200);
      const profiles = (await listRes.json()) as Array<{
        id: string;
        enabled: boolean;
        rosterState: string;
      }>;
      expect(
        profiles.find((profile) => profile.id === created.body.profile.id),
      ).toMatchObject({
        enabled: false,
        rosterState: 'disabled',
      });
    });
  });

  it('POST /api/agent-profiles/:id/invoke records invocation activity', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const { res, body } = await postJson<{
        ok: true;
        activity: {
          id: string;
          agentProfileId: string;
          kind: string;
          sourceType: string;
          summary: string;
          metadata: Record<string, unknown>;
        };
      }>(base, `/api/agent-profiles/${created.body.profile.id}/invoke`, {
        prompt: 'Draft a focused repository status report',
      });

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.activity.id).toMatch(/^agent_activity_/);
      expect(body.activity).toMatchObject({
        agentProfileId: created.body.profile.id,
        kind: 'invocation',
        sourceType: 'manual',
        summary: 'Manual invocation requested',
        metadata: {
          prompt: 'Draft a focused repository status report',
        },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.anything(),
        'agent_profile_invoked',
        created.body.profile.id,
      );

      const detailRes = await fetch(
        `${base}/api/agent-profiles/${created.body.profile.id}`,
      );
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as {
        activity: Array<{ id: string; kind: string }>;
      };
      expect(detail.activity[0]).toMatchObject({
        id: body.activity.id,
        kind: 'invocation',
      });
    });
  });

  it('POST /api/agent-profiles/:id/invoke rejects disabled profiles', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', {
        ...profileRequest(),
        enabled: false,
      });
      expect(created.res.status).toBe(200);

      const { res, body } = await postJson<{ error: string }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/invoke`,
        { prompt: 'Run anyway' },
      );

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/disabled/i);
    });
  });

  it('POST /api/agent-profiles/:id/invoke rejects empty prompts', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const { res, body } = await postJson<{ error: string }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}/invoke`,
        { prompt: '   ' },
      );

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/prompt/i);
    });
  });

  it('POST /api/agent-profiles/:id/invoke returns 404 for missing profiles', async () => {
    await withServer(async (base) => {
      const { res, body } = await postJson<{ error: string }>(
        base,
        '/api/agent-profiles/agent_missing/invoke',
        { prompt: 'Run a missing profile' },
      );

      expect(res.status).toBe(404);
      expect(body.error).toMatch(/not found/i);
    });
  });

  it.each([
    ['taskKinds', { taskKinds: 'coding_job' }],
    ['allowedMcpServers', { allowedMcpServers: 'github' }],
    ['skills', { skills: 'repo-work' }],
    ['memoryScopes', { memoryScopes: 'shared' }],
  ])(
    'PUT /api/agent-profiles/:id rejects non-array %s',
    async (field, patch) => {
      await withServer(async (base) => {
        const created = await postJson<{
          profile: { id: string };
        }>(base, '/api/agent-profiles', profileRequest());
        expect(created.res.status).toBe(200);

        const { res, body } = await putJson<{ error: string }>(
          base,
          `/api/agent-profiles/${created.body.profile.id}`,
          patch,
        );

        expect(res.status).toBe(400);
        expect(body.error).toMatch(new RegExp(field, 'i'));
      });
    },
  );

  it('PUT /api/agent-profiles/:id rejects unsupported task kinds', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: { id: string };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const { res, body } = await putJson<{ error: string }>(
        base,
        `/api/agent-profiles/${created.body.profile.id}`,
        {
          taskKinds: ['coding_job', 'deploy_now'],
        },
      );

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/taskKind/i);
    });
  });

  it('PUT /api/agent-profiles/:id updates editable fields without accepting immutable metadata', async () => {
    await withServer(async (base) => {
      const created = await postJson<{
        profile: {
          id: string;
          createdAt: string;
        };
      }>(base, '/api/agent-profiles', profileRequest());
      expect(created.res.status).toBe(200);

      const { res, body } = await putJson<{
        ok: true;
        profile: {
          id: string;
          handle: string;
          displayName: string;
          enabled: boolean;
          createdAt: string;
          updatedAt: string;
        };
      }>(base, `/api/agent-profiles/${created.body.profile.id}`, {
        id: 'agent_malicious',
        createdAt: '2000-01-01T00:00:00.000Z',
        updatedAt: '2000-01-01T00:00:00.000Z',
        handle: '@ManualHost',
        displayName: ' Manual Host ',
        enabled: false,
      });

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.profile.id).toBe(created.body.profile.id);
      expect(body.profile.createdAt).toBe(created.body.profile.createdAt);
      expect(body.profile.updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(body.profile.handle).toBe('manualhost');
      expect(body.profile.displayName).toBe('Manual Host');
      expect(body.profile.enabled).toBe(false);
    });
  });

  it('GET /api/agent-profiles/runtime-health returns health for all allowlisted CLIs', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/agent-profiles/runtime-health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        cli: string;
        executable: string;
        status: string;
        checkedAt: string;
      }>;

      expect(body.length).toBeGreaterThanOrEqual(6);
      const clis = body.map((h) => h.cli);
      expect(clis).toContain('codex');
      expect(clis).toContain('claude');

      const mistral = body.find((h) => h.cli === 'mistral');
      expect(mistral?.executable).toBe('vibe');

      expect(body.find((h) => h.cli === 'devin')).toMatchObject({
        status: 'error',
        detail:
          'Sandboxed Devin authentication handoff is unavailable; no credential or host auth directory is mounted',
      });
    });
  });
});
