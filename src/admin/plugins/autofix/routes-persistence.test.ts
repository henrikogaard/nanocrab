import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-autofix-persistence-${process.pid}`,
);
const PROJECTS_PATH = path.join(STORE_DIR, 'autofix-projects.json');
const startCodingJob = vi.fn(async () => ({ id: 'job-1' }));
const registerCodingRepo = vi.fn(async () => ({}));

vi.mock('../../../config.js', () => ({ STORE_DIR }));
vi.mock('../../../env.js', () => ({ readEnvFile: vi.fn(() => ({})) }));
vi.mock('../../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));
vi.mock('../../security.js', () => ({ auditLog: vi.fn() }));
vi.mock('../../state.js', () => ({ getState: vi.fn(() => ({})) }));
vi.mock('../../../coding-runner-readiness.js', () => ({
  probeCodingRunnerReadiness: vi.fn(async (cli: string) => ({
    cli,
    executable: cli,
    status: 'healthy',
    version: 'test',
    checkedAt: new Date(0).toISOString(),
    detail: 'ready',
  })),
}));
vi.mock('../../../agent-runtime-registry.js', () => ({
  inferLegacyRunnerCli: vi.fn((provider: string) =>
    ['claude', 'codex', 'pi', 'mistral'].includes(provider)
      ? provider
      : 'opencode',
  ),
  validateCodingRuntimeSelection: vi.fn(
    (runtime: { cli: string; provider: string; model: string }) => {
      if (runtime.cli === 'devin') {
        if (
          runtime.provider === 'claude' &&
          runtime.model === 'claude-sonnet-4-6'
        ) {
          return;
        }
        throw new Error('Devin runtime mapping is unavailable');
      }
      const compatible: Record<string, string[]> = {
        claude: ['claude'],
        codex: ['codex'],
        opencode: ['opencode', 'openrouter', 'ollama', 'openai-compatible'],
        pi: ['pi'],
        mistral: ['mistral'],
      };
      if (!compatible[runtime.cli]?.includes(runtime.provider)) {
        throw new Error('incompatible runtime');
      }
    },
  ),
}));
vi.mock('../../../coding-jobs.js', () => ({
  startCodingJob,
  registerCodingRepo,
  loadCodingJobs: vi.fn(() => []),
  loadCodingRepos: vi.fn(() => []),
  listGitHubIssues: vi.fn(async () => []),
  listGitHubProjectBoards: vi.fn(async () => []),
  approveCodingJob: vi.fn(),
  approveCodingJobPr: vi.fn(),
  cancelCodingJob: vi.fn(),
  closeCodingJobPr: vi.fn(),
  denyCodingJob: vi.fn(),
  getCodingJob: vi.fn(),
  openCodingJobPr: vi.fn(),
  refreshCodingJobCi: vi.fn(),
  revertCodingJob: vi.fn(),
  retryCodingJob: vi.fn(),
}));

const { default: autofixRouter, handleAutofixWebhook } =
  await import('./routes.js');

function app(): express.Express {
  const server = express();
  server.use(express.json());
  server.use('/autofix', autofixRouter);
  return server;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer(app());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Unable to allocate test server port');
  }
  try {
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

function validProject(id = 'valid-project') {
  return {
    id,
    owner: 'owner',
    repo: 'repo',
    workDir: '/tmp/owner-repo',
    triggerLabel: 'autofix',
    provider: 'codex',
    model: 'gpt-5.4',
    runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
    notifyJid: '',
    autoReview: false,
    createPr: true,
    maxActiveJobs: 1,
    autoPickEnabled: false,
    pollIntervalMinutes: 15,
    lastAutoPickAt: null,
    createdAt: new Date(0).toISOString(),
  };
}

function writeRawProjects(value: string): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(PROJECTS_PATH, value);
}

async function request(
  method: string,
  route: string,
  body?: Record<string, unknown>,
) {
  return withServer((baseUrl) =>
    fetch(new URL(route, baseUrl), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

describe('Autofix persisted project fail-closed loading', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('treats a missing file as an empty project list', async () => {
    const response = await request('GET', '/autofix/projects');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it('rejects create on malformed JSON and preserves the exact file bytes', async () => {
    const original = '[{"id":"valid"},';
    writeRawProjects(original);

    const response = await request('POST', '/autofix/projects', {
      owner: 'new-owner',
      repo: 'new-repo',
      runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('Unable to load Autofix projects'),
    });
    expect(fs.readFileSync(PROJECTS_PATH, 'utf8')).toBe(original);
    expect(registerCodingRepo).not.toHaveBeenCalled();
  });

  it.each([
    [
      'create',
      'POST',
      '/autofix/projects',
      {
        owner: 'new-owner',
        repo: 'new-repo',
        runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
      },
    ],
    [
      'update',
      'PUT',
      '/autofix/projects/valid-project',
      { autoPickEnabled: true },
    ],
  ])(
    'rejects %s when one persisted record is invalid and preserves all bytes',
    async (_label, method, route, body) => {
      const original = `${JSON.stringify(
        [
          validProject(),
          {
            ...validProject('invalid-project'),
            runtime: {
              cli: 'opencode',
              provider: 'claude',
              model: 'claude-sonnet-4-6',
            },
          },
        ],
        null,
        2,
      )}\n`;
      writeRawProjects(original);

      const response = await request(method, route, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('Autofix project record 2 is invalid'),
      });
      expect(fs.readFileSync(PROJECTS_PATH, 'utf8')).toBe(original);
      expect(registerCodingRepo).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['run', '/autofix/run', { projectId: 'valid-project', issueNumber: 129 }],
    [
      'workbench',
      '/autofix/workbench/assign',
      { repo: 'owner/repo', issueNumber: 129 },
    ],
  ])(
    'rejects %s before dispatch when persisted records are invalid',
    async (_label, route, body) => {
      const original = JSON.stringify([
        validProject(),
        {
          ...validProject('bad'),
          runtime: { cli: 'opencode', provider: 'claude', model: 'bad' },
        },
      ]);
      writeRawProjects(original);

      const response = await request('POST', route, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('Autofix project record 2 is invalid'),
      });
      expect(startCodingJob).not.toHaveBeenCalled();
      expect(fs.readFileSync(PROJECTS_PATH, 'utf8')).toBe(original);
    },
  );

  it('rejects webhook processing when persisted records are invalid', async () => {
    const original = JSON.stringify([
      validProject(),
      {
        ...validProject('bad'),
        runtime: { cli: 'opencode', provider: 'claude', model: 'bad' },
      },
    ]);
    writeRawProjects(original);

    await expect(
      handleAutofixWebhook({
        repository: { full_name: 'owner/repo' },
        action: 'labeled',
        issue: { number: 129, labels: [{ name: 'autofix' }] },
      }),
    ).rejects.toThrow('Autofix project record 2 is invalid');
    expect(startCodingJob).not.toHaveBeenCalled();
    expect(fs.readFileSync(PROJECTS_PATH, 'utf8')).toBe(original);
  });
});
