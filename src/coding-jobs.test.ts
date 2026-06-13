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

vi.mock('./provider-router.js', () => ({
  resolveProviderFallbackForAction: vi.fn(() => ({
    approved: true,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
  })),
}));

vi.mock('child_process', () => ({
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
  listGitHubIssues,
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
import { resolveProviderFallbackForAction } from './provider-router.js';
import { createApproval, reviewApproval } from './approvals.js';

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
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
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
      { stdio: ['ignore', 'pipe', 'pipe'] },
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

    approveCodingJob(job.id, 'owner');
    expect(() => approveCodingJob(job.id, 'owner')).toThrow(
      'Cannot approve implementation from implement',
    );

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
});
