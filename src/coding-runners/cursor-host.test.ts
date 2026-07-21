import { describe, expect, it, vi } from 'vitest';

import { createCursorHostRunner } from './cursor-host.js';
import { createProcessRegistry } from './process-registry.js';

const input = {
  jobId: 'job-1',
  attemptId: 'attempt-1',
  cli: 'cursor' as const,
  model: 'gpt-5',
  stageKind: 'implement' as const,
  workspace: '/jobs/job-1/repo',
  promptFile: '/jobs/job-1/.nanocrab/prompt.txt',
  timeoutMs: 10_000,
  onOutput: vi.fn(),
};

describe('Cursor host runner', () => {
  it('fails closed before reading or spawning when isolation is not verified', async () => {
    const spawn = vi.fn();
    const runner = createCursorHostRunner({
      spawn,
      registry: createProcessRegistry(),
      timers: { setTimeout: vi.fn(), clearTimeout: vi.fn() },
      environmentSource: { CURSOR_API_KEY: 'cursor-secret' },
      authAvailable: () => true,
      isolationAvailable: () => false,
      realpath: vi.fn(),
      readFile: vi.fn(),
      sandboxExecutable: '/usr/bin/sandbox-exec',
      platform: 'darwin',
    });

    await expect(runner.run(input)).resolves.toMatchObject({
      state: 'failed',
      detail: expect.stringContaining('isolation'),
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fails closed without a Cursor credential', async () => {
    const spawn = vi.fn();
    const runner = createCursorHostRunner({
      spawn,
      registry: createProcessRegistry(),
      timers: { setTimeout: vi.fn(), clearTimeout: vi.fn() },
      environmentSource: {},
      authAvailable: () => false,
      isolationAvailable: () => true,
      realpath: vi.fn(),
      readFile: vi.fn(),
      sandboxExecutable: '/usr/bin/sandbox-exec',
      platform: 'darwin',
    });

    await expect(runner.run(input)).resolves.toMatchObject({
      state: 'failed',
      detail: expect.stringContaining('CURSOR_API_KEY'),
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});
