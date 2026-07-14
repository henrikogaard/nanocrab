import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingTimerTransport, SpawnedCodingProcess } from './types.js';
import { createProcessRegistry } from './process-registry.js';

function createProcess(pid: number): SpawnedCodingProcess {
  const process = new EventEmitter() as EventEmitter & SpawnedCodingProcess;
  process.pid = pid;
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kill = vi.fn(() => true);
  return process;
}

describe('process lease registry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('compares job, attempt, and token before deleting a lease', () => {
    const registry = createProcessRegistry({ randomToken: () => 'lease-a' });
    const process = createProcess(101);
    const lease = registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process,
    });
    expect(registry.compareAndDelete({ ...lease, leaseToken: 'wrong' })).toBe(
      false,
    );
    expect(registry.owns(lease)).toBe(true);
    expect(registry.compareAndDelete(lease)).toBe(true);
  });

  it('does not let a stale close delete a newer retry lease', () => {
    const registry = createProcessRegistry({
      randomToken: vi
        .fn()
        .mockReturnValueOnce('old')
        .mockReturnValueOnce('new'),
    });
    const oldProcess = createProcess(101);
    const newProcess = createProcess(202);
    const oldLease = registry.register({
      jobId: 'job',
      attemptId: 'old',
      process: oldProcess,
    });
    registry.compareAndDelete(oldLease);
    const newLease = registry.register({
      jobId: 'job',
      attemptId: 'new',
      process: newProcess,
    });
    expect(registry.compareAndDelete(oldLease)).toBe(false);
    expect(registry.owns(newLease)).toBe(true);
  });

  it('rejects a second live lease for the same job attempt', () => {
    const registry = createProcessRegistry({ randomToken: () => 'lease-a' });
    registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process: createProcess(101),
    });

    expect(() =>
      registry.register({
        jobId: 'job',
        attemptId: 'attempt-a',
        process: createProcess(202),
      }),
    ).toThrow(/already registered/i);
  });

  it('signals only the exact attempt with TERM then KILL', () => {
    const signalGroup = vi.fn();
    const timers: CodingTimerTransport = {
      setTimeout: vi.fn((callback, delayMs) => setTimeout(callback, delayMs)),
      clearTimeout: vi.fn((handle) => clearTimeout(handle as NodeJS.Timeout)),
    };
    const registry = createProcessRegistry({
      randomToken: vi
        .fn()
        .mockReturnValueOnce('old')
        .mockReturnValueOnce('new'),
      signalGroup,
      timers,
    });
    const oldProcess = createProcess(101);
    const newProcess = createProcess(202);
    const oldLease = registry.register({
      jobId: 'job',
      attemptId: 'old',
      process: oldProcess,
    });
    const newLease = registry.register({
      jobId: 'job',
      attemptId: 'new',
      process: newProcess,
    });

    expect(registry.terminate(oldLease, 'cancelled')).toBe(true);
    expect(signalGroup).toHaveBeenCalledWith(-oldProcess.pid!, 'SIGTERM');
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(registry.owns(oldLease)).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(signalGroup).toHaveBeenCalledWith(-oldProcess.pid!, 'SIGKILL');
    expect(registry.owns(newLease)).toBe(true);
    expect(registry.owns(oldLease)).toBe(false);
  });

  it('rejects repeated termination and never signals a mismatched attempt', () => {
    const signalGroup = vi.fn();
    const registry = createProcessRegistry({
      randomToken: () => 'lease-a',
      signalGroup,
    });
    const process = createProcess(101);
    const lease = registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process,
    });

    expect(
      registry.terminate({ ...lease, attemptId: 'attempt-b' }, 'cancelled'),
    ).toBe(false);
    expect(signalGroup).not.toHaveBeenCalled();
    expect(registry.terminate(lease, 'timed_out')).toBe(true);
    expect(registry.terminate(lease, 'cancelled')).toBe(false);
    expect(signalGroup).toHaveBeenCalledTimes(1);
  });

  it('leaves terminal listener ownership to the process adapter', () => {
    const registry = createProcessRegistry({ randomToken: () => 'lease-a' });
    const process = createProcess(101);
    const onceSpy = vi.spyOn(process, 'once');
    const lease = registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process,
    });

    expect(onceSpy).not.toHaveBeenCalled();
    expect(registry.get('job', 'attempt-a')).toEqual(lease);
    expect(registry.compareAndDelete(lease)).toBe(true);
  });

  it('clears escalation when the owner handles a terminal event', () => {
    const signalGroup = vi.fn();
    const registry = createProcessRegistry({
      randomToken: () => 'lease-a',
      signalGroup,
    });
    const lease = registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process: createProcess(101),
    });

    expect(registry.terminate(lease, 'cancelled')).toBe(true);
    expect(registry.compareAndDelete(lease)).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(signalGroup).toHaveBeenCalledTimes(1);
  });

  it('uses only the captured process kill method when no pid is available', () => {
    const signalGroup = vi.fn();
    const registry = createProcessRegistry({
      randomToken: () => 'lease-a',
      signalGroup,
    });
    const process = createProcess(101);
    process.pid = undefined;
    const lease = registry.register({
      jobId: 'job',
      attemptId: 'attempt-a',
      process,
    });

    expect(registry.terminate(lease, 'cancelled')).toBe(true);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(signalGroup).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    expect(signalGroup).not.toHaveBeenCalled();
  });
});
