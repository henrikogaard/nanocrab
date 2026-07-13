import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_PROVIDER_DEFINITIONS as _AGENT_PROVIDER_DEFINITIONS,
  CODING_PROVIDER_IDS,
  DEFAULT_AGENT_MODELS,
  AGENT_PROVIDER_MODELS,
  isCodingCapableProvider,
  isAgentProvider,
  getAgentProviderDefinition,
  getProviderAvailability,
} from './agent-provider.js';
import {
  getAgentRuntimeDefinition,
  listAgentRuntimeDefinitions,
} from './agent-runtime-registry.js';
import {
  buildMistralVibeInvocation,
  buildMistralVibeShellCommand,
  probeMistralVibe,
  runMistralVibe,
  type CodingRunnerProcess,
} from './mistral-vibe-adapter.js';

describe('coding-runner adapters', () => {
  describe('pi adapter', () => {
    it('is registered as an agent provider', () => {
      expect(isAgentProvider('pi')).toBe(true);
    });

    it('has a provider definition', () => {
      const def = getAgentProviderDefinition('pi');
      expect(def).toBeDefined();
      expect(def.id).toBe('pi');
      expect(def.requiresCli).toBe('pi');
      expect(def.selectable).toBe(true);
    });

    it('has default model and model list', () => {
      expect(DEFAULT_AGENT_MODELS.pi).toBeDefined();
      expect(AGENT_PROVIDER_MODELS.pi.length).toBeGreaterThan(0);
    });

    it('is coding-capable', () => {
      expect(isCodingCapableProvider('pi')).toBe(true);
    });

    it('is in CODING_PROVIDER_IDS', () => {
      expect(CODING_PROVIDER_IDS.has('pi')).toBe(true);
    });

    it('has codingRunnerSupported in runtime registry', () => {
      const def = getAgentRuntimeDefinition('pi');
      expect(def).toBeDefined();
      expect(def?.codingRunnerSupported).toBe(true);
      expect(def?.executable).toBe('pi');
    });

    it('uses container-image and OpenRouter readiness for admin availability', () => {
      const availabilityWith = getProviderAvailability as unknown as (options: {
        commandAvailable: () => boolean;
        codingRunnerInfrastructure: {
          runtimeBin: string;
          image: string;
        };
        inspectContainerImage: (runtimeBin: string, image: string) => boolean;
        credentialAvailable: (key: string) => boolean;
      }) => ReturnType<typeof getProviderAvailability>;
      const inspectContainerImage = vi.fn().mockReturnValue(true);
      const base = {
        commandAvailable: () => false,
        codingRunnerInfrastructure: {
          runtimeBin: 'podman',
          image: 'registry.example/nanocrab-agent:test',
        },
        inspectContainerImage,
      };

      expect(
        availabilityWith({
          ...base,
          credentialAvailable: (key) => key === 'OPENROUTER_API_KEY',
        }).pi,
      ).toBe(true);
      expect(inspectContainerImage).toHaveBeenCalledWith(
        'podman',
        'registry.example/nanocrab-agent:test',
      );
      expect(
        availabilityWith({
          ...base,
          credentialAvailable: () => false,
        }).pi,
      ).toBe(false);
    });
  });

  describe('mistral vibe adapter', () => {
    it('is registered as an agent provider', () => {
      expect(isAgentProvider('mistral')).toBe(true);
    });

    it('is coding-capable', () => {
      expect(isCodingCapableProvider('mistral')).toBe(true);
    });

    it('is in CODING_PROVIDER_IDS', () => {
      expect(CODING_PROVIDER_IDS.has('mistral')).toBe(true);
    });

    it('has codingRunnerSupported in runtime registry', () => {
      const def = getAgentRuntimeDefinition('mistral');
      expect(def).toBeDefined();
      expect(def?.codingRunnerSupported).toBe(true);
      expect(def?.executable).toBe('vibe');
    });

    it('constructs the official non-interactive Vibe invocation', () => {
      expect(
        buildMistralVibeInvocation({
          prompt: 'Fix the issue',
          cwd: '/tmp/worktree',
          maxTurns: 12,
          maxPrice: 3.5,
        }),
      ).toEqual({
        runtime: 'mistral',
        command: 'vibe',
        args: [
          '--prompt',
          'Fix the issue',
          '--output',
          'json',
          '--max-turns',
          '12',
          '--max-price',
          '3.5',
        ],
        cwd: '/tmp/worktree',
      });
    });

    it('owns the generated in-container shell command contract', () => {
      expect(
        buildMistralVibeShellCommand({
          prompt: '"$PROMPT"',
          maxTurns: '"$CODING_JOB_MAX_TURNS"',
          maxPrice: '"$CODING_JOB_MAX_BUDGET_USD"',
        }),
      ).toBe(
        'vibe --prompt "$PROMPT" --output json --max-turns "$CODING_JOB_MAX_TURNS" --max-price "$CODING_JOB_MAX_BUDGET_USD"',
      );
    });

    it('runs with injected execution and normalizes JSON success', async () => {
      const runner = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '{"result":"done"}',
        stderr: '',
      } satisfies CodingRunnerProcess);

      const result = await runMistralVibe(
        { prompt: 'Fix it', cwd: '/tmp/worktree', maxTurns: 8, maxPrice: 2 },
        { runner },
      );

      expect(runner).toHaveBeenCalledWith(
        'vibe',
        [
          '--prompt',
          'Fix it',
          '--output',
          'json',
          '--max-turns',
          '8',
          '--max-price',
          '2',
        ],
        expect.objectContaining({ cwd: '/tmp/worktree' }),
      );
      expect(result).toMatchObject({
        status: 'succeeded',
        output: { result: 'done' },
        exitCode: 0,
      });
    });

    it('normalizes stderr and non-zero exits', async () => {
      const runner = vi.fn().mockResolvedValue({
        exitCode: 2,
        stdout: '',
        stderr: 'budget exceeded',
      } satisfies CodingRunnerProcess);

      await expect(
        runMistralVibe({ prompt: 'Fix it', cwd: '/tmp/worktree' }, { runner }),
      ).resolves.toMatchObject({
        status: 'failed',
        error: 'budget exceeded',
        exitCode: 2,
      });
    });

    it('fails closed when Vibe exits zero with non-empty stderr', async () => {
      const runner = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '{"result":"possibly incomplete"}',
        stderr: 'tool execution warning',
      } satisfies CodingRunnerProcess);

      await expect(
        runMistralVibe({ prompt: 'Fix it', cwd: '/tmp/worktree' }, { runner }),
      ).resolves.toMatchObject({
        status: 'failed',
        error: 'tool execution warning',
        exitCode: 0,
      });
    });

    it('normalizes cancellation without invoking an aborted runner', async () => {
      const controller = new AbortController();
      controller.abort();
      const runner = vi.fn();

      await expect(
        runMistralVibe(
          { prompt: 'Fix it', cwd: '/tmp/worktree', signal: controller.signal },
          { runner },
        ),
      ).resolves.toMatchObject({ status: 'cancelled', exitCode: null });
      expect(runner).not.toHaveBeenCalled();
    });

    it('probes Vibe health through injected execution', async () => {
      const runner = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'vibe 0.9.1\n',
        stderr: '',
      } satisfies CodingRunnerProcess);

      await expect(probeMistralVibe({ runner })).resolves.toMatchObject({
        runtime: 'mistral',
        status: 'healthy',
        version: '0.9.1',
      });
      expect(runner).toHaveBeenCalledWith(
        'vibe',
        ['--version'],
        expect.any(Object),
      );
    });
  });

  describe('runtime registry completeness', () => {
    it('all coding providers have runtime definitions', () => {
      const runtimes = listAgentRuntimeDefinitions();
      const supported = runtimes.filter((r) => r.codingRunnerSupported);
      const supportedClis = supported.map((r) => r.cli);
      expect(supportedClis).toContain('claude');
      expect(supportedClis).toContain('codex');
      expect(supportedClis).toContain('opencode');
      expect(supportedClis).toContain('pi');
      expect(supportedClis).toContain('mistral');
      expect(supportedClis).not.toContain('devin');
    });
  });
});
