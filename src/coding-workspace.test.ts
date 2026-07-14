import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  CODING_WORKSPACE_DIR: '/safe/coding-workspaces',
}));

import {
  prepareCodingWorkspace,
  runApprovedHostGit,
  validateCodingBranch,
  validateCodingRepoSlug,
  type CodingWorkspaceInput,
  type GitTransport,
} from './coding-workspace.js';

const jobsRoot = '/safe/coding-workspaces/jobs';
const jobRoot = `${jobsRoot}/job-129`;
const workspace = `${jobRoot}/owner__repo`;
const metadataDir = `${jobRoot}/.nanocrab`;
const token = 'test-secret-token';

const firstRunInput: CodingWorkspaceInput = {
  jobId: 'job-129',
  repo: 'owner/repo',
  defaultBranch: 'main',
  branch: 'nanocrab/issue-129',
  workspace,
  isFirstRun: true,
};

function stats(kind: 'directory' | 'symlink' = 'directory'): fs.Stats {
  return {
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink',
  } as fs.Stats;
}

function missingError(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

function gitResult(stdout = '', stderr = '', exitCode = 0) {
  return { stdout, stderr, exitCode };
}

function baseDeps(
  options: {
    workspaceExists?: boolean;
    canonicalWorkspace?: string;
    git?: GitTransport;
  } = {},
) {
  const workspaceExists = options.workspaceExists ?? false;
  const git = options.git ?? vi.fn<GitTransport>(async () => gitResult());
  const lstat = vi.fn(async (value: string) => {
    if (value === workspace && !workspaceExists) throw missingError();
    if (value === `${workspace}/.git` && !workspaceExists) throw missingError();
    return stats();
  });
  const mkdir = vi.fn(
    async () => undefined,
  ) as unknown as typeof fs.promises.mkdir;
  const realpath = vi.fn(async (value: string) => {
    if (value === workspace) return options.canonicalWorkspace ?? workspace;
    return path.resolve(value);
  });
  const dispose = vi.fn(async () => undefined);
  const createAskpass = vi.fn(async () => ({
    path: '/private/tmp/nanocrab-askpass/helper.sh',
    dispose,
  }));

  return {
    git,
    lstat,
    mkdir,
    realpath,
    githubToken: token,
    createAskpass,
    dispose,
  };
}

function localCheckoutGit() {
  return vi.fn<GitTransport>(async (args) => {
    switch (args[0]) {
      case 'rev-parse':
        return gitResult('true\n');
      case 'remote':
        return gitResult('https://github.com/owner/repo.git\n');
      case 'branch':
        return gitResult('nanocrab/issue-129\n');
      case 'status':
        return gitResult('M  staged.ts\n M dirty.ts\n?? new.ts\n');
      case 'log':
        return gitResult('abc123 subject\n');
      default:
        throw new Error(`unexpected fake Git call: ${args.join(' ')}`);
    }
  });
}

describe('coding workspace', () => {
  it('prepares a missing first-run checkout with argument-array Git calls', async () => {
    const deps = baseDeps();

    const prepared = await prepareCodingWorkspace(firstRunInput, deps);

    expect(
      (deps.git as ReturnType<typeof vi.fn>).mock.calls.map(([args]) => args),
    ).toEqual([
      [
        'clone',
        '--depth',
        '50',
        'https://github.com/owner/repo.git',
        workspace,
      ],
      ['fetch', 'origin', 'main', '--depth', '50'],
      ['checkout', '-B', 'main', 'origin/main'],
      ['checkout', '-B', 'nanocrab/issue-129'],
    ]);
    expect(prepared).toEqual({
      jobRoot,
      metadataDir,
      workspace,
      resumed: false,
      gitState: { staged: '', unstaged: '', untracked: '', unpushed: '' },
    });
  });

  it('resumes a dirty retry without fetch reset checkout clean or delete', async () => {
    const git = localCheckoutGit();
    const deps = baseDeps({ workspaceExists: true, git });

    const prepared = await prepareCodingWorkspace(
      { ...firstRunInput, isFirstRun: false },
      deps,
    );

    expect(prepared.gitState).toEqual({
      staged: 'M  staged.ts',
      unstaged: ' M dirty.ts',
      untracked: 'new.ts',
      unpushed: 'abc123 subject',
    });
    const flattenedGitArgs = git.mock.calls
      .map(([args]) => args.join(' '))
      .join('\n');
    expect(flattenedGitArgs).not.toMatch(/fetch|reset|checkout|clean/);
    expect(prepared.resumed).toBe(true);
  });

  it('validates and resumes an unexpected existing first-run checkout without rewriting it', async () => {
    const git = localCheckoutGit();
    const deps = baseDeps({ workspaceExists: true, git });

    const prepared = await prepareCodingWorkspace(firstRunInput, deps);

    expect(prepared.resumed).toBe(true);
    expect(git.mock.calls.map(([args]) => args[0])).toEqual([
      'rev-parse',
      'remote',
      'branch',
      'status',
      'log',
    ]);
  });

  it('uses only credential-free trusted environment for local inspections', async () => {
    const git = localCheckoutGit();
    const deps = baseDeps({ workspaceExists: true, git });

    await prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps);

    for (const [, options] of git.mock.calls) {
      expect(options.env).toEqual({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      });
      expect(options.env).not.toHaveProperty('GIT_ASKPASS');
      expect(options.env).not.toHaveProperty('NANOCRAB_GIT_TOKEN');
    }
    expect(deps.createAskpass).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', 'repository slug'],
    ['owner/repo/extra', 'repository slug'],
    ['../repo', 'repository slug'],
    ['owner/@repo', 'repository slug'],
  ])('rejects unsafe repository %s before filesystem or Git', async (repo) => {
    const deps = baseDeps();

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, repo }, deps),
    ).rejects.toThrow(/repository slug/i);
    expect(deps.mkdir).not.toHaveBeenCalled();
    expect(deps.lstat).not.toHaveBeenCalled();
    expect(deps.git).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '-topic',
    '/topic',
    'topic/',
    'topic.',
    'topic..name',
    'topic@{upstream}',
    'topic//child',
    'topic/a.lock',
    'topic/../child',
    'topic name',
    'topic~1',
  ])('rejects unsafe branch %j before filesystem or Git', async (branch) => {
    const deps = baseDeps();

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, branch }, deps),
    ).rejects.toThrow(/branch/i);
    expect(deps.mkdir).not.toHaveBeenCalled();
    expect(deps.git).not.toHaveBeenCalled();
  });

  it.each([
    ['../job-129', workspace],
    ['job-129/child', workspace],
    ['job-129', `${jobsRoot}/other/repo`],
    ['job-129', 'relative/repo'],
  ])(
    'rejects unsafe job/workspace paths before Git',
    async (jobId, candidate) => {
      const deps = baseDeps();

      await expect(
        prepareCodingWorkspace(
          { ...firstRunInput, jobId, workspace: candidate },
          deps,
        ),
      ).rejects.toThrow(/workspace|job/i);
      expect(deps.git).not.toHaveBeenCalled();
    },
  );

  it('rejects a canonical workspace symlink escape before Git', async () => {
    const deps = baseDeps({
      workspaceExists: true,
      canonicalWorkspace: '/outside/owner__repo',
    });

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps),
    ).rejects.toThrow(/workspace/i);
    expect(deps.git).not.toHaveBeenCalled();
  });

  it('rejects a missing checkout beneath a symlinked intermediate parent before remote Git', async () => {
    const linkedWorkspace = `${jobRoot}/linked/owner__repo`;
    const deps = baseDeps();
    deps.lstat.mockImplementation(async (value: string) => {
      if (value === linkedWorkspace) throw missingError();
      if (value === `${jobRoot}/linked`) return stats('symlink');
      return stats();
    });

    await expect(
      prepareCodingWorkspace(
        { ...firstRunInput, workspace: linkedWorkspace },
        deps,
      ),
    ).rejects.toThrow(/symlink|workspace parent/i);
    expect(deps.git).not.toHaveBeenCalled();
    expect(deps.createAskpass).not.toHaveBeenCalled();
  });

  it('rejects a job root symlink into another canonical job before remote Git', async () => {
    const otherJobRoot = `${jobsRoot}/other-job`;
    const deps = baseDeps();
    deps.lstat.mockImplementation(async (value: string) => {
      if (value === workspace) throw missingError();
      if (value === jobRoot) return stats('symlink');
      return stats();
    });
    deps.realpath.mockImplementation(async (value: string) => {
      if (value === jobRoot) return otherJobRoot;
      if (value === metadataDir) return `${otherJobRoot}/.nanocrab`;
      if (value === workspace) return `${otherJobRoot}/owner__repo`;
      return path.resolve(value);
    });

    await expect(prepareCodingWorkspace(firstRunInput, deps)).rejects.toThrow(
      /job root|symlink/i,
    );
    expect(deps.git).not.toHaveBeenCalled();
    expect(deps.createAskpass).not.toHaveBeenCalled();
  });

  it('rejects corrupt Git metadata before local inspection', async () => {
    const deps = baseDeps({ workspaceExists: true });
    deps.lstat.mockImplementation(async (value: string) =>
      value === `${workspace}/.git` ? stats('symlink') : stats(),
    );

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps),
    ).rejects.toThrow(/git metadata/i);
    expect(deps.git).not.toHaveBeenCalled();
  });

  it.each([
    ['remote', 'https://github.com/other/repo.git\n', /origin/i],
    ['remote', 'https://example.com/owner/repo.git\n', /origin/i],
    ['branch', 'wrong-branch\n', /branch/i],
    ['rev-parse', 'false\n', /work tree/i],
  ])(
    'rejects invalid existing checkout %s state',
    async (command, stdout, error) => {
      const git = localCheckoutGit();
      git.mockImplementation(async (args) =>
        args[0] === command
          ? gitResult(stdout)
          : localCheckoutGit()(args, {} as never),
      );
      const deps = baseDeps({ workspaceExists: true, git });

      await expect(
        prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps),
      ).rejects.toThrow(error);
    },
  );

  it('accepts the exact SSH origin without exposing credentials', async () => {
    const git = localCheckoutGit();
    git.mockImplementation(async (args) => {
      if (args[0] === 'remote')
        return gitResult('git@github.com:owner/repo.git\n');
      return localCheckoutGit()(args, {} as never);
    });
    const deps = baseDeps({ workspaceExists: true, git });

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps),
    ).resolves.toMatchObject({ resumed: true });
  });

  it('scopes askpass credentials to one approved remote call and disposes in finally', async () => {
    const git = vi.fn<GitTransport>(async () => gitResult('ok', '', 0));
    const dispose = vi.fn(async () => undefined);
    const createAskpass = vi.fn(async () => ({
      path: '/private/tmp/askpass/helper.sh',
      dispose,
    }));

    const result = await runApprovedHostGit(
      ['push', 'origin', 'nanocrab/issue-129'],
      { cwd: workspace, token, git, createAskpass },
    );

    expect(git).toHaveBeenCalledWith(
      ['push', 'origin', 'nanocrab/issue-129'],
      expect.objectContaining({
        cwd: workspace,
        timeoutMs: 120_000,
        env: expect.objectContaining({
          PATH: '/usr/local/bin:/usr/bin:/bin',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          GIT_ASKPASS: '/private/tmp/askpass/helper.sh',
          GIT_TERMINAL_PROMPT: '0',
          NANOCRAB_GIT_TOKEN: token,
        }),
      }),
    );
    expect(result).toEqual(gitResult('ok', '', 0));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('neutralizes repository-controlled execution surfaces for credentialed Git', async () => {
    const git = vi.fn<GitTransport>(async () => gitResult());
    const createAskpass = vi.fn(async () => ({
      path: '/private/tmp/askpass/helper.sh',
      dispose: vi.fn(async () => undefined),
    }));

    await runApprovedHostGit(['push', 'origin', 'nanocrab/issue-129'], {
      cwd: workspace,
      token,
      git,
      createAskpass,
    });

    const env = git.mock.calls[0][1].env;
    expect(env).toMatchObject({
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_SSH_COMMAND: 'false',
    });
    const config = Array.from(
      { length: Number(env.GIT_CONFIG_COUNT) },
      (_, index) => [
        env[`GIT_CONFIG_KEY_${index}`],
        env[`GIT_CONFIG_VALUE_${index}`],
      ],
    );
    expect(config).toEqual(
      expect.arrayContaining([
        ['credential.helper', ''],
        ['credential.interactive', 'never'],
        ['core.hooksPath', '/dev/null'],
        ['core.fsmonitor', 'false'],
        ['core.sshCommand', 'false'],
        ['protocol.allow', 'never'],
        ['protocol.https.allow', 'always'],
        ['http.proxy', ''],
        ['http.curloptResolve', ''],
      ]),
    );
  });

  it.each([
    [['status']],
    [['-c', 'credential.helper=/tmp/steal', 'fetch', 'origin', 'main']],
    [['fetch', '--upload-pack=/tmp/steal', 'origin', 'main']],
    [['push', '--receive-pack=/tmp/steal', 'origin', 'main']],
    [['clone', 'ext::/tmp/steal', workspace]],
  ])('rejects unapproved credentialed Git argv %j', async (args) => {
    const git = vi.fn<GitTransport>();
    const createAskpass = vi.fn();

    await expect(
      runApprovedHostGit(args, { cwd: workspace, token, git, createAskpass }),
    ).rejects.toThrow(/approved|operation/i);
    expect(createAskpass).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });

  it.each([
    [
      'push',
      'origin',
      'nanocrab/issue-129:refs/heads/nanocrab/issue-129',
      '--force-with-lease',
    ],
    ['push', 'origin', ':nanocrab/issue-129'],
  ])('allows the exact approved NanoCrab push argv %j', async (...args) => {
    const git = vi.fn<GitTransport>(async () => gitResult());
    const dispose = vi.fn(async () => undefined);

    await expect(
      runApprovedHostGit(args, {
        cwd: workspace,
        token,
        git,
        createAskpass: async () => ({ path: '/askpass', dispose }),
      }),
    ).resolves.toEqual(gitResult());
    expect(git).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('creates a production 0700 token-free askpass helper and disposes it after success', async () => {
    const helperPaths: string[] = [];
    const observations: Array<{
      mode: number;
      containsToken: boolean;
      username: string;
      passwordDigest: string;
      untrustedExitCode: number | null;
      untrustedOutputLength: number;
      spoofedHostExitCode: number | null;
      spoofedHostOutputLength: number;
    }> = [];
    const git = vi.fn<GitTransport>(async (_args, options) => {
      const helperPath = options.env.GIT_ASKPASS;
      if (!helperPath) return gitResult();
      helperPaths.push(helperPath);
      const [body, helperStats] = await Promise.all([
        fs.promises.readFile(helperPath, 'utf8'),
        fs.promises.stat(helperPath),
      ]);
      const username = spawnSync(
        helperPath,
        ["Username for 'https://github.com':"],
        { env: options.env, encoding: 'utf8' },
      );
      const password = spawnSync(
        helperPath,
        ["Password for 'https://x-access-token@github.com':"],
        { env: options.env, encoding: 'utf8' },
      );
      const untrusted = spawnSync(
        helperPath,
        ["Password for 'https://attacker.invalid':"],
        { env: options.env, encoding: 'utf8' },
      );
      const spoofedHost = spawnSync(
        helperPath,
        ["Password for 'https://github.com.attacker.invalid':"],
        { env: options.env, encoding: 'utf8' },
      );
      observations.push({
        mode: helperStats.mode & 0o777,
        containsToken: body.includes(token),
        username: username.stdout.trim(),
        passwordDigest: createHash('sha256')
          .update(password.stdout.trim())
          .digest('hex'),
        untrustedExitCode: untrusted.status,
        untrustedOutputLength: untrusted.stdout.length,
        spoofedHostExitCode: spoofedHost.status,
        spoofedHostOutputLength: spoofedHost.stdout.length,
      });
      return gitResult();
    });
    const deps = baseDeps({ git });
    deps.createAskpass = undefined as never;

    await prepareCodingWorkspace(firstRunInput, deps);

    expect(observations).toHaveLength(2);
    expect(observations).toEqual(
      Array.from({ length: 2 }, () => ({
        mode: 0o700,
        containsToken: false,
        username: 'x-access-token',
        passwordDigest: createHash('sha256').update(token).digest('hex'),
        untrustedExitCode: 1,
        untrustedOutputLength: 0,
        spoofedHostExitCode: 1,
        spoofedHostOutputLength: 0,
      })),
    );
    for (const helperPath of helperPaths) {
      await expect(fs.promises.access(helperPath)).rejects.toThrow();
    }
  });

  it('disposes the production askpass helper when credentialed Git fails', async () => {
    let helperPath: string | undefined;
    const git = vi.fn<GitTransport>(async (_args, options) => {
      helperPath = options.env.GIT_ASKPASS;
      throw new Error('fake transport failure');
    });
    const deps = baseDeps({ git });
    deps.createAskpass = undefined as never;

    await expect(prepareCodingWorkspace(firstRunInput, deps)).rejects.toThrow(
      /approved Git operation failed/i,
    );

    expect(helperPath).toBeTruthy();
    await expect(fs.promises.access(helperPath!)).rejects.toThrow();
  });

  it('removes the token from remote results and thrown errors', async () => {
    const dispose = vi.fn(async () => undefined);
    const createAskpass = vi.fn(async () => ({ path: '/askpass', dispose }));
    const leakingResultGit = vi.fn<GitTransport>(async () =>
      gitResult(
        `url=https://x-access-token:${token}@github.com/owner/repo.git`,
        token,
        1,
      ),
    );

    const result = await runApprovedHostGit(
      ['fetch', 'origin', 'main', '--depth', '50'],
      {
        token,
        git: leakingResultGit,
        createAskpass,
      },
    );

    expect(JSON.stringify(result)).not.toContain(token);
    expect(dispose).toHaveBeenCalledOnce();

    const throwingGit = vi.fn<GitTransport>(async () => {
      throw new Error(`transport leaked ${token}`);
    });
    await expect(
      runApprovedHostGit(['push', 'origin', 'main'], {
        token,
        git: throwingGit,
        createAskpass,
      }),
    ).rejects.not.toThrow(token);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('rejects token-bearing arguments before creating askpass', async () => {
    const git = vi.fn<GitTransport>();
    const createAskpass = vi.fn();

    await expect(
      runApprovedHostGit(
        ['clone', `https://${token}@github.com/owner/repo.git`],
        {
          token,
          git,
          createAskpass,
        },
      ),
    ).rejects.toThrow(/credential/i);
    expect(createAskpass).not.toHaveBeenCalled();
    expect(git).not.toHaveBeenCalled();
  });

  it('exports validators for canonical repository and branch identities', () => {
    expect(() => validateCodingRepoSlug('owner/repo')).not.toThrow();
    expect(() => validateCodingRepoSlug('./repo')).toThrow(/repository slug/i);
    expect(() => validateCodingBranch('feature/safe-name')).not.toThrow();
    expect(() => validateCodingBranch('feature/./name')).toThrow(/branch/i);
  });
});
