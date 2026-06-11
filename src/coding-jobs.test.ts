import fs from 'fs';
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

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => 'abc123\n'),
  spawn: vi.fn(() => {
    throw new Error('spawn should not run while coding jobs are queued');
  }),
}));

import { listApprovals } from './approvals.js';

import {
  listGitHubIssues,
  loadCodingJobs,
  loadCodingRepos,
  getCodingJob,
  getCodingJobCockpitSummary,
  approveCodingJob,
  listCodingJobTimeline,
  pickGitHubIssue,
  registerCodingRepo,
  refreshCodingJobCi,
  startCodingJob,
} from './coding-jobs.js';

const TEST_ROOT = '/tmp/nanocrab-coding-jobs-test';

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
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  return proc;
}

describe('coding jobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    vi.mocked(spawn).mockClear();
    vi.mocked(execFileSync).mockClear();
    vi.mocked(execFileSync).mockReturnValue('abc123\n');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.NANOCRAB_DRY_RUN;
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
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

  it('stores repo coding preferences and injects them into job prompts', async () => {
    mockGitHubFetch(() => ({ default_branch: 'main' }));

    await registerCodingRepo({
      repo: 'owner/repo',
      labels: ['autofix'],
      codingRules: 'Run npm test before opening a PR.',
      trustedForPr: true,
      defaultProvider: 'codex',
      defaultModel: 'gpt-5.4',
    });

    const repo = loadCodingRepos()[0];
    expect(repo).toMatchObject({
      codingRules: 'Run npm test before opening a PR.',
      trustedForPr: true,
      defaultProvider: 'codex',
      defaultModel: 'gpt-5.4',
    });

    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });

    const promptPath = `${job.workspace.replace(/owner__repo$/, '')}.nanocrab/prompt.txt`;
    expect(fs.readFileSync(promptPath, 'utf-8')).toContain(
      'Repo coding rules:\nRun npm test before opening a PR.',
    );
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
        author: 'reporter',
        htmlUrl: 'https://github.com/owner/repo/issues/7',
        updatedAt: '2026-06-09T10:00:00Z',
      },
    ]);
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

  it('does not queue or request implementation approval while dry-run mode is enabled', async () => {
    process.env.NANOCRAB_DRY_RUN = 'true';
    mockGitHubFetch((url) => {
      if (url.endsWith('/issues/7')) {
        return {
          number: 7,
          title: 'Fix scheduler',
          body: 'It drifts.',
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      issueNumber: 7,
      requestedBy: 'whatsapp_main',
    });

    expect(job.status).toBe('completed');
    expect(job.output).toContain('Dry-run mode');
    expect(spawn).not.toHaveBeenCalled();
    expect(
      listApprovals({
        kind: 'coding-implement',
        targetType: 'coding-job',
        targetId: job.id,
      }),
    ).toHaveLength(0);
  });

  it('requires approval before implementing an issue coding job', async () => {
    mockGitHubFetch((url) => {
      if (url.endsWith('/issues/7')) {
        return {
          number: 7,
          title: 'Fix scheduler',
          body: 'It drifts.',
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      issueNumber: 7,
      requestedBy: 'whatsapp_main',
    });

    expect(job.status).toBe('await_approval');
    expect(job.investigationSummary).toContain(
      'ready for implementation approval',
    );
    expect(job.implementationPlan).toContain('Implementation plan:');
    expect(loadCodingJobs()).toHaveLength(1);
    expect(spawn).not.toHaveBeenCalled();
    const planPath = `${job.workspace.replace(/owner__repo$/, '')}.nanocrab/implementation-plan.md`;
    expect(fs.readFileSync(planPath, 'utf-8')).toContain(
      'Investigate owner/repo issue #7',
    );

    approveCodingJob(job.id, 'tester');

    expect(getCodingJob(job.id)?.status).toBe('queued');
    expect(
      listApprovals({
        kind: 'coding-implement',
        targetType: 'coding-job',
        targetId: job.id,
      })[0]?.status,
    ).toBe('approved');
    expect(getCodingJob(job.id)?.timeline.map((event) => event.kind)).toContain(
      'approval',
    );
    expect(
      getCodingJob(job.id)?.timeline.map((event) => event.title),
    ).toContain('Implementation plan prepared');
  });

  it('summarizes coding cockpit state and timeline events', async () => {
    mockGitHubFetch((url) => {
      if (url.endsWith('/issues/7')) {
        return {
          number: 7,
          title: 'Fix scheduler',
          body: 'It drifts.',
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });

    const job = await startCodingJob({
      repo: 'owner/repo',
      issueNumber: 7,
      requestedBy: 'whatsapp_main',
    });

    expect(getCodingJobCockpitSummary()).toMatchObject({
      total: 1,
      waitingApproval: 1,
    });
    expect(listCodingJobTimeline().map((event) => event.jobId)).toContain(
      job.id,
    );
    expect(listCodingJobTimeline()[0]).toMatchObject({
      repo: 'owner/repo',
      status: 'await_approval',
      issueNumber: 7,
    });
  });

  it('assigns picked issues to the configured repo assignee before planning', async () => {
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
            assignees: [],
            user: { login: 'reporter' },
          },
        ];
      }
      if (url.endsWith('/issues/7')) {
        return {
          number: 7,
          title: 'Fix scheduler',
          body: '- [ ] Add a regression test',
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({
      repo: 'owner/repo',
      labels: ['autofix'],
      assignee: 'henrik',
    });

    const result = await pickGitHubIssue({
      repo: 'owner/repo',
      requestedBy: 'whatsapp_main',
    });

    expect(result?.issue.assignees).toContain('henrik');
    expect(result?.job.status).toBe('await_approval');
    expect(result?.job.implementationPlan).toContain('Add a regression test');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/issues/7'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ assignees: ['henrik'] }),
      }),
    );
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
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(getCodingJob(job.id)?.output).toContain('agent output');
    expect(getCodingJob(job.id)?.timeline.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['status', 'container', 'diff']),
    );
  });

  it('refreshes CI status from GitHub commit status', async () => {
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123/status')) {
        return {
          state: 'success',
          statuses: [{ context: 'test', description: 'passed' }],
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });
    const saved = getCodingJob(job.id)!;
    saved.commitSha = 'abc123';
    saved.ciStatus = 'pending';
    fs.mkdirSync('/tmp/nanocrab-coding-jobs-test/store', { recursive: true });
    fs.writeFileSync(
      '/tmp/nanocrab-coding-jobs-test/store/coding-jobs.json',
      `${JSON.stringify([saved], null, 2)}\n`,
    );

    const refreshed = await refreshCodingJobCi(job.id);

    expect(refreshed.ciStatus).toBe('success');
    expect(refreshed.testSummary).toContain('test: passed');
    expect(refreshed.timeline.map((event) => event.kind)).toContain('ci');
  });

  it('combines GitHub commit status and check runs when refreshing CI', async () => {
    mockGitHubFetch((url) => {
      if (url.includes('/commits/abc123/status')) {
        return {
          state: 'success',
          statuses: [{ context: 'lint', description: 'passed' }],
        };
      }
      if (url.includes('/commits/abc123/check-runs')) {
        return {
          check_runs: [
            {
              name: 'unit tests',
              status: 'completed',
              conclusion: 'failure',
              output: { title: '1 failed' },
            },
          ],
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo' });
    const job = await startCodingJob({
      repo: 'owner/repo',
      prompt: 'Add a focused regression test.',
      requestedBy: 'whatsapp_main',
    });
    const saved = getCodingJob(job.id)!;
    saved.commitSha = 'abc123';
    fs.mkdirSync('/tmp/nanocrab-coding-jobs-test/store', { recursive: true });
    fs.writeFileSync(
      '/tmp/nanocrab-coding-jobs-test/store/coding-jobs.json',
      `${JSON.stringify([saved], null, 2)}\n`,
    );

    const refreshed = await refreshCodingJobCi(job.id);

    expect(refreshed.ciStatus).toBe('failure');
    expect(refreshed.testSummary).toContain('unit tests: failure: 1 failed');
  });

  it('lets trusted repos create PRs without a separate PR approval', async () => {
    vi.useRealTimers();
    const fetchMock = mockGitHubFetch((url) => {
      if (url.endsWith('/pulls')) {
        return { html_url: 'https://github.com/owner/repo/pull/12' };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', trustedForPr: true });
    vi.mocked(spawn).mockImplementation((_command, args) => {
      const proc = createFakeProcess();
      const argv = args as string[];
      const firstMount = argv[argv.indexOf('-v') + 1];
      const envFile = argv[argv.indexOf('--env-file') + 1];
      const jobRoot = firstMount.split(':')[0];
      expect(fs.readFileSync(envFile, 'utf-8')).toContain('CREATE_PR=true');
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
      createPr: true,
      requestedBy: 'whatsapp_main',
    });

    await vi.waitFor(() => {
      expect(getCodingJob(job.id)?.prUrl).toBe(
        'https://github.com/owner/repo/pull/12',
      );
    });
    expect(
      listApprovals({
        kind: 'coding-open-pr',
        targetType: 'coding-job',
        targetId: job.id,
      }),
    ).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/pulls'),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
