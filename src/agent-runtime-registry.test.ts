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

  it('reports missing runtime when executable not found', async () => {
    const execFile = vi.fn().mockRejectedValue(
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

  it('reports healthy mistral runtime using vibe executable', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'vibe 0.9.1\n',
      stderr: '',
    });

    const result = await probeAgentRuntime('mistral', { execFile });

    expect(result).toMatchObject({
      cli: 'mistral',
      executable: 'vibe',
      status: 'healthy',
    });
    expect(result.version).toBe('0.9.1');
    expect(execFile).toHaveBeenCalledWith('vibe', ['--version'], expect.anything());
  });

  it('reports error status for non-ENOENT failures', async () => {
    const execFile = vi.fn().mockRejectedValue(
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
