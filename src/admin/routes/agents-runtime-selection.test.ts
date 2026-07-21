import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

import type { AgentRuntimeSelection } from '../../types.js';

const startCodingJob = vi.fn(async (input: Record<string, unknown>) => ({
  id: 'job-1',
  repo: input.repo,
}));
const pickGitHubIssue = vi.fn(async (input: Record<string, unknown>) => ({
  issue: { number: 129, htmlUrl: 'https://github.com/owner/repo/issues/129' },
  job: { id: 'job-2' },
  input,
}));
const readinessByCli = new Map<string, 'healthy' | 'missing'>([
  ['claude', 'healthy'],
  ['codex', 'healthy'],
  ['opencode', 'healthy'],
  ['devin', 'healthy'],
  ['pi', 'healthy'],
  ['mistral', 'healthy'],
]);
const namedRuntime = {
  id: 'codex-default',
  label: 'Codex default',
  description: null,
  runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
  enabled: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

vi.mock('../../config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-agents-runtime-route-test/store',
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
  },
}));
vi.mock('../../coding-runtime-profiles.js', () => ({
  buildCodingRuntimeProfile: vi.fn(),
  deleteCodingRuntimeProfile: vi.fn(),
  getCodingRuntimeProfile: vi.fn(() => namedRuntime),
  listCodingRuntimeProfiles: vi.fn(() => [namedRuntime]),
  resolveCodingRuntimeProfile: vi.fn(() => namedRuntime.runtime),
  saveCodingRuntimeProfile: vi.fn((profile) => profile),
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

vi.mock('../security.js', () => ({ auditLog: vi.fn() }));
vi.mock('../../db.js', () => ({
  getAllRegisteredGroups: vi.fn(() => ({})),
  getNonWebRegisteredGroups: vi.fn(() => ({})),
}));
vi.mock('../../coding-jobs.js', () => ({
  startCodingJob,
  pickGitHubIssue,
  listGitHubIssues: vi.fn(async () => []),
  loadCodingJobs: vi.fn(() => []),
  loadCodingRepos: vi.fn(() => []),
  registerCodingRepo: vi.fn(),
  getCodingJob: vi.fn(),
  approveCodingJob: vi.fn(),
  approveCodingJobPr: vi.fn(),
  cancelCodingJob: vi.fn(),
  closeCodingJobPr: vi.fn(),
  denyCodingJob: vi.fn(),
  openCodingJobPr: vi.fn(),
  refreshCodingJobCi: vi.fn(),
  retryCodingJob: vi.fn(),
  revertCodingJob: vi.fn(),
}));
vi.mock('../../repo-preferences.js', () => ({
  listAllRepoRules: vi.fn(() => []),
  listRepoRules: vi.fn(() => []),
  upsertRepoRule: vi.fn(),
}));
vi.mock('../../agent-runtime-registry.js', () => ({
  isAgentCliId: vi.fn((value: string) =>
    ['claude', 'codex', 'opencode', 'devin', 'pi', 'mistral'].includes(value),
  ),
  listAgentRuntimeDefinitions: vi.fn(() =>
    ['claude', 'codex', 'opencode', 'devin', 'pi', 'mistral'].map((cli) => ({
      cli,
      executable: cli,
      versionArgs: ['--version'],
      codingRunnerSupported: true,
    })),
  ),
  resolveDevinCliModelAlias: vi.fn((runtime: AgentRuntimeSelection) => {
    if (
      runtime.provider === 'claude' &&
      ['claude-sonnet-4-6', 'claude-opus-4-6'].includes(runtime.model)
    ) {
      return runtime.model === 'claude-sonnet-4-6'
        ? 'claude-sonnet-4'
        : 'claude-opus-4.6';
    }
    throw new Error(
      `no configured Devin CLI model alias for ${runtime.provider}/${runtime.model}`,
    );
  }),
  validateCodingRuntimeSelection: vi.fn((runtime: AgentRuntimeSelection) => {
    const compatible: Record<string, string[]> = {
      claude: ['claude'],
      codex: ['codex'],
      opencode: ['opencode', 'openrouter', 'ollama', 'openai-compatible'],
      pi: ['pi'],
      mistral: ['mistral'],
    };
    if (runtime.cli === 'devin') {
      if (
        runtime.provider !== 'claude' ||
        !['claude-sonnet-4-6', 'claude-opus-4-6'].includes(runtime.model)
      ) {
        throw new Error(
          `no configured Devin CLI model alias for ${runtime.provider}/${runtime.model}`,
        );
      }
      return;
    }
    if (!compatible[runtime.cli]?.includes(runtime.provider)) {
      throw new Error(
        `coding runtime CLI ${runtime.cli} is not compatible with provider ${runtime.provider}`,
      );
    }
  }),
}));
vi.mock('../../coding-runner-readiness.js', () => ({
  probeCodingRunnerReadiness: vi.fn(async (cli: string) => ({
    cli,
    executable: cli,
    status: readinessByCli.get(cli) || 'missing',
    version: '1.0.0',
    checkedAt: new Date(0).toISOString(),
    detail:
      readinessByCli.get(cli) === 'healthy'
        ? `${cli} ready`
        : `${cli} is not configured`,
  })),
}));

const { default: agentsRouter } = await import('./agents.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRouter);
  return app;
}

async function withServer<T>(handler: (baseUrl: string) => Promise<T>) {
  const server = buildApp().listen(0);
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

async function post(path: string, body: Record<string, unknown>) {
  return withServer((baseUrl) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('coding runtime selection routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
    readinessByCli.set('devin', 'healthy');
  });

  it('returns compatible complete runtime options with readiness and CLI aliases', async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agents/coding/runtimes`);
      expect(response.status).toBe(200);
      const options = (await response.json()) as Array<Record<string, unknown>>;
      expect(options).toContainEqual(
        expect.objectContaining({
          cli: 'devin',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          cliModel: 'claude-sonnet-4',
          available: true,
          readiness: expect.objectContaining({ status: 'healthy' }),
        }),
      );
      expect(options).toContainEqual(
        expect.objectContaining({
          cli: 'opencode',
          provider: 'openrouter',
          available: true,
        }),
      );
      expect(options).not.toContainEqual(
        expect.objectContaining({ cli: 'opencode', provider: 'claude' }),
      );
    });
  });

  it('accepts a mapped complete Devin runtime', async () => {
    const actualRuntime = {
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    } as const;
    const response = await post('/api/agents/coding/jobs', {
      repo: 'owner/repo',
      prompt: 'Plan issue 129',
      actualRuntime,
    });

    expect(response.status).toBe(200);
    expect(startCodingJob).toHaveBeenCalledWith(
      expect.objectContaining({ actualRuntime }),
    );
  });

  it.each([
    ['missing CLI', { provider: 'claude', model: 'claude-sonnet-4-6' }],
    [
      'catalog-only Devin model',
      { cli: 'devin', provider: 'claude', model: 'claude-haiku-4-5' },
    ],
    [
      'OpenCode and Claude mismatch',
      { cli: 'opencode', provider: 'claude', model: 'claude-sonnet-4-6' },
    ],
  ])(
    'rejects %s before starting a coding job',
    async (_label, actualRuntime) => {
      const response = await post('/api/agents/coding/jobs', {
        repo: 'owner/repo',
        prompt: 'Plan issue 129',
        actualRuntime,
      });

      expect(response.status).toBe(400);
      expect(startCodingJob).not.toHaveBeenCalled();
    },
  );

  it('rejects unhealthy Devin readiness before starting a coding job', async () => {
    readinessByCli.set('devin', 'missing');
    const response = await post('/api/agents/coding/jobs', {
      repo: 'owner/repo',
      prompt: 'Plan issue 129',
      actualRuntime: {
        cli: 'devin',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('devin / claude / claude-sonnet-4-6'),
    });
    expect(startCodingJob).not.toHaveBeenCalled();
  });

  it('validates and forwards a complete runtime when picking an issue', async () => {
    const actualRuntime = {
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
    } as const;
    const response = await post('/api/agents/coding/pick-issue', {
      repo: 'owner/repo',
      actualRuntime,
    });

    expect(response.status).toBe(200);
    expect(pickGitHubIssue).toHaveBeenCalledWith(
      expect.objectContaining({ actualRuntime }),
    );
  });

  it('resolves a named runtime profile before starting a coding job', async () => {
    const response = await post('/api/agents/coding/jobs', {
      repo: 'owner/repo',
      prompt: 'Implement issue 129',
      runtimeProfileId: 'codex-default',
    });

    expect(response.status).toBe(200);
    expect(startCodingJob).toHaveBeenCalledWith(
      expect.objectContaining({ actualRuntime: namedRuntime.runtime }),
    );
  });
});
