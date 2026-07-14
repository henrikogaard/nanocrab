import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-coding-jobs-test/store',
  CODING_WORKSPACE_DIR: '/tmp/nanocrab-coding-jobs-test/data/coding-workspaces',
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanocrab-coding-jobs-test/data',
  TIMEZONE: 'UTC',
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
  },
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ GITHUB_TOKEN: 'test-token' })),
}));

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./container-runtime.js', () => ({
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  CONTAINER_RUNTIME_BIN: 'docker',
  hostGatewayArgs: vi.fn(() => [
    '--add-host=host.docker.internal:host-gateway',
  ]),
}));

vi.mock('./credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
}));

vi.mock('./provider-router.js', () => ({
  resolveProviderFallbackForAction: vi.fn(() => ({
    approved: true,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
  })),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn((command: string, args: string[]) => {
    if (command === 'git' && args[0] === 'rev-parse') return 'abc123def456\n';
    return '';
  }),
  spawn: vi.fn(() => {
    throw new Error('spawn should not run while coding jobs are queued');
  }),
}));

import {
  approveCodingJob,
  buildCodingPrompt,
  cancelCodingJob,
  cleanupCodingJob,
  getGitHubToken,
  githubGraphql,
  listGitHubIssues,
  listGitHubProjectBoards,
  loadCodingJobs,
  loadCodingRepos,
  getCodingJob,
  openCodingJobPr,
  pickGitHubIssue,
  refreshCodingJobCi,
  registerCodingRepo,
  startCodingJob,
  transitionCodingJob,
} from './coding-jobs.js';
import { listLearningProposals } from './learning-loop.js';
import { upsertRepoRule } from './repo-preferences.js';
import { resolveProviderFallbackForAction } from './provider-router.js';
import { createApproval, reviewApproval } from './approvals.js';
import { listAuditEvents } from './audit-log.js';
import { _closeDatabase, _initTestDatabase } from './db.js';
import { resetPolicyRules, savePolicyRules } from './policy-engine.js';
import { readEnvFile } from './env.js';
import { buildMistralVibeShellCommand } from './mistral-vibe-adapter.js';

const mockedReadEnvFile = vi.mocked(readEnvFile);
const { spawnSync: realSpawnSync } =
  await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  );

const TEST_ROOT = '/tmp/nanocrab-coding-jobs-test';

function writeLegacyJob({ provider }: { provider: string }): void {
  fs.mkdirSync(`${TEST_ROOT}/store`, { recursive: true });
  fs.writeFileSync(
    `${TEST_ROOT}/store/coding-jobs.json`,
    JSON.stringify(
      [
        {
          id: 'code-legacy',
          repo: 'owner/repo',
          type: 'prompt',
          prompt: 'Legacy job',
          issueNumber: null,
          issueTitle: null,
          provider,
          model: 'legacy-model',
          status: 'queued',
          branch: 'nanocrab/legacy',
          workspace: '/tmp/workspace',
          createPr: false,
          prUrl: null,
          output: '',
          requestedBy: 'dashboard',
          createdAt: new Date(0).toISOString(),
          completedAt: null,
        },
      ],
      null,
      2,
    ),
  );
}

function mockGitHubFetch(
  handler: (url: string) => unknown,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL) => ({
    ok: true,
    status: 200,
    json: async () => handler(String(url)),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createFakeProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  proc.pid = 12345;
  return proc;
}

function runGeneratedMistralCase(
  runScript: string,
  fakeStderr = '',
  fakeExit = 0,
): ReturnType<typeof realSpawnSync> {
  const match = runScript.match(/[ ]{2}mistral\)\n([\s\S]*?)\n[ ]{4};;/);
  if (!match) throw new Error('Generated Mistral case was not found');
  const fakeBin = path.join(TEST_ROOT, 'fake-vibe-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(fakeBin, 'vibe'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' \'{"result":"ok"}\'',
      'if [ -n "${FAKE_VIBE_STDERR:-}" ]; then',
      '  printf \'%s\\n\' "$FAKE_VIBE_STDERR" >&2',
      'fi',
      'exit "${FAKE_VIBE_EXIT:-0}"',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  return realSpawnSync('bash', ['-c', match[1]], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH || ''}`,
      PROMPT: 'test prompt',
      CODING_JOB_MAX_TURNS: '5',
      CODING_JOB_MAX_BUDGET_USD: '1',
      FAKE_VIBE_STDERR: fakeStderr,
      FAKE_VIBE_EXIT: String(fakeExit),
    },
  });
}

describe('coding jobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    vi.mocked(spawn).mockClear();
    vi.mocked(execFileSync).mockClear();
    mockedReadEnvFile.mockReturnValue({ GITHUB_TOKEN: 'test-token' });
    vi.mocked(resolveProviderFallbackForAction).mockReset();
    vi.mocked(resolveProviderFallbackForAction).mockReturnValue({
      approved: true,
      profile: {
        id: 'default_coding',
        label: 'Coding',
        purpose: 'default_coding',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        toolPolicy: 'approval-required',
        updatedAt: new Date(0).toISOString(),
      },
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    });
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    _initTestDatabase();
    resetPolicyRules();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    resetPolicyRules();
  });

  it('exposes getGitHubToken from the env fallback', () => {
    expect(getGitHubToken()).toBe('test-token');
  });

  it('githubGraphql posts to the GitHub GraphQL endpoint and returns data', async () => {
    mockGitHubFetch(() => ({
      data: { viewer: { login: 'henrikogaard' } },
    }));

    const result = await githubGraphql('query { viewer { login } }', {});

    expect(result).toEqual({ viewer: { login: 'henrikogaard' } });
  });

  it('githubGraphql rejects GraphQL errors in the response', async () => {
    mockGitHubFetch(() => ({
      errors: [{ message: 'Bad request' }],
    }));

    await expect(
      githubGraphql('query { viewer { login } }', {}),
    ).rejects.toThrow('Bad request');
  });

  it('registers an allowed GitHub repo with its default branch', async () => {
    mockGitHubFetch(() => ({ default_branch: 'develop' }));

    const repo = await registerCodingRepo({
      repo: 'owner/repo',
      labels: ['autofix'],
    });

    expect(repo).toMatchObject({
      fullName: 'owner/repo',
      defaultBranch: 'develop',
      labels: ['autofix'],
      enabled: true,
    });
    expect(loadCodingRepos()).toHaveLength(1);
  });

  it('lists open issues from registered repos and skips pull requests', async () => {
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/issues?')) {
        return [
          {
            number: 7,
            title: 'Fix scheduler',
            body: 'It drifts.',
            html_url: 'https://github.com/owner/repo/issues/7',
            updated_at: '2026-06-09T10:00:00Z',
            labels: [{ name: 'autofix' }],
            assignees: [{ login: 'henrik' }],
            user: { login: 'reporter' },
          },
          {
            number: 8,
            title: 'A PR',
            body: '',
            html_url: 'https://github.com/owner/repo/pull/8',
            updated_at: '2026-06-09T11:00:00Z',
            pull_request: {},
          },
        ];
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const issues = await listGitHubIssues({ repo: 'owner/repo', limit: 5 });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('labels=autofix'),
      expect.any(Object),
    );
    expect(issues).toEqual([
      {
        number: 7,
        title: 'Fix scheduler',
        body: 'It drifts.',
        labels: ['autofix'],
        assignees: ['henrik'],
        milestone: null,
        author: 'reporter',
        htmlUrl: 'https://github.com/owner/repo/issues/7',
        updatedAt: '2026-06-09T10:00:00Z',
      },
    ]);
  });

  it('can browse all open issues when an empty label filter is explicit', async () => {
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/issues?')) return [];
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    await listGitHubIssues({ repo: 'owner/repo', labels: [] });

    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.not.stringContaining('labels='),
      expect.any(Object),
    );
  });

  it('lists repository project boards for the GitHub workbench', async () => {
    const fetchMock = mockGitHubFetch((url) => {
      if (url.endsWith('/graphql')) {
        return {
          data: {
            repository: {
              projectsV2: {
                nodes: [
                  {
                    number: 12,
                    title: 'Roadmap',
                    url: 'https://github.com/orgs/owner/projects/12',
                    shortDescription: 'Current delivery board',
                    updatedAt: '2026-06-15T09:00:00Z',
                    closed: false,
                  },
                ],
              },
              projects: {
                nodes: [
                  {
                    name: 'Legacy bugs',
                    url: 'https://github.com/owner/repo/projects/1',
                    body: 'Classic project board',
                    updatedAt: '2026-06-14T09:00:00Z',
                    state: 'OPEN',
                  },
                ],
              },
            },
          },
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const boards = await listGitHubProjectBoards({ repo: 'owner/repo' });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"owner":"owner"'),
      }),
    );
    expect(boards).toEqual([
      {
        title: 'Roadmap',
        url: 'https://github.com/orgs/owner/projects/12',
        description: 'Current delivery board',
        updatedAt: '2026-06-15T09:00:00Z',
        closed: false,
        type: 'project_v2',
        number: 12,
      },
      {
        title: 'Legacy bugs',
        url: 'https://github.com/owner/repo/projects/1',
        description: 'Classic project board',
        updatedAt: '2026-06-14T09:00:00Z',
        closed: false,
        type: 'classic_project',
        number: null,
      },
    ]);
  });

  it('picks issues by direct number after applying repo, label, assignee, and milestone filters', async () => {
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/issues/42')) {
        return {
          number: 42,
          title: 'Repair approvals',
          body: 'Require a matching approval before mutation.',
          html_url: 'https://github.com/owner/repo/issues/42',
          updated_at: '2026-06-09T12:00:00Z',
          labels: [{ name: 'autofix' }, { name: 'p0' }],
          assignees: [{ login: 'henrik' }],
          milestone: { title: 'P0 Closure' },
          user: { login: 'reporter' },
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const result = await pickGitHubIssue({
      repo: 'owner/repo',
      issueNumber: 42,
      labels: ['autofix', 'p0'],
      assignee: 'henrik',
      milestone: 'P0 Closure',
      requestedBy: 'dashboard',
    });

    expect(result?.issue.number).toBe(42);
    expect(result?.job.issueNumber).toBe(42);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/owner/repo/issues/42'),
      expect.any(Object),
    );
  });

  it('resolves milestone titles before querying GitHub issues', async () => {
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/milestones?')) {
        return [
          { number: 3, title: 'P0 Closure' },
          { number: 4, title: 'Later' },
        ];
      }
      if (url.includes('/issues?')) {
        return [
          {
            number: 51,
            title: 'Close P0 issue',
            body: '',
            html_url: 'https://github.com/owner/repo/issues/51',
            updated_at: '2026-06-09T12:00:00Z',
            labels: [{ name: 'autofix' }],
            assignees: [],
            milestone: { title: 'P0 Closure' },
            user: { login: 'reporter' },
          },
        ];
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const issues = await listGitHubIssues({
      repo: 'owner/repo',
      milestone: 'P0 Closure',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/owner/repo/milestones?'),
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('milestone=3'),
      expect.any(Object),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('milestone=P0+Closure'),
      expect.any(Object),
    );
    expect(issues.map((issue) => issue.number)).toEqual([51]);
  });

  it('does not auto-pick issues from repos without an enabled coding repo config', async () => {
    mockGitHubFetch(() => [
      {
        number: 9,
        title: 'Should not run',
        html_url: 'https://github.com/owner/repo/issues/9',
        updated_at: '2026-06-09T12:00:00Z',
      },
    ]);

    await expect(
      pickGitHubIssue({
        repo: 'owner/repo',
        labels: ['autofix'],
        requestedBy: 'dashboard',
      }),
    ).rejects.toThrow('not registered for coding jobs');
  });

  it('queues OpenRouter coding jobs as coding-capable provider work', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      provider: 'openrouter',
      model: 'openrouter/auto',
      requestedBy: 'whatsapp_main',
    });

    expect(job.provider).toBe('openrouter');
    expect(job.model).toBe('openrouter/auto');
    expect(job.status).toBe('queued');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects Ollama coding jobs unless the selected model is code-capable', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    await expect(
      startCodingJob({
        repo: 'owner/repo',
        prompt: 'Implement the issue.',
        provider: 'ollama',
        model: 'llama3',
        requestedBy: 'whatsapp_main',
      }),
    ).rejects.toThrow('chat/local-task only');

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Implement the issue.',
      provider: 'ollama',
      model: 'codestral',
      requestedBy: 'whatsapp_main',
    });
    expect(job.provider).toBe('ollama');
    expect(job.model).toBe('codestral');
  });

  it('throws on invalid workflow state transitions', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    expect(() => transitionCodingJob(job.id, 'open_pr')).toThrow(
      'Invalid coding job transition',
    );
  });

  it('queues coding jobs without blocking on git clone', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    expect(job.status).toBe('queued');
    expect(job.workspace).toContain('/data/coding-workspaces/jobs/');
    expect(loadCodingJobs()).toHaveLength(1);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('stores agent profile attribution on coding jobs', async () => {
    mockGitHubFetch((url) => {
      if (url.includes('/repos/owner/repo')) return { default_branch: 'main' };
      return {};
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Fix profile attribution',
      requestedBy: 'agent:repofixer',
      agentProfileId: 'agent_repo_fixer',
      sourceSubscriptionId: 'sub_1',
    });

    expect(job.agentProfileId).toBe('agent_repo_fixer');
    expect(job.sourceSubscriptionId).toBe('sub_1');
    expect(loadCodingJobs()[0].agentProfileId).toBe('agent_repo_fixer');
  });

  it('stores pipeline, stage, decision, and actual runtime attribution on coding jobs', async () => {
    mockGitHubFetch((url) => {
      if (url.includes('/repos/owner/repo')) return { default_branch: 'main' };
      return {};
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const actualRuntime = {
      cli: 'claude' as const,
      provider: 'claude' as const,
      model: 'claude-sonnet-4-6',
    };
    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Fix pipeline attribution',
      requestedBy: 'control-plane',
      pipelineId: 'pipeline_1',
      stageId: 'stage_planning',
      stageKind: 'planning',
      runId: 'run_1',
      decisionId: 'decision_1',
      actualRuntime,
    });

    expect(job.pipelineId).toBe('pipeline_1');
    expect(job.stageId).toBe('stage_planning');
    expect(job.stageKind).toBe('planning');
    expect(job.runId).toBe('run_1');
    expect(job.pushed).toBe(false);
    expect(job.stageEvidence).toBeNull();
    expect(job.decisionId).toBe('decision_1');
    expect(job.actualRuntime).toEqual(actualRuntime);
    expect(loadCodingJobs()[0].actualRuntime).toEqual(actualRuntime);
  });

  it('persists runner CLI from the complete actual runtime', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Use Devin',
      requestedBy: 'control-plane',
      actualRuntime: {
        cli: 'devin',
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      },
    });
    expect(job.runnerCli).toBe('devin');
    expect(loadCodingJobs()[0].runnerCli).toBe('devin');
    expect(job.executionAttempts).toEqual([]);
    expect(job.activeAttemptId).toBeNull();
  });

  it.each([
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['opencode', 'opencode'],
    ['openrouter', 'opencode'],
    ['ollama', 'opencode'],
    ['openai-compatible', 'opencode'],
    ['pi', 'pi'],
    ['mistral', 'mistral'],
  ])('normalizes legacy provider %s to runner %s', (provider, runnerCli) => {
    writeLegacyJob({ provider });
    expect(loadCodingJobs()[0]).toMatchObject({
      runnerCli,
      activeAttemptId: null,
      executionAttempts: [],
    });
  });

  it('normalizes missing agent profile attribution fields to null', () => {
    fs.mkdirSync(`${TEST_ROOT}/store`, { recursive: true });
    fs.writeFileSync(
      `${TEST_ROOT}/store/coding-jobs.json`,
      JSON.stringify(
        [
          {
            id: 'code-legacy',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'Legacy job',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'queued',
            branch: 'nanocrab/legacy',
            workspace: '/tmp/workspace',
            createPr: false,
            prUrl: null,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: null,
          },
        ],
        null,
        2,
      ),
    );

    const job = loadCodingJobs()[0];

    expect(job.agentProfileId).toBeNull();
    expect(job.sourceSubscriptionId).toBeNull();
    expect(job.pipelineId).toBeNull();
    expect(job.stageId).toBeNull();
    expect(job.stageKind).toBeNull();
    expect(job.runId).toBeNull();
    expect(job.pushed).toBe(false);
    expect(job.stageEvidence).toBeNull();
    expect(job.decisionId).toBeNull();
    expect(job.actualRuntime).toBeNull();
  });

  it('includes approved repo preference rules in coding prompts', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    upsertRepoRule({
      repo: 'owner/repo',
      title: 'Use npm scripts',
      content: 'Run the repo npm scripts instead of ad-hoc shell checks.',
      source: 'memory:repo-rule',
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Update dashboard code.',
      requestedBy: 'dashboard',
    });

    expect(buildCodingPrompt(job)).toContain(
      '- Use npm scripts: Run the repo npm scripts instead of ad-hoc shell checks.',
    );
  });

  it('dry-runs coding jobs without spawning a write-capable container', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Preview a risky repository update.',
      requestedBy: 'whatsapp_main',
      dryRun: true,
      createPr: true,
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(getCodingJob(job.id)?.output).toContain('Dry-run simulation');
    expect(getCodingJob(job.id)?.changedFiles).toEqual([]);
    expect(
      listAuditEvents({ correlationId: job.id }).some(
        (event) => event.decision === 'simulated',
      ),
    ).toBe(true);
  });

  it('audits denied dry-run implementation policies before failing the job', async () => {
    vi.useRealTimers();
    savePolicyRules([
      {
        id: 'deny-implementation',
        actionPattern: 'coding.implement',
        risk: 'high',
        deny: true,
        explanation: 'Implementation blocked for test.',
      },
    ]);
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Preview a risky repository update.',
      requestedBy: 'whatsapp_main',
      dryRun: true,
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('failed');
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(
      listAuditEvents({ correlationId: job.id }).some(
        (event) =>
          event.actionType === 'coding.implement' &&
          event.decision === 'denied',
      ),
    ).toBe(true);
  });

  it('audits denied implementation policies without marking them approved', async () => {
    vi.useRealTimers();
    savePolicyRules([
      {
        id: 'deny-implementation',
        actionPattern: 'coding.implement',
        risk: 'high',
        deny: true,
        explanation: 'Implementation blocked for test.',
      },
    ]);
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('failed');
    });

    const implementationEvents = listAuditEvents({
      correlationId: job.id,
    }).filter((event) => event.actionType === 'coding.implement');
    expect(
      implementationEvents.some((event) => event.decision === 'denied'),
    ).toBe(true);
    expect(
      implementationEvents.some((event) => event.decision === 'approved'),
    ).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('blocks write-capable provider fallback before spawning a coding container', async () => {
    vi.mocked(resolveProviderFallbackForAction).mockReturnValueOnce({
      approved: false,
      approvalId: 'approval-provider-fallback',
      reason: 'provider fallback requires approval',
    });
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    expect(getCodingJob(job.id)?.output).toContain(
      'provider fallback requires approval',
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it('runs queued coding jobs in an isolated container workspace', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.stdout.push('agent output\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });
    expect(spawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining([
        'run',
        '--rm',
        '--name',
        `nanocrab-code-${job.id}`,
        '-v',
        expect.stringContaining(`${job.id}:/workspace/coding-job`),
        '--entrypoint',
        '/bin/bash',
        'nanocrab-agent:test',
        '/workspace/coding-job/.nanocrab/run.sh',
      ]),
      expect.objectContaining({
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    expect(getCodingJob(job.id)?.output).toContain('agent output');
    expect(getCodingJob(job.id)?.transitionedAt).toMatchObject({
      investigate: expect.any(String),
      plan: expect.any(String),
      await_approval: expect.any(String),
      implement: expect.any(String),
      test: expect.any(String),
      completed: expect.any(String),
    });
  });

  it('derives a learning proposal when a coding job completes', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.stdout.push('agent output\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });

    await vi.waitFor(() => {
      const proposals = listLearningProposals({ sourceRunId: job.id });
      expect(proposals.length).toBe(1);
    });

    const [proposal] = listLearningProposals({ sourceRunId: job.id });
    expect(proposal.type).toBe('memory');
    expect(proposal.extractedLesson).toContain('Task:');
  });

  it('derives a skill draft when a coding job is completed from a skill prompt', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.stdout.push('agent output\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'skill: add a focused regression test helper',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });

    await vi.waitFor(() => {
      const proposals = listLearningProposals({ sourceRunId: job.id });
      expect(proposals.length).toBe(1);
    });

    const [proposal] = listLearningProposals({ sourceRunId: job.id });
    expect(proposal.type).toBe('skill-draft');
    expect(proposal.extractedLesson).toMatch(/^---\nname: skill-/);
  });

  it('preserves legacy Pi and Mistral dispatch contract for Pi', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(resolveProviderFallbackForAction).mockReturnValue({
      approved: true,
      profile: {
        id: 'default_coding',
        label: 'Coding',
        purpose: 'default_coding',
        provider: 'pi',
        model: 'gemini-2.5-pro',
        toolPolicy: 'approval-required',
        updatedAt: new Date(0).toISOString(),
      },
      provider: 'pi',
      model: 'gemini-2.5-pro',
    });

    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      const metadataDir = `${jobRoot}/.nanocrab`;

      const runScript = fs.readFileSync(`${metadataDir}/run.sh`, 'utf-8');
      expect(runScript).toContain(
        'pi -p "$PROMPT" --mode json --model "$PI_JOB_MODEL" --provider openrouter --no-session',
      );
      expect(runScript).not.toContain('devin');
      const models = JSON.parse(
        fs.readFileSync(`${metadataDir}/pi-agent/models.json`, 'utf-8'),
      );
      expect(models.providers.openrouter.baseUrl).toContain(
        '__nanocrab/providers/openrouter',
      );
      expect(
        fs.readFileSync(`${metadataDir}/pi-agent/auth.json`, 'utf-8'),
      ).toBe('{}');

      setImmediate(() => {
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.stdout.push('agent output\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      provider: 'pi',
      model: 'gemini-2.5-pro',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });
  });

  it('preserves legacy Pi and Mistral dispatch contract for Mistral', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(resolveProviderFallbackForAction).mockReturnValue({
      approved: true,
      profile: {
        id: 'default_coding',
        label: 'Coding',
        purpose: 'default_coding',
        provider: 'mistral',
        model: 'mistral-large-latest',
        toolPolicy: 'approval-required',
        updatedAt: new Date(0).toISOString(),
      },
      provider: 'mistral',
      model: 'mistral-large-latest',
    });

    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      const metadataDir = `${jobRoot}/.nanocrab`;

      const runScript = fs.readFileSync(`${metadataDir}/run.sh`, 'utf-8');
      expect(runScript).toContain(
        buildMistralVibeShellCommand({
          prompt: '"$PROMPT"',
          maxTurns: '"$CODING_JOB_MAX_TURNS"',
          maxPrice: '"$CODING_JOB_MAX_BUDGET_USD"',
        }),
      );
      expect(runScript).not.toContain('devin');
      expect(runScript).not.toMatch(/--auto-approve|--workdir|--trust/);
      const successfulVibe = runGeneratedMistralCase(runScript);
      expect(successfulVibe.status).toBe(0);
      expect(successfulVibe.stdout).toContain('{"result":"ok"}');
      expect(successfulVibe.stderr).toBe('');

      const warningVibe = runGeneratedMistralCase(
        runScript,
        'provider warning',
      );
      expect(warningVibe.status).not.toBe(0);
      expect(warningVibe.stdout).toContain('{"result":"ok"}');
      expect(warningVibe.stderr).toContain('provider warning');

      const failedVibe = runGeneratedMistralCase(
        runScript,
        'provider failure',
        7,
      );
      expect(failedVibe.status).toBe(7);
      expect(failedVibe.stdout).toContain('{"result":"ok"}');
      expect(failedVibe.stderr).toContain('provider failure');
      const config = fs.readFileSync(
        `${metadataDir}/vibe-home/config.toml`,
        'utf-8',
      );
      expect(config).toContain('active_model = "nanocrab"');
      expect(config).toContain('provider = "mistral"');
      expect(config).toContain('alias = "nanocrab"');
      expect(config).toContain('api_key_env_var = "MISTRAL_API_KEY"');
      expect(config).toContain('name = "mistral-large-latest"');

      setImmediate(() => {
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.stdout.push('agent output\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      provider: 'mistral',
      model: 'mistral-large-latest',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)).toMatchObject({
        status: 'completed',
        failureReason: null,
      });
    });
  });

  it('routes OpenRouter coding job credentials through the host proxy', async () => {
    vi.useRealTimers();
    mockedReadEnvFile.mockReturnValue({
      GITHUB_TOKEN: 'test-token',
      OPENROUTER_API_KEY: 'sk-real-openrouter',
      OPENROUTER_BASE_URL: 'https://openrouter.example/v1',
    });
    vi.mocked(resolveProviderFallbackForAction).mockReturnValue({
      approved: true,
      profile: {
        id: 'default_coding',
        label: 'Coding',
        purpose: 'default_coding',
        provider: 'openrouter',
        model: 'openrouter/auto',
        toolPolicy: 'approval-required',
        updatedAt: new Date(0).toISOString(),
      },
      provider: 'openrouter',
      model: 'openrouter/auto',
    });
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    let envFileContent = '';
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const envFilePath = argv[argv.indexOf('--env-file') + 1];
      envFileContent = fs.readFileSync(envFilePath, 'utf-8');
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, '');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      provider: 'openrouter',
      model: 'openrouter/auto',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });
    expect(envFileContent).toContain('OPENROUTER_API_KEY=placeholder');
    expect(envFileContent).toContain('AGENT_PROVIDER_API_KEY=placeholder');
    expect(envFileContent).toContain(
      'OPENROUTER_BASE_URL=http://host.docker.internal:3001/__nanocrab/providers/openrouter',
    );
    expect(envFileContent).toContain(
      'AGENT_PROVIDER_BASE_URL=http://host.docker.internal:3001/__nanocrab/providers/openrouter',
    );
    expect(envFileContent).not.toContain('sk-real-openrouter');
    expect(envFileContent).not.toContain('openrouter.example');
  });

  it('blocks implementation before plan approval', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(() => transitionCodingJob(job.id, 'implement')).toThrow(
      'Implementation approval is required',
    );
    expect(getCodingJob(job.id)?.failureReason).toContain(
      'Implementation approval is required',
    );
  });

  it('does not schedule multiple implementation runs when approval is repeated', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, '');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });

    const firstApproval = approveCodingJob(job.id, 'owner');
    const repeatedApproval = approveCodingJob(job.id, 'owner');

    expect(firstApproval.status).toBe('implement');
    expect(repeatedApproval.status).toBe('implement');
    expect(repeatedApproval.id).toBe(job.id);

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('completed');
    });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('blocks provider fallback for PR creation before creating a GitHub PR', async () => {
    vi.useRealTimers();
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/9' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(resolveProviderFallbackForAction)
      .mockReturnValueOnce({
        approved: true,
        profile: {
          id: 'default_coding',
          label: 'Coding',
          purpose: 'default_coding',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          toolPolicy: 'approval-required',
          updatedAt: new Date(0).toISOString(),
        },
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      })
      .mockReturnValueOnce({
        approved: true,
        profile: {
          id: 'default_coding',
          label: 'Coding',
          purpose: 'default_coding',
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          toolPolicy: 'approval-required',
          updatedAt: new Date(0).toISOString(),
        },
        provider: 'claude',
        model: 'claude-sonnet-4-6',
      })
      .mockReturnValueOnce({
        approved: false,
        approvalId: 'approval-pr-provider-fallback',
        reason: 'provider fallback for PR requires approval',
      });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve test PR',
      summary: 'Allow test PR creation.',
      requester: 'test',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'test');

    await openCodingJobPr(job.id, 'owner');

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    expect(resolveProviderFallbackForAction).toHaveBeenCalledWith({
      purpose: 'default_coding',
      action: 'pr-creation',
      requester: 'owner',
      correlationId: job.id,
    });
    expect(getCodingJob(job.id)?.output).toContain(
      'Provider fallback for PR creation is awaiting approval',
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/pulls'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens a PR only after the matching PR approval is approved', async () => {
    vi.useRealTimers();
    const fetchMock = mockGitHubFetch((url) => {
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/10' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        fs.writeFileSync(`${metadataDir}/test-summary.txt`, 'vitest passed\n');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });

    await expect(openCodingJobPr(job.id, 'owner')).rejects.toThrow(
      'PR approval is required',
    );
    const wrongApproval = createApproval({
      kind: 'coding-open-pr',
      title: 'Wrong job',
      summary: 'Wrong target',
      targetType: 'coding-job',
      targetId: 'other-job',
    });
    reviewApproval(wrongApproval.id, 'approved', 'owner');
    await expect(openCodingJobPr(job.id, 'owner')).rejects.toThrow(
      'PR approval is required',
    );

    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve PR',
      summary: 'Allow this job to publish a PR.',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'owner');
    const opened = await openCodingJobPr(job.id, 'owner');

    expect(opened.prUrl).toBe('https://github.com/owner/repo/pull/10');
    expect(opened.status).toBe('ci_running');
    expect(opened.testSummary).toContain('vitest passed');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/repos/owner/repo/pulls'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('records successful CI and completes a PR job', async () => {
    vi.useRealTimers();
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123def456/status')) {
        return { state: 'success', statuses: [] };
      }
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/11' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve PR',
      summary: 'Allow this job to publish a PR.',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'owner');
    const opened = await openCodingJobPr(job.id, 'owner');

    const refreshed = await refreshCodingJobCi(opened.id);

    expect(refreshed.ciStatus).toBe('success');
    expect(refreshed.lastCiError).toBeNull();
    expect(refreshed.status).toBe('completed');
    expect(refreshed.transitionedAt.completed).toEqual(expect.any(String));
  });

  it('records failing CI details and completes a PR job', async () => {
    vi.useRealTimers();
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123def456/status')) {
        return {
          state: 'failure',
          statuses: [
            {
              state: 'success',
              context: 'lint',
              description: 'lint passed',
            },
            {
              state: 'failure',
              context: 'test',
              description: 'vitest failed on coding-jobs.test.ts',
            },
          ],
        };
      }
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/12' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve PR',
      summary: 'Allow this job to publish a PR.',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'owner');
    const opened = await openCodingJobPr(job.id, 'owner');

    const refreshed = await refreshCodingJobCi(opened.id);

    expect(refreshed.ciStatus).toBe('failure');
    expect(refreshed.lastCiError).toContain('test: vitest failed');
    expect(refreshed.status).toBe('completed');
    expect(refreshed.failureReason).toBeNull();
  });

  it('records successful GitHub Actions check runs when commit statuses are pending', async () => {
    vi.useRealTimers();
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123def456/status')) {
        return { state: 'pending', statuses: [] };
      }
      if (url.includes('/commits/abc123def456/check-runs')) {
        return {
          check_runs: [
            { name: 'build', status: 'completed', conclusion: 'success' },
            { name: 'test', status: 'completed', conclusion: 'neutral' },
          ],
        };
      }
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/13' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve PR',
      summary: 'Allow this job to publish a PR.',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'owner');
    const opened = await openCodingJobPr(job.id, 'owner');

    const refreshed = await refreshCodingJobCi(opened.id);

    expect(refreshed.ciStatus).toBe('success');
    expect(refreshed.lastCiError).toBeNull();
    expect(refreshed.status).toBe('completed');
  });

  it('records failing GitHub Actions check run details without commit statuses', async () => {
    vi.useRealTimers();
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123def456/status')) {
        return { state: 'pending', statuses: [] };
      }
      if (url.includes('/commits/abc123def456/check-runs')) {
        return {
          check_runs: [
            { name: 'build', status: 'completed', conclusion: 'success' },
            {
              name: 'test',
              status: 'completed',
              conclusion: 'failure',
              html_url: 'https://github.com/owner/repo/actions/runs/1',
            },
          ],
        };
      }
      if (url.includes('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/14' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
        proc.emit('close', 0);
      });
      return proc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });
    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_pr_approval');
    });
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: 'Approve PR',
      summary: 'Allow this job to publish a PR.',
      targetType: 'coding-job',
      targetId: job.id,
    });
    reviewApproval(approval.id, 'approved', 'owner');
    const opened = await openCodingJobPr(job.id, 'owner');

    const refreshed = await refreshCodingJobCi(opened.id);

    expect(refreshed.ciStatus).toBe('failure');
    expect(refreshed.lastCiError).toContain('test: failure');
    expect(refreshed.status).toBe('completed');
  });

  it('cancels an active implementation run and preserves the worktree, branch, and PR fields', async () => {
    vi.useRealTimers();
    mockGitHubFetch(() => ({ default_branch: 'main' }));
    await registerCodingRepo({ repo: 'owner/repo' });

    let fakeProc!: ReturnType<typeof createFakeProcess>;
    vi.mocked(spawn).mockImplementation((_command, args) => {
      fakeProc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const jobRoot = firstMount.split(':')[0];
      setImmediate(() => {
        const metadataDir = `${jobRoot}/.nanocrab`;
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.mkdirSync(`${jobRoot}/owner__repo`, { recursive: true });
        fs.writeFileSync(`${metadataDir}/diff-stat.txt`, 'src/a.ts | 1 +\n');
        fs.writeFileSync(`${metadataDir}/changed-files.txt`, 'src/a.ts\n');
        fs.writeFileSync(`${metadataDir}/untracked.txt`, '');
      });
      return fakeProc as never;
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Cancel me before I finish.',
      requestedBy: 'whatsapp_main',
      createPr: true,
    });
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('await_approval');
    });

    approveCodingJob(job.id, 'owner');
    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('implement');
    });
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    cancelCodingJob(job.id, 'owner');
    fakeProc.emit('close', 137);

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.status).toBe('cancelled');
    });

    expect(fakeProc.kill).toHaveBeenCalledWith('SIGTERM');
    const cancelled = getCodingJob(job.id)!;
    expect(cancelled.prUrl).toBeNull();
    expect(cancelled.commitSha).toBeNull();
    expect(cancelled.pushed).toBe(false);
    expect(fs.existsSync(cancelled.workspace)).toBe(true);
    expect(cancelled.branch).toBe(job.branch);
  });

  it('explains why cleanup is blocked under different conditions', () => {
    fs.mkdirSync(`${TEST_ROOT}/store`, { recursive: true });
    fs.writeFileSync(
      `${TEST_ROOT}/store/coding-jobs.json`,
      JSON.stringify(
        [
          {
            id: 'job-active',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'Active',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'implement',
            branch: 'nanocrab/active',
            workspace: '/tmp/workspace-active',
            createPr: true,
            prUrl: null,
            pushed: false,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: null,
          },
          {
            id: 'job-pending',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'Pending',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'await_approval',
            branch: 'nanocrab/pending',
            workspace: '/tmp/workspace-pending',
            createPr: true,
            prUrl: null,
            pushed: false,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: null,
          },
          {
            id: 'job-unpushed',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'Unpushed',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'completed',
            branch: 'nanocrab/unpushed',
            workspace: '/tmp/workspace-unpushed',
            createPr: true,
            prUrl: null,
            pushed: false,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: new Date(0).toISOString(),
          },
          {
            id: 'job-pr',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'PR open',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'completed',
            branch: 'nanocrab/pr',
            workspace: '/tmp/workspace-pr',
            createPr: true,
            prUrl: 'https://github.com/owner/repo/pull/1',
            pushed: true,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: new Date(0).toISOString(),
          },
          {
            id: 'job-clean',
            repo: 'owner/repo',
            type: 'prompt',
            prompt: 'Clean',
            issueNumber: null,
            issueTitle: null,
            provider: 'claude',
            model: 'claude-sonnet-4-6',
            status: 'completed',
            branch: 'nanocrab/clean',
            workspace: '/tmp/workspace-clean',
            createPr: true,
            prUrl: null,
            pushed: true,
            output: '',
            requestedBy: 'dashboard',
            createdAt: new Date(0).toISOString(),
            completedAt: new Date(0).toISOString(),
          },
        ],
        null,
        2,
      ),
    );

    expect(cleanupCodingJob('job-active').reason).toMatch(/run is active/i);
    expect(cleanupCodingJob('job-pending').reason).toMatch(
      /decision is pending/i,
    );
    expect(cleanupCodingJob('job-unpushed').reason).toMatch(
      /branch is not pushed/i,
    );
    expect(cleanupCodingJob('job-pr').reason).toMatch(/PR remains open/i);
    expect(cleanupCodingJob('job-clean').ok).toBe(true);
  });
});
