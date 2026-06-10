import fs from 'fs';
import { spawn } from 'child_process';
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
  spawn: vi.fn(() => {
    throw new Error('spawn should not run while coding jobs are queued');
  }),
}));

import {
  listGitHubIssues,
  loadCodingJobs,
  loadCodingRepos,
  getCodingJob,
  registerCodingRepo,
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
  });
});
