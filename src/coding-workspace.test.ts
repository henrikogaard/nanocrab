import path from 'node:path';
import type fs from 'node:fs';

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

    expect(git).toHaveBeenCalledWith(['push', 'origin', 'nanocrab/issue-129'], {
      cwd: workspace,
      timeoutMs: 120_000,
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        GIT_ASKPASS: '/private/tmp/askpass/helper.sh',
        GIT_TERMINAL_PROMPT: '0',
        NANOCRAB_GIT_TOKEN: token,
      },
    });
    expect(result).toEqual(gitResult('ok', '', 0));
    expect(dispose).toHaveBeenCalledOnce();
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

    const result = await runApprovedHostGit(['fetch', 'origin'], {
      token,
      git: leakingResultGit,
      createAskpass,
    });

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
