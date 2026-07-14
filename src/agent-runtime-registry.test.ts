import type fs from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
  inferLegacyRunnerCli,
  getVerifiedDevinAliases,
  getVerifiedDevinRuntimeContext,
  listAgentRuntimeDefinitions,
  probeAgentRuntime,
  probeDevinRuntime,
  resolveDevinCliModelAlias,
  validateCodingRuntimeSelection,
} from './agent-runtime-registry.js';
import type { AgentProvider } from './agent-provider.js';
import type { AgentCliId, AgentRuntimeSelection } from './types.js';
import {
  getCodingRunnerInfrastructure,
  isCodingContainerImageAvailable,
  probeCodingRunnerReadiness,
} from './coding-runner-readiness.js';
import { buildDevinChildEnvironment } from './coding-runners/devin-host.js';

const DEVIN_HELP = `
Usage: devin [options]
  --prompt-file <path>
  --model <model> (examples: claude-sonnet-4, claude-opus-4.6)
  --permission-mode <mode>
  --sandbox
  --agent-config <path>
  --respect-workspace-trust <boolean>
  -p
`;

function fakeStats(
  input: {
    mode?: number;
    uid?: number;
    dev?: number;
    ino?: number;
    regular?: boolean;
    directory?: boolean;
    symlink?: boolean;
  } = {},
): fs.Stats {
  return {
    mode: input.mode ?? 0o100600,
    uid: input.uid ?? 1000,
    dev: input.dev ?? 10,
    ino: input.ino ?? 20,
    isFile: () => input.regular !== false,
    isDirectory: () => input.directory === true,
    isSymbolicLink: () => input.symlink === true,
  } as fs.Stats;
}

function healthyDevinProbe(overrides: Record<string, unknown> = {}) {
  const env = { HOME: '/home/nanocrab', SECRET: 'must-not-leak' };
  const outputs = new Map([
    [JSON.stringify(['--version']), { stdout: 'devin 1.1.0\n', stderr: '' }],
    [JSON.stringify(['--help']), { stdout: DEVIN_HELP, stderr: '' }],
    [
      JSON.stringify(['auth', 'status']),
      { stdout: 'Authenticated as Person <person@example.test>', stderr: '' },
    ],
  ]);
  const credentialPath = '/home/nanocrab/.config/devin/credentials.json';
  const devinExecutable = '/opt/devin/bin/devin';
  const nodeExecutable = '/usr/local/bin/node';
  return {
    execFile: vi.fn(
      async (
        _executable: string,
        args: readonly string[],
        _options: { env: NodeJS.ProcessEnv; timeout: number },
      ) => outputs.get(JSON.stringify(args)) ?? { stdout: '', stderr: '' },
    ),
    realpath: vi.fn(async (value: string) => value),
    stat: vi.fn(async (value: string) => {
      if (value === credentialPath) return fakeStats();
      if (
        value === '/opt/devin' ||
        value === '/usr/local' ||
        value === '/usr/bin'
      ) {
        return fakeStats({
          mode: 0o40755,
          regular: false,
          directory: true,
        });
      }
      return fakeStats({ mode: 0o100755 });
    }),
    lstat: vi.fn(async () => fakeStats()),
    getuid: vi.fn(() => 1000),
    platform: 'linux' as const,
    commandAvailable: vi.fn(async () => true),
    env,
    credentialPath,
    resolveExecutable: vi.fn(async () => devinExecutable),
    executableSearchDirectories: ['/opt/devin/bin'],
    nodeExecutable,
    trustedRuntimeRootCandidates: ['/opt/devin', '/usr/local', '/usr/bin'],
    ...overrides,
  };
}

describe('agent runtime registry', () => {
  it.each([
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['pi', 'pi'],
    ['mistral', 'mistral'],
    ['opencode', 'opencode'],
    ['openrouter', 'opencode'],
    ['ollama', 'opencode'],
    ['openai-compatible', 'opencode'],
  ] satisfies Array<[AgentProvider, AgentCliId]>)(
    'infers legacy %s jobs as %s CLI jobs',
    (provider, expected) => {
      expect(inferLegacyRunnerCli(provider)).toBe(expected);
    },
  );

  it.each([
    ['claude', 'claude'],
    ['codex', 'codex'],
    ['opencode', 'opencode'],
    ['opencode', 'openrouter'],
    ['opencode', 'ollama'],
    ['opencode', 'openai-compatible'],
    ['pi', 'pi'],
    ['mistral', 'mistral'],
  ] satisfies Array<[AgentCliId, AgentProvider]>)(
    'accepts the %s CLI with the %s provider',
    (cli, provider) => {
      expect(() =>
        validateCodingRuntimeSelection({ cli, provider, model: 'model' }),
      ).not.toThrow();
    },
  );

  it.each([
    ['claude', 'openrouter'],
    ['codex', 'claude'],
    ['opencode', 'codex'],
    ['pi', 'openrouter'],
    ['mistral', 'claude'],
  ] satisfies Array<[AgentCliId, AgentProvider]>)(
    'rejects the incompatible %s CLI and %s provider',
    (cli, provider) => {
      expect(() =>
        validateCodingRuntimeSelection({
          cli,
          provider,
          model: 'model',
        }),
      ).toThrow('not compatible');
    },
  );

  it('resolves a configured and advertised Devin model alias', () => {
    const runtime: AgentRuntimeSelection = {
      cli: 'devin',
      provider: 'claude',
      model: 'claude-sonnet-4-6',
    };

    expect(
      resolveDevinCliModelAlias(
        runtime,
        { 'claude/claude-sonnet-4-6': 'claude-sonnet-4' },
        new Set(['claude-sonnet-4']),
      ),
    ).toBe('claude-sonnet-4');
    expect(() =>
      validateCodingRuntimeSelection(runtime, {
        aliases: { 'claude/claude-sonnet-4-6': 'claude-sonnet-4' },
        advertisedDevinAliases: new Set(['claude-sonnet-4']),
      }),
    ).not.toThrow();
  });

  it('rejects an unconfigured Devin model before advertised aliases are consulted', () => {
    const advertisedAliases = new Proxy(new Set<string>(), {
      get() {
        throw new Error('advertised aliases must not be consulted');
      },
    }) as ReadonlySet<string>;

    expect(() =>
      resolveDevinCliModelAlias(
        { cli: 'devin', provider: 'claude', model: 'unconfigured' },
        {},
        advertisedAliases,
      ),
    ).toThrow('no configured Devin CLI model alias');
  });

  it('rejects a configured Devin alias that is not advertised', () => {
    expect(() =>
      resolveDevinCliModelAlias(
        { cli: 'devin', provider: 'claude', model: 'claude-sonnet-4-6' },
        { 'claude/claude-sonnet-4-6': 'claude-sonnet-4' },
        new Set(['claude-opus-4.6']),
      ),
    ).toThrow('not advertised');
  });

  it('exposes allowlisted CLI definitions', () => {
    const definitions = listAgentRuntimeDefinitions();
    const cliIds = definitions.map((d) => d.cli);

    expect(cliIds).toContain('claude');
    expect(cliIds).toContain('codex');
    expect(cliIds).toContain('pi');
    expect(cliIds).toContain('opencode');
    expect(cliIds).toContain('devin');
    expect(cliIds).toContain('mistral');
    expect(definitions).toHaveLength(6);
  });

  it('maps mistral CLI to vibe executable', () => {
    const definitions = listAgentRuntimeDefinitions();
    const mistral = definitions.find((d) => d.cli === 'mistral');

    expect(mistral).toMatchObject({
      cli: 'mistral',
      executable: 'vibe',
      versionArgs: ['--version'],
    });
  });

  it('does not expose mutable runtime definitions', async () => {
    const definitions = listAgentRuntimeDefinitions();
    const exposed = definitions[0] as unknown as {
      executable: string;
      versionArgs: string[];
    };
    exposed.executable = '/tmp/run-anything';
    exposed.versionArgs[0] = '--execute';
    definitions.push({
      cli: 'codex',
      executable: '/tmp/second-run-anything',
      versionArgs: ['--evil'],
      codingRunnerSupported: true,
    });
    const execFile = vi.fn().mockResolvedValue({ stdout: '1.2.3', stderr: '' });

    await probeAgentRuntime('claude', { execFile });

    expect(execFile).toHaveBeenCalledWith(
      'claude',
      ['--version'],
      expect.anything(),
    );
    expect(listAgentRuntimeDefinitions()).toHaveLength(6);
  });

  it('reports missing runtime when executable not found', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'ENOENT' }),
      );

    const result = await probeAgentRuntime('pi', { execFile });

    expect(result).toMatchObject({
      cli: 'pi',
      executable: 'pi',
      status: 'missing',
    });
    expect(result.version).toBeNull();
    expect(result.checkedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('fails the public Devin runtime probe closed without touching probe dependencies', async () => {
    const deps = healthyDevinProbe({
      credentialPath: '/home/nanocrab/.config/devin/credentials.json',
    });

    await expect(
      probeAgentRuntime('devin', { devinDependencies: deps }),
    ).resolves.toMatchObject({
      cli: 'devin',
      status: 'error',
      detail: DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
    });
    expect(deps.realpath).not.toHaveBeenCalled();
    expect(deps.lstat).not.toHaveBeenCalled();
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.commandAvailable).not.toHaveBeenCalled();
    expect(deps.resolveExecutable).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('reports Pi coding readiness from the image and credential route, not host CLI', async () => {
    const hostProbe = vi.fn();

    await expect(
      probeCodingRunnerReadiness('pi', {
        probeHostRuntime: hostProbe,
        containerImageAvailable: vi.fn().mockReturnValue(true),
        credentialAvailable: vi
          .fn()
          .mockImplementation((key: string) => key === 'OPENROUTER_API_KEY'),
      }),
    ).resolves.toMatchObject({
      cli: 'pi',
      status: 'healthy',
      detail: expect.stringContaining('OpenRouter'),
    });
    expect(hostProbe).not.toHaveBeenCalled();
  });

  it('does not report Pi runnable without the OpenRouter credential route', async () => {
    await expect(
      probeCodingRunnerReadiness('pi', {
        probeHostRuntime: vi.fn(),
        containerImageAvailable: vi.fn().mockReturnValue(true),
        credentialAvailable: vi.fn().mockReturnValue(false),
      }),
    ).resolves.toMatchObject({
      cli: 'pi',
      status: 'missing',
      detail: expect.stringContaining('OPENROUTER_API_KEY'),
    });
  });

  it('uses the configured container runtime and image for coding readiness', () => {
    const infrastructure = getCodingRunnerInfrastructure({
      CONTAINER_RUNTIME_BIN: 'podman',
      CONTAINER_IMAGE: 'registry.example/nanocrab-agent:test',
    });
    const inspect = vi.fn().mockReturnValue(true);

    expect(isCodingContainerImageAvailable({ infrastructure, inspect })).toBe(
      true,
    );
    expect(inspect).toHaveBeenCalledWith(
      'podman',
      'registry.example/nanocrab-agent:test',
    );
  });

  it('reports healthy runtime with parsed version', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'codex-cli 1.2.3\n',
      stderr: '',
    });

    const result = await probeAgentRuntime('codex', { execFile });

    expect(result).toMatchObject({
      cli: 'codex',
      executable: 'codex',
      status: 'healthy',
    });
    expect(result.version).toBe('1.2.3');
  });

  it('reports supported runtimes as healthy when installed', async () => {
    const execFile = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'pi 0.4.0\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'vibe 0.9.1\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'codex-cli 1.2.3\n', stderr: '' });

    for (const [cli, executable, version] of [
      ['pi', 'pi', '0.4.0'],
      ['mistral', 'vibe', '0.9.1'],
    ] as const) {
      await expect(probeAgentRuntime(cli, { execFile })).resolves.toMatchObject(
        {
          cli,
          executable,
          status: 'healthy',
          version,
        },
      );
    }

    await expect(
      probeAgentRuntime('codex', { execFile }),
    ).resolves.toMatchObject({
      cli: 'codex',
      executable: 'codex',
      status: 'healthy',
      version: '1.2.3',
    });
  });

  it('reports host capabilities without probing Devin authentication', async () => {
    const deps = healthyDevinProbe();

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      cli: 'devin',
      executable: 'devin',
      status: 'healthy',
      version: '1.1.0',
      detail: 'Devin host runner is ready',
    });
    expect(deps.execFile.mock.calls.map((call) => call[1])).toEqual([
      ['--version'],
      ['--help'],
    ]);
    for (const call of deps.execFile.mock.calls) {
      expect(call[2]).toEqual({
        env: buildDevinChildEnvironment(deps.env),
        timeout: 10_000,
      });
      expect(call[1]).not.toEqual(
        expect.arrayContaining(['-p', '--prompt-file', '--model']),
      );
    }
    expect(deps.commandAvailable).toHaveBeenCalledWith('/usr/bin/bwrap');
    expect(deps.resolveExecutable).toHaveBeenCalledWith('devin', [
      '/opt/devin/bin',
    ]);
    expect(getVerifiedDevinRuntimeContext()).toEqual({
      executable: '/opt/devin/bin/devin',
      nodeExecutable: '/usr/local/bin/node',
      sandboxExecutable: '/usr/bin/bwrap',
      trustedRuntimeReadRoots: ['/opt/devin', '/usr/local', '/usr/bin'],
      trustedRuntimeReadFiles: [],
    });
  });

  it('records only canonical optional system files for the host sandbox', async () => {
    const deps = healthyDevinProbe({
      trustedRuntimeReadFileCandidates: ['/etc/resolv.conf'],
    });

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'healthy',
    });
    expect(getVerifiedDevinRuntimeContext()).toMatchObject({
      trustedRuntimeReadFiles: ['/etc/resolv.conf'],
    });
  });

  it('skips symlinked optional system files without failing readiness', async () => {
    const deps = healthyDevinProbe({
      trustedRuntimeReadFileCandidates: ['/etc/resolv.conf'],
    });
    deps.realpath.mockImplementation(async (value: string) =>
      value === '/etc/resolv.conf'
        ? '/run/systemd/resolve/stub-resolv.conf'
        : value,
    );

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'healthy',
    });
    expect(getVerifiedDevinRuntimeContext()).toMatchObject({
      trustedRuntimeReadFiles: [],
    });
  });

  it('fails closed before probing when DEVIN_CREDENTIAL_PATH is not configured', async () => {
    const deps = healthyDevinProbe({ credentialPath: null });

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'error',
      detail:
        'Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user',
    });
    expect(deps.realpath).not.toHaveBeenCalled();
    expect(deps.lstat).not.toHaveBeenCalled();
    expect(deps.stat).not.toHaveBeenCalled();
    expect(deps.commandAvailable).not.toHaveBeenCalled();
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('does not read or retain Devin authentication output', async () => {
    const deps = healthyDevinProbe({
      execFile: vi.fn(async (_executable: string, args: readonly string[]) => {
        if (args[0] === '--version')
          return { stdout: 'devin 1.1.0', stderr: '' };
        if (args[0] === '--help') return { stdout: DEVIN_HELP, stderr: '' };
        throw Object.assign(
          new Error('Jane Person person@example.test user-123 team-456'),
          {
            stdout: 'Jane Person person@example.test user-123',
            stderr: 'team-456',
          },
        );
      }),
    });

    const health = await probeDevinRuntime(deps);

    expect(health).toMatchObject({
      status: 'healthy',
      detail: 'Devin host runner is ready',
    });
    expect(JSON.stringify(health)).not.toMatch(
      /Jane|person@example|user-123|team-456/,
    );
  });

  it.each([0o644, 0o640, 0o660, 0o666, 0o400])(
    'rejects credential mode %o',
    async (mode) => {
      const deps = healthyDevinProbe({
        stat: vi.fn(async () => fakeStats({ mode: 0o100000 | mode })),
      });

      await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
        status: 'error',
      });
      expect(deps.execFile).not.toHaveBeenCalled();
    },
  );

  it('rejects a credential owned by another uid', async () => {
    const deps = healthyDevinProbe({
      stat: vi.fn(async () => fakeStats({ uid: 2000 })),
    });

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'error',
    });
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('rejects a symlink or non-regular credential', async () => {
    for (const override of [
      { lstat: vi.fn(async () => fakeStats({ symlink: true })) },
      { stat: vi.fn(async () => fakeStats({ regular: false })) },
    ]) {
      const deps = healthyDevinProbe(override);
      await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
        status: 'error',
      });
      expect(deps.execFile).not.toHaveBeenCalled();
    }
  });

  it('rejects a credential swapped between metadata checks', async () => {
    const lstat = vi
      .fn()
      .mockResolvedValueOnce(fakeStats({ dev: 10, ino: 20 }))
      .mockResolvedValueOnce(fakeStats({ dev: 10, ino: 21 }));
    const deps = healthyDevinProbe({ lstat });

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'error',
    });
    expect(lstat).toHaveBeenCalledTimes(2);
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it('rejects a CLI missing prompt model config print or sandbox capability', async () => {
    for (const capability of [
      '--prompt-file',
      '--model',
      '--agent-config',
      '-p',
      '--sandbox',
    ]) {
      const deps = healthyDevinProbe({
        execFile: vi.fn(
          async (_executable: string, args: readonly string[]) => ({
            stdout:
              args[0] === '--version'
                ? 'devin 1.1.0'
                : DEVIN_HELP.replace(`  ${capability}`, '  --missing'),
            stderr: '',
          }),
        ),
      });

      await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
        status: 'error',
      });
    }
  });

  it('rejects missing /usr/bin/bwrap or /usr/bin/sandbox-exec support', async () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const deps = healthyDevinProbe({
        platform,
        commandAvailable: vi.fn(async () => false),
      });
      await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
        status: 'error',
      });
      expect(deps.commandAvailable).toHaveBeenCalledWith(
        platform === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec',
      );
    }
  });

  it('accepts only configured aliases advertised by non-network help', async () => {
    const healthy = healthyDevinProbe();
    await expect(probeDevinRuntime(healthy)).resolves.toMatchObject({
      status: 'healthy',
    });
    expect(getVerifiedDevinAliases()).toEqual(
      new Set(['claude-sonnet-4', 'claude-opus-4.6']),
    );

    const missing = healthyDevinProbe({
      execFile: vi.fn(async (_executable: string, args: readonly string[]) => ({
        stdout:
          args[0] === '--version'
            ? 'devin 1.1.0'
            : DEVIN_HELP.replace('claude-opus-4.6', 'not-configured'),
        stderr: '',
      })),
    });
    await expect(probeDevinRuntime(missing)).resolves.toMatchObject({
      status: 'error',
    });
    expect(getVerifiedDevinAliases()).toEqual(new Set());
    expect(getVerifiedDevinRuntimeContext()).toBeNull();
  });

  it('ignores model aliases advertised outside the --model option block', async () => {
    const misplacedHelp = DEVIN_HELP.replace(
      '--model <model> (examples: claude-sonnet-4, claude-opus-4.6)',
      '--model <model> (examples: claude-sonnet-4)\n  --other <value> (examples: claude-opus-4.6)',
    );
    const deps = healthyDevinProbe({
      execFile: vi.fn(async (_executable: string, args: readonly string[]) => ({
        stdout: args[0] === '--version' ? 'devin 1.1.0' : misplacedHelp,
        stderr: '',
      })),
    });

    await expect(probeDevinRuntime(deps)).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('stores no auth stdout stderr name email user id team id or credential value', async () => {
    const credentialValue = 'credential-secret-value';
    const deps = healthyDevinProbe({
      execFile: vi.fn(async (_executable: string, args: readonly string[]) => ({
        stdout:
          args[0] === '--version'
            ? 'devin 1.1.0'
            : args[0] === '--help'
              ? DEVIN_HELP
              : `Name Jane Email jane@example.test User user-id Team team-id ${credentialValue}`,
        stderr: 'auth diagnostic with personal data',
      })),
    });

    const health = await probeDevinRuntime(deps);
    expect(JSON.stringify(health)).not.toMatch(
      /Jane|jane@example|user-id|team-id|credential-secret|auth diagnostic/,
    );
  });

  it('marks Devin coding supported only when the host probe is healthy', async () => {
    expect(
      listAgentRuntimeDefinitions().find(({ cli }) => cli === 'devin'),
    ).toMatchObject({ codingRunnerSupported: true });

    await expect(
      probeCodingRunnerReadiness('devin', {
        probeHostRuntime: vi.fn().mockResolvedValue({
          cli: 'devin',
          executable: 'devin',
          status: 'healthy',
          version: '1.1.0',
          checkedAt: new Date().toISOString(),
          detail: 'Devin host runner is ready',
        }),
      }),
    ).resolves.toMatchObject({
      status: 'error',
      detail: DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
    });
  });

  it('rejects a healthy host probe when sandbox authentication handoff is unavailable', async () => {
    const hostProbe = vi.fn().mockResolvedValue({
      cli: 'devin',
      executable: 'devin',
      status: 'healthy',
      version: '1.1.0',
      checkedAt: new Date().toISOString(),
      detail: 'Devin host runner is ready',
    });

    await expect(
      probeCodingRunnerReadiness('devin', {
        probeHostRuntime: hostProbe,
      }),
    ).resolves.toMatchObject({
      cli: 'devin',
      status: 'error',
      detail: DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
    });
    expect(hostProbe).not.toHaveBeenCalled();
  });

  it('reports error status for non-ENOENT failures', async () => {
    const execFile = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      );

    const result = await probeAgentRuntime('claude', { execFile });

    expect(result).toMatchObject({
      cli: 'claude',
      status: 'error',
    });
    expect(result.detail).toMatch(/permission denied/i);
  });
});
