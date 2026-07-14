import type { PathLike } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  buildDevinAgentConfig,
  buildDevinChildEnvironment,
  writeDevinCommandBrokerLauncher,
} from './devin-host.js';

const input = {
  stageKind: 'planning' as const,
  workspace: '/jobs/job/repo',
  jobRoot: '/jobs/job',
  brokerPath: '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
  devinCredentialPath: '/home/service/.config/devin/credentials.json',
  home: '/home/service',
  nanocrabConfigRoot: '/home/service/.config/nanocrab',
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

describe('Devin command broker launcher', () => {
  it('writes a secret-free immutable Node launcher outside the workspace', async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const chmod = vi.fn(async () => undefined);
    const realpath = vi.fn(async (value: PathLike) => value.toString());

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
        { mkdir, writeFile, chmod, realpath },
      ),
    ).resolves.toBe('/jobs/job/.nanocrab/bin/nanocrab-job-exec');

    expect(mkdir).toHaveBeenCalledWith('/jobs/job/.nanocrab/bin', {
      recursive: true,
      mode: 0o700,
    });
    expect(writeFile).toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
      expect.stringMatching(/^#!\/usr\/bin\/node\n/),
      { encoding: 'utf8', mode: 0o555, flag: 'wx' },
    );
    const source = (
      writeFile.mock.calls as unknown as Array<[string, string]>
    )[0]![1];
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
    expect(chmod).toHaveBeenCalledWith(
      '/jobs/job/.nanocrab/bin/nanocrab-job-exec',
      0o555,
    );
    expect(chmod).toHaveBeenCalledWith('/jobs/job/.nanocrab/bin', 0o500);
  });

  it('rejects a Node executable outside trusted runtime roots before writing', async () => {
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const chmod = vi.fn(async () => undefined);
    const realpath = vi.fn(async (value: PathLike) => value.toString());

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
        { mkdir, writeFile, chmod, realpath },
      ),
    ).rejects.toThrow(/node|runtime|trusted/i);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects a noncanonical Node executable before writing', async () => {
    const writeFile = vi.fn(async () => undefined);
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
        {
          mkdir: vi.fn(async () => undefined),
          writeFile,
          chmod: vi.fn(async () => undefined),
          realpath: vi.fn(async () => '/usr/bin/node'),
        },
      ),
    ).rejects.toThrow(/node|canonical/i);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
