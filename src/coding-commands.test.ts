import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-coding-commands-test/store',
  CODING_WORKSPACE_DIR:
    '/tmp/nanocrab-coding-commands-test/data/coding-workspaces',
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanocrab-coding-commands-test/data',
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
  },
  DEVIN_CREDENTIAL_PATH: null,
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
  hostGatewayArgs: vi.fn(() => []),
}));

vi.mock('./credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => {
    throw new Error('spawn should not run in command tests');
  }),
}));

import { parseCodingCommand, runCodingCommand } from './coding-commands.js';
import { registerCodingRepo } from './coding-jobs.js';
import { listApprovals } from './approvals.js';

const TEST_ROOT = '/tmp/nanocrab-coding-commands-test';

function mockGitHubFetch(
  handler: (url: string, opts?: RequestInit) => unknown,
) {
  const fetchMock = vi.fn(async (url: string | URL, opts?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => handler(String(url), opts),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('coding chat commands', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('parses mobile coding command arguments', () => {
    expect(
      parseCodingCommand(
        '/coding-pick owner/repo labels=autofix,p0 tool=codex provider=codex model=gpt-5.4 no-pr',
      ),
    ).toMatchObject({
      action: 'pick',
      repo: 'owner/repo',
      labels: ['autofix', 'p0'],
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
      createPr: false,
    });
    expect(parseCodingCommand('/coding-approve code-123')).toMatchObject({
      action: 'approve',
      jobId: 'code-123',
    });
  });

  it('accepts cli as an alias for tool in coding commands', () => {
    expect(
      parseCodingCommand(
        '/coding-pick owner/repo cli=opencode provider=openrouter model=qwen/qwen3-coder',
      ),
    ).toMatchObject({
      action: 'pick',
      cli: 'opencode',
      provider: 'openrouter',
      model: 'qwen/qwen3-coder',
    });
  });

  it('parses cross-channel PR review and close commands', () => {
    expect(
      parseCodingCommand(
        '/coding-review-pr owner/repo#42 tool=codex provider=codex model=gpt-5.4',
      ),
    ).toMatchObject({
      action: 'review-pr',
      repo: 'owner/repo',
      pullRequestNumber: 42,
      cli: 'codex',
      provider: 'codex',
      model: 'gpt-5.4',
    });
    expect(parseCodingCommand('/coding-close-pr owner/repo 42')).toMatchObject({
      action: 'close-pr',
      repo: 'owner/repo',
      pullRequestNumber: 42,
    });
    expect(
      parseCodingCommand('/coding-approve-close-pr owner/repo#42'),
    ).toMatchObject({
      action: 'approve-close-pr',
      repo: 'owner/repo',
      pullRequestNumber: 42,
    });
  });

  it('creates a separate approval before a PR can be closed', async () => {
    mockGitHubFetch((url) => {
      if (url.endsWith('/pulls/42')) {
        return {
          title: 'Fix scheduler',
          html_url: 'https://github.com/owner/repo/pull/42',
          state: 'open',
        };
      }
      return { default_branch: 'main' };
    });

    const response = await runCodingCommand(
      parseCodingCommand('/coding-close-pr owner/repo#42')!,
      'tester',
    );

    expect(response).toContain('Close approval required for owner/repo#42');
    expect(listApprovals({ kind: 'coding-close-pr' })).toHaveLength(1);
  });

  it('picks an issue and returns approval instructions', async () => {
    mockGitHubFetch((url) => {
      if (url.includes('/issues?')) {
        return [
          {
            number: 7,
            title: 'Fix scheduler',
            body: '- [ ] Add regression test',
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
          body: '- [ ] Add regression test',
        };
      }
      return { default_branch: 'main' };
    });
    await registerCodingRepo({ repo: 'owner/repo', labels: ['autofix'] });

    const response = await runCodingCommand(
      parseCodingCommand('/coding-pick owner/repo labels=autofix')!,
      'tester',
    );

    expect(response).toContain('Picked owner/repo#7');
    expect(response).toContain('Approve with /coding-approve code-');
  });
});
