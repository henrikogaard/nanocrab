import { describe, expect, it, vi } from 'vitest';

import {
  buildSandboxedCommand,
  runCommandBrokerCli,
  validateBrokerCommand,
  type BrokerRequest,
  type CommandBrokerDependencies,
} from './command-broker.js';

const workspace = '/jobs/job/repo';
const home = '/home/service';
const protectedPaths = [
  '/jobs/job/.nanocrab',
  '/home/service/.config/devin/credentials.json',
  '/home/service/.config/nanocrab',
] as const;
const trustedRuntimeReadRoots = ['/usr'] as const;

function request(
  argv: readonly string[],
  stageKind: BrokerRequest['stageKind'] = 'planning',
  cwd = workspace,
): BrokerRequest {
  return {
    stageKind,
    workspace,
    cwd,
    argv,
    home,
    protectedPaths,
    trustedRuntimeReadRoots,
  };
}

const inspectionCommands = [
  ['pwd'],
  ['ls'],
  ['ls', '-la', 'src'],
  ['find', '.', '-maxdepth', '2', '-type', 'f', '-name', '*.ts', '-print'],
  ['rg', '-n', '--glob', '*.ts', 'needle', 'src'],
  ['rg', '--files', '--glob', '*.ts', 'src'],
  ['grep', '-r', '-n', 'needle', 'src'],
  ['cat', '--', 'package.json'],
  ['head', '-n', '20', 'README.md'],
  ['tail', '-n', '20', 'README.md'],
  ['wc', '-l', 'README.md'],
  ['file', '--', 'package.json'],
  ['stat', '--', 'package.json'],
] as const;

const gitReadCommands = [
  ['git', 'status'],
  ['git', 'status', '--short'],
  ['git', 'diff'],
  ['git', 'diff', '--check'],
  ['git', 'diff', '--stat', 'HEAD'],
  ['git', 'log', '--oneline', '-n', '10'],
  ['git', 'show', '--stat', 'HEAD'],
  ['git', 'ls-files', '--', 'src'],
  ['git', 'branch', '--show-current'],
  ['git', 'rev-parse', '--show-toplevel'],
] as const;

describe('command policy', () => {
  it.each(
    [...inspectionCommands, ...gitReadCommands].map((argv) => ({ argv })),
  )('allows exact inspection command $argv', ({ argv }) => {
    expect(() => validateBrokerCommand(request(argv))).not.toThrow();
  });

  it.each([
    ['npm', 'test'],
    ['npm', 'run', 'test:unit'],
    ['pnpm', 'test'],
    ['pnpm', 'run', 'test:unit'],
    ['yarn', 'test'],
    ['yarn', 'run', 'test:unit'],
    ['bun', 'test'],
    ['bun', 'run', 'test:unit'],
    ['cargo', 'test'],
    ['cargo', 'check'],
    ['cargo', 'build'],
    ['go', 'test'],
    ['go', 'build'],
    ['go', 'vet'],
    ['pytest'],
    ['python', '-m', 'pytest'],
  ])('allows exact implement command %j', (...argv) => {
    expect(() =>
      validateBrokerCommand(request(argv, 'implement')),
    ).not.toThrow();
  });

  it.each([
    ['git', 'commit'],
    ['git', 'push'],
    ['git', 'reset', '--hard'],
    ['npm', 'install'],
    ['npm', 'run', 'deploy'],
    ['pnpm', 'publish'],
    ['curl', 'https://example.com'],
    ['ssh', 'host'],
    ['bash', '-c', 'id'],
    ['docker', 'run', 'x'],
    ['sudo', 'id'],
    ['rm', '-rf', '.'],
    ['python', '-c', 'import os'],
    ['node', '-e', 'process.exit()'],
    ['rg', '--pre', 'bash -c id', 'needle'],
    ['git', '-c', 'core.pager=cat', 'status'],
    ['git', 'status', '--config', 'x'],
    ['find', '.', '-exec', 'id', ';'],
    ['grep', '--file=patterns', 'src'],
    ['env', 'NAME=value', 'pwd'],
    ['NAME=value', 'pwd'],
  ])('rejects denied command %j', (...argv) => {
    expect(() => validateBrokerCommand(request(argv, 'implement'))).toThrow(
      /denied|invalid|allowed/i,
    );
  });

  it.each([
    ['/usr/bin/git', 'status'],
    ['../bin/git', 'status'],
    ['git/../../bin/git', 'status'],
  ])('rejects absolute or traversing executable %j', (...argv) => {
    expect(() => validateBrokerCommand(request(argv))).toThrow();
  });

  it.each([
    ['cat', '/etc/passwd'],
    ['cat', '../secret'],
    ['rg', 'needle', '../../outside'],
    ['git', 'show', '/etc/passwd'],
  ])('rejects external path operand %j', (...argv) => {
    expect(() => validateBrokerCommand(request(argv))).toThrow();
  });

  it.each([
    ['pwd', 'bad\narg'],
    ['cat', 'bad\0arg'],
  ])('rejects control characters in %j', (...argv) => {
    expect(() => validateBrokerCommand(request(argv))).toThrow();
  });

  it('rejects cwd outside the workspace', () => {
    expect(() =>
      validateBrokerCommand(request(['pwd'], 'planning', '/tmp')),
    ).toThrow(/cwd|workspace/i);
  });

  it.each(['planning', 'review'] as const)(
    'rejects build commands during %s',
    (stageKind) => {
      expect(() =>
        validateBrokerCommand(request(['npm', 'test'], stageKind)),
      ).toThrow();
    },
  );
});

function dependencies(
  overrides: Partial<CommandBrokerDependencies> = {},
): CommandBrokerDependencies {
  return {
    platform: 'linux',
    execute: vi.fn(async () => 0),
    readFile: vi.fn(async () =>
      JSON.stringify({ scripts: { 'test:unit': 'vitest run' } }),
    ),
    realpath: vi.fn(async (value: string) => value),
    environmentSource: {
      HOME: '/home/service',
      PATH: '.:/jobs/job/repo',
      TMPDIR: '/tmp',
      GITHUB_TOKEN: 'secret',
    },
    sandboxExecutable: '/usr/bin/bwrap',
    ...overrides,
  };
}

describe('command execution', () => {
  it('canonicalizes workspace and cwd before executing an inspection command', async () => {
    const deps = dependencies();

    await expect(runCommandBrokerCli(request(['pwd']), deps)).resolves.toBe(0);

    expect(deps.realpath).toHaveBeenNthCalledWith(1, workspace);
    expect(deps.realpath).toHaveBeenNthCalledWith(2, workspace);
    expect(deps.execute).toHaveBeenCalledWith('pwd', [], {
      cwd: workspace,
      env: expect.not.objectContaining({ GITHUB_TOKEN: expect.anything() }),
      shell: false,
      stdio: 'inherit',
    });
  });

  it('requires an approved manifest script before command spawn', async () => {
    const deps = dependencies({
      readFile: vi.fn(async () => JSON.stringify({ scripts: {} })),
    });

    await expect(
      runCommandBrokerCli(
        request(['npm', 'run', 'test:unit'], 'implement'),
        deps,
      ),
    ).rejects.toThrow(/script/i);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('rejects a package manifest whose canonical path escapes the workspace', async () => {
    const deps = dependencies({
      realpath: vi.fn(async (value: string) =>
        value.endsWith('package.json') ? '/tmp/package.json' : value,
      ),
    });

    await expect(
      runCommandBrokerCli(
        request(['npm', 'run', 'test:unit'], 'implement'),
        deps,
      ),
    ).rejects.toThrow(/manifest|workspace/i);
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('rejects a canonical cwd that escapes the canonical workspace', async () => {
    const deps = dependencies({
      realpath: vi
        .fn()
        .mockResolvedValueOnce(workspace)
        .mockResolvedValueOnce('/tmp/escaped'),
    });

    await expect(runCommandBrokerCli(request(['pwd']), deps)).rejects.toThrow(
      /cwd|workspace/i,
    );
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it('rejects a workspace-relative read operand whose canonical path escapes', async () => {
    const deps = dependencies({
      realpath: vi.fn(async (value: string) =>
        value.endsWith('/linked-secret')
          ? '/home/service/.ssh/id_ed25519'
          : value,
      ),
    });

    await expect(
      runCommandBrokerCli(request(['cat', 'linked-secret']), deps),
    ).rejects.toThrow(/path|workspace/i);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it.each(['install:deps', 'publish:dry', 'release-ci', 'deploy-preview'])(
    'rejects dangerous manifest script name %s',
    async (script) => {
      const deps = dependencies({
        readFile: vi.fn(async () =>
          JSON.stringify({ scripts: { [script]: 'x' } }),
        ),
      });
      await expect(
        runCommandBrokerCli(request(['npm', 'run', script], 'implement'), deps),
      ).rejects.toThrow(/script|denied/i);
      expect(deps.execute).not.toHaveBeenCalled();
    },
  );

  it('wraps Linux build commands in a networkless writable-workspace sandbox', async () => {
    const deps = dependencies();
    await runCommandBrokerCli(request(['npm', 'test'], 'implement'), deps);

    const [executable, args, options] = vi.mocked(deps.execute).mock.calls[0]!;
    expect(executable).toBe('/usr/bin/bwrap');
    expect(args).toEqual(
      expect.arrayContaining([
        '--unshare-net',
        '--tmpfs',
        '/',
        '--ro-bind',
        '/usr',
        '/usr',
        '--bind',
        workspace,
        workspace,
        '--bind',
        '/tmp',
        '/tmp',
        '--chdir',
        workspace,
        '--',
        'npm',
        'test',
      ]),
    );
    expect(
      args.some(
        (value, index) =>
          value === '--ro-bind' &&
          args[index + 1] === '/' &&
          args[index + 2] === '/',
      ),
    ).toBe(false);
    for (const protectedPath of [home, ...protectedPaths]) {
      expect(args).not.toContain(protectedPath);
    }
    expect(options).toEqual({
      cwd: workspace,
      env: expect.objectContaining({ TERM: 'dumb', NO_COLOR: '1' }),
      shell: false,
      stdio: 'inherit',
    });
  });

  it('builds a macOS network-deny profile with workspace-only writes', () => {
    const result = buildSandboxedCommand(request(['pytest'], 'implement'), {
      platform: 'darwin',
      sandboxExecutable: '/usr/bin/sandbox-exec',
      environmentSource: { HOME: '/home/service', TMPDIR: '/tmp' },
    });

    expect(result.executable).toBe('/usr/bin/sandbox-exec');
    expect(result.args.slice(0, 3)).toEqual(['-p', expect.any(String), '--']);
    expect(result.args.slice(-1)).toEqual(['pytest']);
    expect(result.args[1]).toContain('(deny network*)');
    expect(result.args[1]).toContain(`(subpath "${workspace}")`);
    expect(result.args[1]).toContain('(subpath "/tmp")');
    for (const runtimeRoot of trustedRuntimeReadRoots) {
      expect(result.args[1]).toContain(`(subpath "${runtimeRoot}")`);
    }
    expect(result.args[1]).not.toContain('(allow file-read*)');
    for (const protectedPath of [home, ...protectedPaths]) {
      expect(result.args[1]).not.toContain(protectedPath);
    }
  });

  it.each([
    ['linux', '/usr/bin/sandbox-exec'],
    ['darwin', '/usr/bin/bwrap'],
    ['win32', '/usr/bin/bwrap'],
  ] as const)(
    'fails closed for unsupported isolation %s %s',
    (platform, sandboxExecutable) => {
      expect(() =>
        buildSandboxedCommand(request(['npm', 'test'], 'implement'), {
          platform,
          sandboxExecutable,
          environmentSource: { HOME: '/home/service', TMPDIR: '/tmp' },
        }),
      ).toThrow(/sandbox|platform|isolation/i);
    },
  );

  it('rejects a relative sandbox temp root', () => {
    expect(() =>
      buildSandboxedCommand(request(['npm', 'test'], 'implement'), {
        platform: 'linux',
        sandboxExecutable: '/usr/bin/bwrap',
        environmentSource: { HOME: '/home/service', TMPDIR: 'relative-tmp' },
      }),
    ).toThrow(/temp|sandbox/i);
  });

  it.each([
    {
      label: 'noncanonical runtime root',
      change: { trustedRuntimeReadRoots: ['/usr/../usr'] },
    },
    {
      label: 'runtime root overlapping protected config',
      change: {
        trustedRuntimeReadRoots: ['/home/service/.config'],
      },
    },
    {
      label: 'runtime root exposing service home',
      change: { trustedRuntimeReadRoots: ['/home'] },
    },
    {
      label: 'missing runtime roots',
      change: { trustedRuntimeReadRoots: [] },
    },
    {
      label: 'duplicate protected roots',
      change: { protectedPaths: [protectedPaths[0], protectedPaths[0]] },
    },
    {
      label: 'overlapping runtime roots',
      change: { trustedRuntimeReadRoots: ['/usr', '/usr/bin'] },
    },
    {
      label: 'runtime root overlapping writable workspace',
      change: { trustedRuntimeReadRoots: [workspace] },
    },
    {
      label: 'protected root overlapping writable temp',
      change: { protectedPaths: ['/tmp'] },
    },
  ])('rejects $label before sandbox construction', ({ change }) => {
    expect(() =>
      buildSandboxedCommand(
        { ...request(['npm', 'test'], 'implement'), ...change },
        {
          platform: 'linux',
          sandboxExecutable: '/usr/bin/bwrap',
          environmentSource: { HOME: home, TMPDIR: '/tmp' },
        },
      ),
    ).toThrow(/root|protected|canonical|home|isolation/i);
  });

  it('allows one explicitly trusted runtime directory below service home', () => {
    const result = buildSandboxedCommand(
      {
        ...request(['npm', 'test'], 'implement'),
        trustedRuntimeReadRoots: ['/home/service/.local/bin'],
      },
      {
        platform: 'linux',
        sandboxExecutable: '/usr/bin/bwrap',
        environmentSource: { HOME: home, TMPDIR: '/tmp' },
      },
    );

    expect(result.args).toEqual(
      expect.arrayContaining([
        '--ro-bind',
        '/home/service/.local/bin',
        '/home/service/.local/bin',
      ]),
    );
    expect(result.args).not.toContain('/home/service/.config');
  });
});
