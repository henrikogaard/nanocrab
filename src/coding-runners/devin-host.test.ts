import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  buildDevinAgentConfig,
  buildDevinChildEnvironment,
  buildSandboxedDevinLaunch,
  createDevinHostRunner,
  ensureDevinAgentConfig,
  ensureDevinCommandBrokerLauncher,
  writeDevinCommandBrokerLauncher,
} from './devin-host.js';
import { createProcessRegistry } from './process-registry.js';
import type { CodingRunnerInput, SpawnedCodingProcess } from './types.js';

const input = {
  stageKind: 'planning' as const,
  workspace: '/jobs/job/repo',
  jobRoot: '/jobs/job',
  brokerPath: '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
  devinCredentialPath: '/home/service/.config/devin/credentials.json',
  home: '/home/service',
  nanocrabConfigRoot: '/home/service/.config/nanocrab',
};

const trustedSandboxFilesystem = {
  lstat: async (value: string) =>
    ({
      dev: 1,
      ino: value.length,
      isDirectory: () =>
        value.endsWith('/.git') ||
        value === '/tmp' ||
        [
          '/opt/devin',
          '/opt/devin-v2',
          '/usr',
          '/usr/local',
          '/usr/bin',
        ].includes(value),
      isFile: () =>
        value.endsWith('.txt') ||
        value.endsWith('.json') ||
        value.endsWith('.js') ||
        value.endsWith('nanocrab-job-exec'),
      isSymbolicLink: () => false,
    }) as fs.Stats,
  realpath: async (value: string) => value,
  readdir: async () => [] as fs.Dirent[],
};

const readOnlyConfig = {
  system_instructions: expect.stringContaining(
    'Do not modify repository files',
  ),
  allowed_tools: ['read', 'grep', 'glob', 'exec'],
  permissions: {
    allow: [
      'Read(/jobs/job/repo/**)',
      'Exec(/jobs/job/.nanocrab/bin/nanocrab-job-exec)',
    ],
    ask: [],
    deny: [
      'Read(/jobs/job/.nanocrab/**)',
      'Read(/home/service/.config/devin/credentials.json)',
      'Read(/home/service/.ssh/**)',
      'Read(/home/service/.gnupg/**)',
      'Read(/home/service/.config/nanocrab/**)',
      'Write(/jobs/job/.nanocrab/**)',
      'Write(/jobs/job/repo/.git)',
      'Write(/jobs/job/repo/.git/**)',
      'Write(/home/service/.config/devin/credentials.json)',
      'Write(/home/service/.ssh/**)',
      'Write(/home/service/.gnupg/**)',
      'Write(/home/service/.config/nanocrab/**)',
    ],
  },
};

describe('Devin stage config', () => {
  it.each(['planning', 'review'] as const)(
    'builds the exact read-only config for %s',
    (stageKind) => {
      expect(buildDevinAgentConfig({ ...input, stageKind })).toEqual(
        readOnlyConfig,
      );
    },
  );

  it.each(['implement', 'direct'] as const)(
    'adds only workspace writes and editing tools for %s',
    (stageKind) => {
      expect(buildDevinAgentConfig({ ...input, stageKind })).toEqual({
        ...readOnlyConfig,
        system_instructions: expect.not.stringContaining(
          'Do not modify repository files',
        ),
        allowed_tools: ['read', 'grep', 'glob', 'edit', 'write', 'exec'],
        permissions: {
          ...readOnlyConfig.permissions,
          allow: [
            'Read(/jobs/job/repo/**)',
            'Exec(/jobs/job/.nanocrab/bin/nanocrab-job-exec)',
            'Write(/jobs/job/repo/**)',
          ],
        },
      });
    },
  );

  it('survives JSON round-trip escaping without adding host control surfaces', () => {
    const config = buildDevinAgentConfig({
      ...input,
      workspace: '/jobs/quo"te/repo\\part',
    });
    const roundTrip = JSON.parse(JSON.stringify(config)) as Record<
      string,
      unknown
    >;

    expect(roundTrip).toEqual(config);
    expect(JSON.stringify(roundTrip)).not.toMatch(
      /mcp|browser|connector|computer.?use|host.?control/i,
    );
    expect(Object.keys(roundTrip)).toEqual([
      'system_instructions',
      'allowed_tools',
      'permissions',
    ]);
  });
});

describe('Devin child environment', () => {
  it('keeps only startup-safe values and replaces an untrusted PATH', () => {
    expect(
      buildDevinChildEnvironment({
        HOME: '/home/service',
        PATH: '.:/jobs/job/repo:/tmp/bin',
        TMPDIR: '/private/tmp',
        TMP: '/tmp',
        TEMP: '/tmp',
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        LC_CTYPE: 'UTF-8',
        XDG_CONFIG_HOME: '/home/service/.config',
        XDG_DATA_HOME: '/home/service/.local/share',
        TERM: 'xterm-256color',
        NO_COLOR: '0',
        GITHUB_TOKEN: 'secret',
        ANTHROPIC_API_KEY: 'secret',
        DEVIN_API_KEY: 'secret',
        COOKIE: 'secret',
        HTTP_PROXY: 'http://secret',
        WHATSAPP_TOKEN: 'secret',
        TELEGRAM_BOT_TOKEN: 'secret',
      }),
    ).toEqual({
      HOME: '/home/service',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
      TMPDIR: '/private/tmp',
      TMP: '/tmp',
      TEMP: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'UTF-8',
      XDG_CONFIG_HOME: '/home/service/.config',
      XDG_DATA_HOME: '/home/service/.local/share',
      TERM: 'dumb',
      NO_COLOR: '1',
    });
  });
});

describe('Devin process sandbox', () => {
  const devinArgs = ['--prompt-file', '/jobs/job/.nanocrab/prompt.txt'];
  const launchInput = {
    sandboxExecutable: '/usr/bin/bwrap' as const,
    stageKind: 'planning' as const,
    workspace: '/jobs/job/repo',
    executable: '/opt/devin/bin/devin',
    args: devinArgs,
    trustedRuntimeReadRoots: ['/opt/devin', '/usr/local', '/usr/bin'],
    temporaryDirectory: '/tmp',
    readOnlyPaths: [
      '/jobs/job/.nanocrab/prompt.txt',
      '/jobs/job/.nanocrab/devin-agent.json',
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
      '/opt/nanocrab/dist/coding-runners/command-broker.js',
    ],
  };

  it('starts Linux Devin from an explicit minimal mount set', async () => {
    const launch = await buildSandboxedDevinLaunch(
      launchInput,
      trustedSandboxFilesystem,
    );
    expect(launch).toEqual({
      executable: '/usr/bin/bwrap',
      args: [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--tmpfs',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        '--dir',
        '/opt',
        '--dir',
        '/usr',
        '--dir',
        '/jobs',
        '--dir',
        '/tmp',
        '--dir',
        '/opt/devin',
        '--dir',
        '/usr/local',
        '--dir',
        '/usr/bin',
        '--dir',
        '/jobs/job',
        '--dir',
        '/opt/nanocrab',
        '--dir',
        '/jobs/job/repo',
        '--dir',
        '/jobs/job/.nanocrab',
        '--dir',
        '/opt/nanocrab/dist',
        '--dir',
        '/jobs/job/repo/.git',
        '--dir',
        '/jobs/job/.nanocrab/bin',
        '--dir',
        '/opt/nanocrab/dist/coding-runners',
        '--ro-bind',
        '/opt/devin',
        '/opt/devin',
        '--ro-bind',
        '/usr/local',
        '/usr/local',
        '--ro-bind',
        '/usr/bin',
        '/usr/bin',
        '--ro-bind',
        '/jobs/job/repo',
        '/jobs/job/repo',
        '--ro-bind',
        '/jobs/job/repo/.git',
        '/jobs/job/repo/.git',
        '--bind',
        '/tmp',
        '/tmp',
        '--ro-bind',
        '/jobs/job/.nanocrab/prompt.txt',
        '/jobs/job/.nanocrab/prompt.txt',
        '--ro-bind',
        '/jobs/job/.nanocrab/devin-agent.json',
        '/jobs/job/.nanocrab/devin-agent.json',
        '--ro-bind',
        '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
        '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
        '--ro-bind',
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
        '--chdir',
        '/jobs/job/repo',
        '--',
        '/opt/devin/bin/devin',
        ...devinArgs,
      ],
    });
    expect(
      launch.args.some(
        (value, index) =>
          value === '--bind' &&
          launch.args[index + 1] === '/' &&
          launch.args[index + 2] === '/',
      ),
    ).toBe(false);
    expect(launch.args).not.toContain('/home/service');
    expect(launch.args).not.toContain(
      '/home/service/.config/devin/credentials.json',
    );
  });

  it.each([
    ['missing runtime roots', { trustedRuntimeReadRoots: [] }],
    ['missing temp root', { temporaryDirectory: undefined }],
    ['missing launch files', { readOnlyPaths: [] }],
  ])('fails closed with %s', async (_label, change) => {
    await expect(
      buildSandboxedDevinLaunch(
        { ...launchInput, ...change } as typeof launchInput,
        trustedSandboxFilesystem,
      ),
    ).rejects.toThrow(/required|root/i);
  });

  it('rejects overlapping runtime roots before constructing mounts', async () => {
    await expect(
      buildSandboxedDevinLaunch(
        {
          ...launchInput,
          trustedRuntimeReadRoots: ['/usr', '/usr/bin'],
        },
        trustedSandboxFilesystem,
      ),
    ).rejects.toThrow(/overlap/i);
  });

  it('accepts broker files already covered by a trusted runtime root', async () => {
    const launch = await buildSandboxedDevinLaunch(
      {
        ...launchInput,
        readOnlyPaths: ['/usr/bin/command-broker.js'],
      },
      trustedSandboxFilesystem,
    );
    expect(launch.args).not.toContain('/usr/bin/command-broker.js');
    expect(launch.args).toEqual(
      expect.arrayContaining(['--ro-bind', '/usr/bin', '/usr/bin']),
    );
  });

  it('fails closed for macOS while authentication handoff is disabled', async () => {
    await expect(
      buildSandboxedDevinLaunch(
        {
          ...launchInput,
          sandboxExecutable: '/usr/bin/sandbox-exec',
        },
        trustedSandboxFilesystem,
      ),
    ).rejects.toThrow('authentication handoff is disabled');
  });

  it('rejects a pre-existing workspace alias to Git metadata before macOS launch', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nanocrab-devin-alias-'),
    );
    const requestedWorkspace = path.join(root, 'repo');
    fs.mkdirSync(path.join(requestedWorkspace, '.git'), { recursive: true });
    const workspace = fs.realpathSync(requestedWorkspace);
    fs.symlinkSync('.git', path.join(workspace, 'metadata-alias'));
    try {
      await expect(
        buildSandboxedDevinLaunch({
          sandboxExecutable: '/usr/bin/sandbox-exec',
          workspace,
          executable: '/bin/sh',
          args: ['-c', 'echo exploit > metadata-alias/config'],
        }),
      ).rejects.toThrow('Workspace symlinks');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['/usr/bin/bwrap', '/usr/bin/sandbox-exec'] as const)(
    'rejects a pre-existing hardlink alias to Git metadata before %s launch',
    async (sandboxExecutable) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'nanocrab-devin-hardlink-'),
      );
      const requestedWorkspace = path.join(root, 'repo');
      fs.mkdirSync(path.join(requestedWorkspace, '.git'), { recursive: true });
      const workspace = fs.realpathSync(requestedWorkspace);
      fs.writeFileSync(path.join(workspace, '.git', 'config'), '[core]\n');
      fs.linkSync(
        path.join(workspace, '.git', 'config'),
        path.join(workspace, 'metadata-alias'),
      );
      try {
        await expect(
          buildSandboxedDevinLaunch({
            sandboxExecutable,
            workspace,
            executable: '/bin/sh',
            args: ['-c', 'echo exploit > metadata-alias'],
          }),
        ).rejects.toThrow('Git metadata hardlink');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('does not expose a permissive macOS profile while authentication handoff is disabled', async () => {
    await expect(
      buildSandboxedDevinLaunch(
        { ...launchInput, sandboxExecutable: '/usr/bin/sandbox-exec' },
        trustedSandboxFilesystem,
      ),
    ).rejects.toThrow('authentication handoff is disabled');
  });
});

describe('Devin command broker launcher', () => {
  it('writes a secret-free immutable Node launcher outside the workspace', async () => {
    const dependencies = immutableLauncherDependencies({ parentMode: 0o700 });
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    await expect(
      writeDevinCommandBrokerLauncher(
        {
          stageKind: 'implement',
          workspace: '/jobs/job/repo "quoted"',
          jobRoot: '/jobs/job',
          commandBrokerModulePath:
            '/opt/nanocrab/dist/coding-runners/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/usr/bin/node',
          home: '/home/service',
          protectedPaths: [
            '/jobs/job/.nanocrab',
            '/home/service/.config/devin/credentials.json',
            '/home/service/.config/nanocrab',
          ],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).resolves.toBe('/jobs/job/.nanocrab/bin/nanocrab-job-exec');

    const source = dependencies.handle.content();
    expect(source).toContain('runCommandBrokerCli');
    expect(source).toMatch(/^#!\/usr\/bin\/node\n/);
    expect(source).not.toContain('/usr/bin/env');
    expect(source).toContain('process.argv.slice(2)');
    expect(source).toContain('shell: false');
    expect(source).toContain(JSON.stringify('/jobs/job/repo "quoted"'));
    expect(source).toContain(JSON.stringify('/usr/bin/bwrap'));
    expect(source).toContain(JSON.stringify('/jobs/job/.nanocrab'));
    expect(source).toContain(
      JSON.stringify('/home/service/.config/devin/credentials.json'),
    );
    expect(source).toContain(JSON.stringify(['/usr']));
    expect(source).not.toMatch(/token|secret|shell:\s*true/i);
    expect(dependencies.handle.sync).toHaveBeenCalledOnce();
    expect(dependencies.handle.chmod).toHaveBeenCalledWith(0o555);
    expect(dependencies.handle.read).toHaveBeenCalled();
  });

  it('rejects a Node executable outside trusted runtime roots before writing', async () => {
    const dependencies = immutableLauncherDependencies({ parentMode: 0o700 });
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    await expect(
      writeDevinCommandBrokerLauncher(
        {
          stageKind: 'implement',
          workspace: '/jobs/job/repo',
          jobRoot: '/jobs/job',
          commandBrokerModulePath:
            '/opt/nanocrab/dist/coding-runners/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/tmp/untrusted-node',
          home: '/home/service',
          protectedPaths: ['/jobs/job/.nanocrab'],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).rejects.toThrow(/node|runtime|trusted/i);
    expect(dependencies.handle.writeFile).not.toHaveBeenCalled();
  });

  it('rejects a noncanonical Node executable before writing', async () => {
    const dependencies = immutableLauncherDependencies({ parentMode: 0o700 });
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    dependencies.realpath.mockImplementation(async (value: string) =>
      value === '/usr/local/bin/node' ? '/usr/bin/node' : value,
    );
    await expect(
      writeDevinCommandBrokerLauncher(
        {
          stageKind: 'review',
          workspace: '/jobs/job/repo',
          jobRoot: '/jobs/job',
          commandBrokerModulePath:
            '/opt/nanocrab/dist/coding-runners/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/usr/local/bin/node',
          home: '/home/service',
          protectedPaths: ['/jobs/job/.nanocrab'],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).rejects.toThrow(/node|canonical/i);
    expect(dependencies.handle.writeFile).not.toHaveBeenCalled();
  });

  it('reuses an unchanged immutable launcher without rewriting it', async () => {
    const writeFile = vi.fn(async () => undefined);
    const chmod = vi.fn(async () => undefined);
    const launcherInput = {
      stageKind: 'direct' as const,
      workspace: '/jobs/job/repo',
      jobRoot: '/jobs/job',
      commandBrokerModulePath:
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
      sandboxExecutable: '/usr/bin/bwrap' as const,
      nodeExecutable: '/usr/bin/node',
      home: '/home/service',
      protectedPaths: ['/jobs/job/.nanocrab'],
      trustedRuntimeReadRoots: ['/usr'],
    };
    const sourceDependencies = immutableLauncherDependencies({
      parentMode: 0o700,
    });
    sourceDependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await writeDevinCommandBrokerLauncher(launcherInput, sourceDependencies);
    const source = sourceDependencies.handle.content();
    const dependencies = immutableLauncherDependencies({
      source,
      writeFile,
      chmod,
    });
    await expect(
      ensureDevinCommandBrokerLauncher(launcherInput, dependencies),
    ).resolves.toBe('/jobs/job/.nanocrab/bin/nanocrab-job-exec');
    expect(dependencies.open).toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    expect(dependencies.realpath).not.toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
    );
    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(chmod).not.toHaveBeenCalled();
  });

  it('creates the exact immutable launcher when it does not exist', async () => {
    const dependencies = immutableLauncherDependencies({ parentMode: 0o700 });
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );

    await expect(
      ensureDevinCommandBrokerLauncher(
        {
          stageKind: 'review',
          workspace: '/jobs/job/repo',
          jobRoot: '/jobs/job',
          commandBrokerModulePath:
            '/opt/nanocrab/dist/coding-runners/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/usr/bin/node',
          home: '/home/service',
          protectedPaths: ['/jobs/job/.nanocrab'],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).resolves.toBe('/jobs/job/.nanocrab/bin/nanocrab-job-exec');
    expect(dependencies.open).toHaveBeenLastCalledWith(
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_RDWR |
        fs.constants.O_NOFOLLOW,
      0o555,
    );
    expect(dependencies.handle.writeFile).toHaveBeenCalledOnce();
    expect(dependencies.handle.sync).toHaveBeenCalledOnce();
    expect(dependencies.handle.chmod).toHaveBeenCalledWith(0o555);
    expect(dependencies.handle.stat).toHaveBeenCalled();
    expect(dependencies.handle.read).toHaveBeenCalled();
    expect(dependencies.handle.close).toHaveBeenCalledOnce();
  });

  it('rejects a newly created launcher until handle metadata is verified', async () => {
    const dependencies = immutableLauncherDependencies({
      parentMode: 0o700,
      launcherMode: 0o644,
    });
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await expect(
      ensureDevinCommandBrokerLauncher(
        {
          stageKind: 'direct',
          workspace: '/jobs/job/repo',
          jobRoot: '/jobs/job',
          commandBrokerModulePath: '/opt/nanocrab/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/usr/bin/node',
          home: '/home/service',
          protectedPaths: ['/jobs/job/.nanocrab'],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).rejects.toThrow(/launcher|metadata|immutable/i);
    expect(dependencies.handle.writeFile).toHaveBeenCalled();
    expect(dependencies.handle.sync).toHaveBeenCalled();
    expect(dependencies.handle.chmod).toHaveBeenCalledWith(0o555);
    expect(dependencies.handle.stat).toHaveBeenCalled();
    expect(dependencies.handle.read).not.toHaveBeenCalled();
    expect(dependencies.handle.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['symlink', { parentSymlink: true }],
    ['non-directory', { parentDirectory: false }],
    ['wrong owner', { parentUid: 999 }],
    ['wrong staging mode', { parentMode: 0o755 }],
    ['noncanonical path', { parentRealpath: '/attacker/bin' }],
  ])(
    'rejects a hostile existing creation parent: %s',
    async (_name, change) => {
      const dependencies = immutableLauncherDependencies(change);
      dependencies.lstat.mockRejectedValueOnce(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );
      await expect(
        ensureDevinCommandBrokerLauncher(
          {
            stageKind: 'direct',
            workspace: '/jobs/job/repo',
            jobRoot: '/jobs/job',
            commandBrokerModulePath: '/opt/nanocrab/command-broker.js',
            sandboxExecutable: '/usr/bin/bwrap',
            nodeExecutable: '/usr/bin/node',
            home: '/home/service',
            protectedPaths: ['/jobs/job/.nanocrab'],
            trustedRuntimeReadRoots: ['/usr'],
          },
          dependencies,
        ),
      ).rejects.toThrow(/parent|directory|immutable|unsafe|canonical/i);
      expect(dependencies.writeFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['tampered bytes', { source: 'tampered' }],
    ['launcher symlink', { launcherSymlink: true }],
    ['launcher FIFO', { launcherFile: false }],
    ['wrong launcher mode', { launcherMode: 0o755 }],
    ['wrong launcher owner', { launcherUid: 999 }],
    ['parent symlink', { parentSymlink: true }],
    ['wrong parent mode', { parentMode: 0o700 }],
  ])('rejects immutable launcher reuse with %s', async (_name, change) => {
    const dependencies = immutableLauncherDependencies(change);
    await expect(
      ensureDevinCommandBrokerLauncher(
        {
          stageKind: 'direct',
          workspace: '/jobs/job/repo',
          jobRoot: '/jobs/job',
          commandBrokerModulePath:
            '/opt/nanocrab/dist/coding-runners/command-broker.js',
          sandboxExecutable: '/usr/bin/bwrap',
          nodeExecutable: '/usr/bin/node',
          home: '/home/service',
          protectedPaths: ['/jobs/job/.nanocrab'],
          trustedRuntimeReadRoots: ['/usr'],
        },
        dependencies,
      ),
    ).rejects.toThrow(/launcher|immutable|owner|mode|symlink/i);
    if (!('parentSymlink' in change) && !('parentMode' in change)) {
      expect(dependencies.open).toHaveBeenCalled();
    }
    expect(dependencies.handle.read).not.toHaveBeenCalled();
  });
});

function immutableLauncherDependencies(
  changes: {
    source?: string;
    launcherSymlink?: boolean;
    launcherFile?: boolean;
    launcherMode?: number;
    launcherUid?: number;
    parentSymlink?: boolean;
    parentDirectory?: boolean;
    parentUid?: number;
    parentMode?: number;
    parentRealpath?: string;
    writeFile?: (
      path: string,
      data: string,
      options: { encoding: 'utf8'; mode: number; flag: 'wx' },
    ) => Promise<void>;
    chmod?: (path: string, mode: number) => Promise<void>;
  } = {},
) {
  const launcher = {
    dev: 1,
    ino: 2,
    uid: changes.launcherUid ?? 501,
    mode: changes.launcherMode ?? 0o555,
    isSymbolicLink: () => changes.launcherSymlink ?? false,
    isFile: () => changes.launcherFile ?? true,
    isDirectory: () => false,
  } as unknown as import('node:fs').Stats;
  let parentMode = changes.parentMode ?? 0o500;
  const parent = {
    dev: 1,
    ino: 1,
    uid: changes.parentUid ?? 501,
    get mode() {
      return parentMode;
    },
    isSymbolicLink: () => changes.parentSymlink ?? false,
    isFile: () => false,
    isDirectory: () => changes.parentDirectory ?? true,
  } as unknown as import('node:fs').Stats;
  const handle = fakeImmutableHandle(launcher, changes.source ?? 'expected');
  const dependencies = {
    mkdir: vi.fn(async () => undefined),
    writeFile: changes.writeFile ?? vi.fn(async () => undefined),
    chmod:
      changes.chmod ??
      vi.fn(async (value: string, mode: number) => {
        if (value.endsWith('/bin')) parentMode = mode;
      }),
    realpath: vi.fn(async (value: string) =>
      value.endsWith('/bin') && changes.parentRealpath
        ? changes.parentRealpath
        : value,
    ),
    lstat: vi.fn(async (value: string) =>
      value.endsWith('/bin') ? parent : launcher,
    ),
    stat: vi.fn(async (value: string) =>
      value.endsWith('/bin') ? parent : launcher,
    ),
    readFile: vi.fn(async () => changes.source ?? 'expected'),
    getuid: () => 501,
    open: changes.launcherSymlink
      ? vi.fn(async () => {
          throw Object.assign(new Error('symlink'), { code: 'ELOOP' });
        })
      : vi.fn(async () => handle),
    handle,
  };
  return dependencies;
}

describe('immutable Devin agent config', () => {
  it('creates mode 0600 with exclusive create and reuses exact bytes', async () => {
    const dependencies = immutableConfigDependencies();
    dependencies.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await ensureDevinAgentConfig(
      '/jobs/job/.nanocrab/devin-agent.json',
      '{}',
      dependencies,
    );
    expect(dependencies.open).toHaveBeenLastCalledWith(
      '/jobs/job/.nanocrab/devin-agent.json',
      fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_RDWR |
        fs.constants.O_NOFOLLOW,
      0o600,
    );
    expect(dependencies.handle.writeFile).toHaveBeenCalledWith('{}', 'utf8');
    expect(dependencies.handle.sync).toHaveBeenCalledOnce();
    expect(dependencies.handle.chmod).toHaveBeenCalledWith(0o600);
    expect(dependencies.handle.read).toHaveBeenCalled();
    expect(dependencies.handle.close).toHaveBeenCalledOnce();

    const unsafeCreate = immutableConfigDependencies({ mode: 0o644 });
    unsafeCreate.lstat.mockRejectedValueOnce(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    );
    await expect(
      ensureDevinAgentConfig(
        '/jobs/job/.nanocrab/unsafe-agent.json',
        '{}',
        unsafeCreate,
      ),
    ).rejects.toThrow(/config|metadata|immutable/i);
    expect(unsafeCreate.handle.writeFile).toHaveBeenCalled();
    expect(unsafeCreate.handle.sync).toHaveBeenCalled();
    expect(unsafeCreate.handle.chmod).toHaveBeenCalledWith(0o600);
    expect(unsafeCreate.handle.stat).toHaveBeenCalled();
    expect(unsafeCreate.handle.read).not.toHaveBeenCalled();
    expect(unsafeCreate.handle.close).toHaveBeenCalledOnce();

    const existing = immutableConfigDependencies({ source: '{}' });
    await expect(
      ensureDevinAgentConfig(
        '/jobs/job/.nanocrab/devin-agent.json',
        '{}',
        existing,
      ),
    ).resolves.toBeUndefined();
    expect(existing.open).toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/devin-agent.json',
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
    expect(existing.realpath).not.toHaveBeenCalled();
    expect(existing.stat).not.toHaveBeenCalled();
    expect(existing.readFile).not.toHaveBeenCalled();
    expect(existing.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['tampered bytes', { source: 'tampered' }],
    ['symlink', { symlink: true }],
    ['FIFO', { fifo: true }],
    ['mode 0644', { mode: 0o644 }],
  ])('rejects an existing unsafe config with %s', async (_name, change) => {
    const dependencies = immutableConfigDependencies(change);
    await expect(
      ensureDevinAgentConfig(
        '/jobs/job/.nanocrab/devin-agent.json',
        '{}',
        dependencies,
      ),
    ).rejects.toThrow(/config|immutable|unsafe/i);
    expect(dependencies.writeFile).not.toHaveBeenCalled();
    expect(dependencies.open).toHaveBeenCalled();
    expect(dependencies.handle.read).not.toHaveBeenCalled();
  });
});

function immutableConfigDependencies(
  changes: {
    source?: string;
    symlink?: boolean;
    fifo?: boolean;
    mode?: number;
  } = {},
) {
  const stats = {
    dev: 2,
    ino: 3,
    uid: 501,
    mode: changes.mode ?? 0o600,
    isSymbolicLink: () => changes.symlink ?? false,
    isFile: () => !changes.fifo,
    size: Buffer.byteLength(changes.source ?? '{}'),
  } as unknown as import('node:fs').Stats;
  const handle = fakeImmutableHandle(stats, changes.source ?? '{}');
  return {
    writeFile: vi.fn(async () => undefined),
    realpath: vi.fn(async (value: string) => value),
    lstat: vi.fn(async () => stats),
    stat: vi.fn(async () => stats),
    readFile: vi.fn(async () => changes.source ?? '{}'),
    getuid: () => 501,
    open: changes.symlink
      ? vi.fn(async () => {
          throw Object.assign(new Error('symlink'), { code: 'ELOOP' });
        })
      : vi.fn(async () => handle),
    handle,
  };
}

function fakeImmutableHandle(stats: import('node:fs').Stats, source: string) {
  let content = source;
  return {
    stat: vi.fn(
      async () =>
        ({
          ...stats,
          size: Buffer.byteLength(content),
        }) as import('node:fs').Stats,
    ),
    writeFile: vi.fn(async (data: string) => {
      content = data;
    }),
    sync: vi.fn(async () => undefined),
    chmod: vi.fn(async () => undefined),
    read: vi.fn(
      async (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        const bytes = Buffer.from(content).subarray(
          position,
          position + length,
        );
        bytes.copy(buffer, offset);
        return { bytesRead: bytes.length };
      },
    ),
    close: vi.fn(async () => undefined),
    content: () => content,
  };
}

class FakeCodingProcess extends EventEmitter implements SpawnedCodingProcess {
  pid: number;
  killed = false;
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: NodeJS.Signals[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }

  fail(error = new Error('synthetic spawn failure')): void {
    this.emit('error', error);
  }

  close(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}

const canonicalRuntime = {
  executable: '/opt/devin/bin/devin',
  nodeExecutable: '/usr/local/bin/node',
  sandboxExecutable: '/usr/bin/bwrap' as const,
  trustedRuntimeReadRoots: ['/opt/devin', '/usr/local', '/usr/bin'],
};

function runnerInput(
  overrides: Partial<CodingRunnerInput> = {},
): CodingRunnerInput {
  return {
    jobId: 'job',
    attemptId: 'attempt-1',
    cli: 'devin',
    model: 'claude-sonnet-4',
    stageKind: null,
    workspace: '/jobs/job/owner__repo',
    promptFile: '/jobs/job/.nanocrab/prompt.txt',
    timeoutMs: 1_000,
    onOutput: vi.fn(),
    ...overrides,
  };
}

function runnerHarness(processes = [new FakeCodingProcess(101)]) {
  let spawnIndex = 0;
  const groupSignals: Array<[number, NodeJS.Signals]> = [];
  const timers = {
    setTimeout: (callback: () => void, delayMs: number) =>
      setTimeout(callback, delayMs),
    clearTimeout: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout),
  };
  const registry = createProcessRegistry({
    randomToken: (() => {
      let value = 0;
      return () => `lease-${++value}`;
    })(),
    signalGroup: (pid, signal) => groupSignals.push([pid, signal]),
    timers,
    graceMs: 50,
  });
  const spawn = vi.fn(() => processes[spawnIndex++]!);
  const ensureConfig = vi.fn(async () => undefined);
  const ensureLauncher = vi.fn(
    async () => '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
  );
  const getVerifiedRuntimeContext = vi.fn(
    (): typeof canonicalRuntime | null => canonicalRuntime,
  );
  const authHandoffAvailable = vi.fn(() => true);
  const realpath = vi.fn(async (value: string) => value);
  const buildSandboxedLaunch = vi.fn((input) =>
    buildSandboxedDevinLaunch(input, trustedSandboxFilesystem),
  );
  const runner = createDevinHostRunner({
    spawn,
    registry,
    timers,
    environmentSource: {
      HOME: '/home/service',
      XDG_CONFIG_HOME: '/home/service/.config',
      PATH: '/untrusted',
      GITHUB_TOKEN: 'github-secret-value',
    },
    knownSecrets: ['known-secret-value'],
    ensureAgentConfig: ensureConfig,
    realpath,
    getVerifiedRuntimeContext,
    authHandoffAvailable,
    buildSandboxedLaunch,
    ensureCommandBrokerLauncher: ensureLauncher,
    commandBrokerModulePath:
      '/opt/nanocrab/dist/coding-runners/command-broker.js',
    devinCredentialPath: '/home/service/.config/devin/credentials.json',
    home: '/home/service',
    nanocrabConfigRoot: '/home/service/.config/nanocrab',
    signalProcessGroup: (pid, signal) => groupSignals.push([pid, signal]),
  });
  return {
    runner,
    spawn,
    registry,
    ensureConfig,
    ensureLauncher,
    getVerifiedRuntimeContext,
    authHandoffAvailable,
    realpath,
    buildSandboxedLaunch,
    groupSignals,
  };
}

describe('Devin host process runner', () => {
  it('fails closed before resolving workspace or setting up files without auth handoff', async () => {
    const harness = runnerHarness();
    harness.authHandoffAvailable.mockReturnValue(false);
    const realpath = vi.spyOn(harness, 'realpath');
    await expect(harness.runner.run(runnerInput())).resolves.toMatchObject({
      state: 'failed',
      detail:
        'Sandboxed Devin authentication handoff is unavailable; no credential or host auth directory is mounted',
    });
    expect(harness.authHandoffAvailable).toHaveBeenCalledOnce();
    expect(realpath).not.toHaveBeenCalled();
    expect(harness.ensureLauncher).not.toHaveBeenCalled();
    expect(harness.ensureConfig).not.toHaveBeenCalled();
    expect(harness.buildSandboxedLaunch).not.toHaveBeenCalled();
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it('writes strict config outside the workspace and invokes the verified executable exactly', async () => {
    const process = new FakeCodingProcess(101);
    const harness = runnerHarness([process]);
    const input = runnerInput();
    const run = harness.runner.run(input);

    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    expect(harness.getVerifiedRuntimeContext).toHaveBeenCalledOnce();
    expect(harness.ensureLauncher).toHaveBeenCalledWith({
      stageKind: 'direct',
      workspace: '/jobs/job/owner__repo',
      jobRoot: '/jobs/job',
      commandBrokerModulePath:
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
      sandboxExecutable: '/usr/bin/bwrap',
      nodeExecutable: '/usr/local/bin/node',
      home: '/home/service',
      protectedPaths: [
        '/jobs/job/.nanocrab',
        '/home/service/.config/devin/credentials.json',
        '/home/service/.config/nanocrab',
      ],
      trustedRuntimeReadRoots: ['/opt/devin', '/usr/local', '/usr/bin'],
    });
    expect(harness.ensureConfig).toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/devin-agent.json',
      expect.stringContaining('Write(/jobs/job/owner__repo/**)'),
    );
    expect(harness.buildSandboxedLaunch).toHaveBeenCalledWith({
      sandboxExecutable: '/usr/bin/bwrap',
      stageKind: 'direct',
      workspace: '/jobs/job/owner__repo',
      executable: '/opt/devin/bin/devin',
      args: [
        '--prompt-file',
        '/jobs/job/.nanocrab/prompt.txt',
        '--model',
        'claude-sonnet-4',
        '--permission-mode',
        'auto',
        '--sandbox',
        '--agent-config',
        '/jobs/job/.nanocrab/devin-agent.json',
        '--respect-workspace-trust',
        'true',
        '-p',
      ],
      trustedRuntimeReadRoots: ['/opt/devin', '/usr/local', '/usr/bin'],
      temporaryDirectory: '/tmp',
      readOnlyPaths: [
        '/jobs/job/.nanocrab/prompt.txt',
        '/jobs/job/.nanocrab/devin-agent.json',
        '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
      ],
    });
    expect(harness.spawn).toHaveBeenCalledWith(
      '/usr/bin/bwrap',
      [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--tmpfs',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        '--dir',
        '/opt',
        '--dir',
        '/usr',
        '--dir',
        '/jobs',
        '--dir',
        '/tmp',
        '--dir',
        '/opt/devin',
        '--dir',
        '/usr/local',
        '--dir',
        '/usr/bin',
        '--dir',
        '/jobs/job',
        '--dir',
        '/opt/nanocrab',
        '--dir',
        '/jobs/job/owner__repo',
        '--dir',
        '/jobs/job/.nanocrab',
        '--dir',
        '/opt/nanocrab/dist',
        '--dir',
        '/jobs/job/owner__repo/.git',
        '--dir',
        '/jobs/job/.nanocrab/bin',
        '--dir',
        '/opt/nanocrab/dist/coding-runners',
        '--ro-bind',
        '/opt/devin',
        '/opt/devin',
        '--ro-bind',
        '/usr/local',
        '/usr/local',
        '--ro-bind',
        '/usr/bin',
        '/usr/bin',
        '--bind',
        '/jobs/job/owner__repo',
        '/jobs/job/owner__repo',
        '--ro-bind',
        '/jobs/job/owner__repo/.git',
        '/jobs/job/owner__repo/.git',
        '--bind',
        '/tmp',
        '/tmp',
        '--ro-bind',
        '/jobs/job/.nanocrab/prompt.txt',
        '/jobs/job/.nanocrab/prompt.txt',
        '--ro-bind',
        '/jobs/job/.nanocrab/devin-agent.json',
        '/jobs/job/.nanocrab/devin-agent.json',
        '--ro-bind',
        '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
        '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
        '--ro-bind',
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
        '/opt/nanocrab/dist/coding-runners/command-broker.js',
        '--chdir',
        '/jobs/job/owner__repo',
        '--',
        '/opt/devin/bin/devin',
        '--prompt-file',
        '/jobs/job/.nanocrab/prompt.txt',
        '--model',
        'claude-sonnet-4',
        '--permission-mode',
        'auto',
        '--sandbox',
        '--agent-config',
        '/jobs/job/.nanocrab/devin-agent.json',
        '--respect-workspace-trust',
        'true',
        '-p',
      ],
      {
        cwd: '/jobs/job/owner__repo',
        env: {
          HOME: '/home/service',
          XDG_CONFIG_HOME: '/home/service/.config',
          PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          TMPDIR: '/tmp',
          TERM: 'dumb',
          NO_COLOR: '1',
        },
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    process.close(0);
    await expect(run).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('consumes the fresh verified canonical executable on every run', async () => {
    const first = new FakeCodingProcess(201);
    const second = new FakeCodingProcess(202);
    const harness = runnerHarness([first, second]);
    harness.getVerifiedRuntimeContext
      .mockReturnValueOnce(canonicalRuntime)
      .mockReturnValueOnce({
        ...canonicalRuntime,
        executable: '/opt/devin-v2/bin/devin',
        trustedRuntimeReadRoots: ['/opt/devin-v2', '/usr/local', '/usr/bin'],
      });
    const firstRun = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    first.close(0);
    await firstRun;
    const secondRun = harness.runner.run(
      runnerInput({ attemptId: 'attempt-2' }),
    );
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    second.close(0);
    await secondRun;
    const sandboxCalls = harness.buildSandboxedLaunch.mock
      .calls as unknown as Array<[{ executable: string }]>;
    expect(sandboxCalls.map(([call]) => call.executable)).toEqual([
      '/opt/devin/bin/devin',
      '/opt/devin-v2/bin/devin',
    ]);
    const spawnCalls = harness.spawn.mock.calls as unknown as Array<[string]>;
    expect(spawnCalls.map((call) => call[0])).toEqual([
      '/usr/bin/bwrap',
      '/usr/bin/bwrap',
    ]);
  });

  it('fails closed before spawn when whole-process isolation cannot be prepared', async () => {
    const harness = runnerHarness();
    harness.buildSandboxedLaunch.mockRejectedValueOnce(
      new Error('sandbox unavailable'),
    );

    await expect(harness.runner.run(runnerInput())).resolves.toEqual({
      attemptId: 'attempt-1',
      state: 'failed',
      exitCode: null,
      signal: null,
      detail: 'Devin process isolation failed',
    });
    expect(harness.spawn).not.toHaveBeenCalled();
  });

  it('terminates an unleased detached process group when registration fails', async () => {
    const process = new FakeCodingProcess(203);
    const harness = runnerHarness([process]);
    vi.spyOn(harness.registry, 'register').mockImplementationOnce(() => {
      throw new Error('duplicate');
    });
    await expect(harness.runner.run(runnerInput())).resolves.toMatchObject({
      state: 'failed',
      detail: 'Devin process registration failed',
    });
    expect(harness.groupSignals).toContainEqual([-203, 'SIGTERM']);
    expect(process.signals).toEqual([]);
  });

  it('emits one bounded safe truncation marker per truncated stream', async () => {
    const process = new FakeCodingProcess(204);
    const harness = runnerHarness([process]);
    const chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }> = [];
    const run = harness.runner.run(
      runnerInput({ onOutput: (chunk) => chunks.push(chunk) }),
    );
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    process.stdout.write(`known-secret-value ${'x'.repeat(1_100_000)}`);
    process.stderr.write(`known-secret-value ${'y'.repeat(1_100_000)}`);
    process.close(0);
    await run;
    for (const stream of ['stdout', 'stderr'] as const) {
      const text = chunks
        .filter((chunk) => chunk.stream === stream)
        .map((chunk) => chunk.text)
        .join('');
      expect(text).not.toContain('known-secret-value');
      expect(text.match(/NanoCrab: Devin output truncated/g)).toHaveLength(1);
      expect(text.length).toBeLessThanOrEqual(1_048_576);
    }
  });

  it('registers before output, preserves stream order, and bounds only redacted output', async () => {
    const process = new FakeCodingProcess(102);
    const harness = runnerHarness([process]);
    const chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }> = [];
    const input = runnerInput({ onOutput: (chunk) => chunks.push(chunk) });
    const owns = vi.spyOn(harness.registry, 'owns');
    const run = harness.runner.run(input);

    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    process.stdout.write('first ');
    process.stderr.write('second known-');
    process.stderr.write(`secret-value ${'x'.repeat(1_100_000)}`);
    process.stdout.write('third');
    process.close(0);
    await run;

    expect(owns).toHaveBeenCalled();
    expect(chunks.map((chunk) => chunk.stream)).toEqual([
      'stdout',
      'stderr',
      'stderr',
      'stdout',
    ]);
    const output = chunks.map((chunk) => chunk.text).join('');
    expect(output).not.toContain('known-secret-value');
    expect(output).toContain('[REDACTED]');
    expect(output.length).toBeLessThanOrEqual(1_048_576);
  });

  it('maps exit zero to succeeded and nonzero to failed with a redacted stderr tail', async () => {
    const first = new FakeCodingProcess(103);
    const second = new FakeCodingProcess(104);
    const harness = runnerHarness([first, second]);
    const success = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    first.close(0);
    await expect(success).resolves.toEqual({
      attemptId: 'attempt-1',
      state: 'succeeded',
      exitCode: 0,
      signal: null,
    });

    const failed = harness.runner.run(runnerInput({ attemptId: 'attempt-2' }));
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    second.stderr.write(
      `prefix known-secret-value ${'z'.repeat(1_100_000)} FINAL-TAIL`,
    );
    second.close(7);
    await expect(failed).resolves.toMatchObject({
      attemptId: 'attempt-2',
      state: 'failed',
      exitCode: 7,
      signal: null,
      detail: expect.stringMatching(/^Devin exited with code 7: /),
    });
    const result = await failed;
    expect(result.detail).not.toContain('known-secret-value');
    expect(result.detail).toContain('FINAL-TAIL');
    expect(result.detail!.length).toBeLessThan(8_300);
  });

  it('maps spawn error once and ignores a later close', async () => {
    const process = new FakeCodingProcess(105);
    const harness = runnerHarness([process]);
    const run = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    process.fail(new Error('known-secret-value filesystem details'));
    process.close(0);
    await expect(run).resolves.toEqual({
      attemptId: 'attempt-1',
      state: 'failed',
      exitCode: null,
      signal: null,
      detail: 'Devin process failed to start',
    });
  });

  it('times out with TERM then KILL and remains timed_out after close', async () => {
    vi.useFakeTimers();
    const process = new FakeCodingProcess(106);
    const harness = runnerHarness([process]);
    const run = harness.runner.run(runnerInput({ timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(100);
    await expect(run).resolves.toMatchObject({
      state: 'timed_out',
      detail: 'Devin process timed out',
    });
    process.close(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(harness.groupSignals).toEqual([
      [-106, 'SIGTERM'],
      [-106, 'SIGKILL'],
    ]);
    vi.useRealTimers();
  });

  it('cancels the exact attempt and remains cancelled after error or close', async () => {
    const process = new FakeCodingProcess(107);
    const harness = runnerHarness([process]);
    const run = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    expect(harness.runner.cancel('job', 'other-attempt')).toBe(false);
    expect(harness.runner.cancel('job', 'attempt-1')).toBe(true);
    process.fail();
    process.close(1);
    await expect(run).resolves.toMatchObject({
      state: 'cancelled',
      detail: 'Devin process cancelled',
    });
  });

  it('makes repeated cancellation idempotent', async () => {
    const process = new FakeCodingProcess(108);
    const harness = runnerHarness([process]);
    const run = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledOnce());
    expect(harness.runner.cancel('job', 'attempt-1')).toBe(true);
    expect(harness.runner.cancel('job', 'attempt-1')).toBe(false);
    await run;
    expect(harness.groupSignals).toEqual([[-108, 'SIGTERM']]);
  });

  it('does not emit stale output after a newer retry owns the job', async () => {
    const oldProcess = new FakeCodingProcess(109);
    const newProcess = new FakeCodingProcess(110);
    const harness = runnerHarness([oldProcess, newProcess]);
    const oldOutput = vi.fn();
    const newOutput = vi.fn();
    void harness.runner.run(runnerInput({ onOutput: oldOutput }));
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    void harness.runner.run(
      runnerInput({ attemptId: 'attempt-2', onOutput: newOutput }),
    );
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    oldProcess.stdout.write('stale');
    newProcess.stdout.write('current');
    expect(oldOutput).not.toHaveBeenCalled();
    expect(newOutput).toHaveBeenCalledWith({
      stream: 'stdout',
      text: 'current',
    });
  });

  it('does not let stale close error or timeout delete a newer lease', async () => {
    vi.useFakeTimers();
    const oldProcess = new FakeCodingProcess(111);
    const newProcess = new FakeCodingProcess(112);
    const harness = runnerHarness([oldProcess, newProcess]);
    void harness.runner.run(runnerInput({ timeoutMs: 100 }));
    await vi.advanceTimersByTimeAsync(10);
    void harness.runner.run(
      runnerInput({ attemptId: 'attempt-2', timeoutMs: 1_000 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    oldProcess.fail();
    oldProcess.close(1);
    expect(harness.registry.get('job', 'attempt-2')?.process).toBe(newProcess);
    vi.useRealTimers();
  });

  it('cancel followed by retry signals only the old process group', async () => {
    const oldProcess = new FakeCodingProcess(113);
    const newProcess = new FakeCodingProcess(114);
    const harness = runnerHarness([oldProcess, newProcess]);
    const oldRun = harness.runner.run(runnerInput());
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    expect(harness.runner.cancel('job', 'attempt-1')).toBe(true);
    await oldRun;
    void harness.runner.run(runnerInput({ attemptId: 'attempt-2' }));
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    expect(harness.groupSignals[0]).toEqual([-113, 'SIGTERM']);
    expect(harness.groupSignals.every(([pid]) => pid === -113)).toBe(true);
  });

  it('flushes redactor carry safely on close and error', async () => {
    const closeProcess = new FakeCodingProcess(115);
    const errorProcess = new FakeCodingProcess(116);
    const harness = runnerHarness([closeProcess, errorProcess]);
    const closeOutput = vi.fn();
    const closeRun = harness.runner.run(runnerInput({ onOutput: closeOutput }));
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(1));
    closeProcess.stdout.write('Bearer final-secret');
    closeProcess.close(0);
    await closeRun;
    expect(JSON.stringify(closeOutput.mock.calls)).not.toContain(
      'final-secret',
    );
    expect(closeOutput).toHaveBeenCalledWith({
      stream: 'stdout',
      text: 'Bearer [REDACTED]',
    });

    const errorOutput = vi.fn();
    const errorRun = harness.runner.run(
      runnerInput({ attemptId: 'attempt-2', onOutput: errorOutput }),
    );
    await vi.waitFor(() => expect(harness.spawn).toHaveBeenCalledTimes(2));
    errorProcess.stderr.write('sk-final-secret');
    errorProcess.fail();
    await errorRun;
    expect(JSON.stringify(errorOutput.mock.calls)).not.toContain(
      'final-secret',
    );
    expect(errorOutput).toHaveBeenCalledWith({
      stream: 'stderr',
      text: 'sk-[REDACTED]',
    });
  });

  it('fails closed on missing runtime verification or noncanonical path layout', async () => {
    const missing = runnerHarness();
    missing.getVerifiedRuntimeContext.mockReturnValueOnce(null);
    await expect(missing.runner.run(runnerInput())).resolves.toMatchObject({
      state: 'failed',
      detail: 'Devin runtime verification is unavailable',
    });
    expect(missing.spawn).not.toHaveBeenCalled();

    const mismatched = runnerHarness();
    await expect(
      mismatched.runner.run(
        runnerInput({ promptFile: '/tmp/.nanocrab/prompt.txt' }),
      ),
    ).resolves.toMatchObject({
      state: 'failed',
      detail: 'Devin workspace layout is invalid',
    });
    expect(mismatched.spawn).not.toHaveBeenCalled();
  });
});
