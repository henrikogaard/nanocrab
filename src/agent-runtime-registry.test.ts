import { describe, expect, it, vi } from 'vitest';

import {
  listAgentRuntimeDefinitions,
  probeAgentRuntime,
} from './agent-runtime-registry.js';

describe('agent runtime registry', () => {
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

  it('reports devin as unsupported when installed', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'devin 1.1.0\n',
      stderr: '',
    });

    await expect(probeAgentRuntime('devin', { execFile })).resolves.toMatchObject(
      {
        cli: 'devin',
        executable: 'devin',
        status: 'unsupported',
        version: '1.1.0',
      },
    );
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
