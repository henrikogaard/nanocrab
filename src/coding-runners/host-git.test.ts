import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type ChildProcess } from 'node:child_process';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import {
  createHostGitRunner,
  HostGitCancelledError,
  HostGitTimeoutError,
  type HostGitRunnerDependencies,
} from './host-git.js';
import { createProcessRegistry } from './process-registry.js';
import { openStableDirectory } from './stable-directory.js';

interface FakeChild extends EventEmitter {
  kill: Mock<(signal: string) => boolean>;
  stdin: { end: Mock<() => void> };
  callback: (error: unknown, stdout: string, stderr: string) => void;
}

function createFakeExecFile() {
  const children: FakeChild[] = [];
  const execFile = vi.fn(
    (
      _command: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: unknown, stdout: string, stderr: string) => void,
    ): ChildProcess => {
      const child = new EventEmitter() as FakeChild;
      child.callback = callback;
      child.kill = vi.fn((signal: string) => {
        callback(
          Object.assign(new Error('killed'), {
            killed: true,
            code: null,
            signal,
          }),
          '',
          '',
        );
        child.emit('close', null, signal);
        return true;
      });
      child.stdin = { end: vi.fn() };
      children.push(child);
      return child as unknown as ChildProcess;
    },
  );
  return {
    execFile: execFile as unknown as HostGitRunnerDependencies['execFile'],
    children,
  };
}

function expectStablePathForDirectory(
  stablePath: string | undefined,
  directory: string,
): void {
  expect(stablePath).toEqual(expect.any(String));
  expect(stablePath).not.toBe(directory);
  const stableStat = fs.statSync(stablePath!, { bigint: true });
  const directoryStat = fs.statSync(directory, { bigint: true });
  expect(stableStat.dev).toBe(directoryStat.dev);
  expect(stableStat.ino).toBe(directoryStat.ino);
}

describe('createHostGitRunner', () => {
  let tmp: string;
  let registry: ReturnType<typeof createProcessRegistry>;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'host-git-test-'));
    registry = createProcessRegistry();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('opens cwd through a stable descriptor and runs git', async () => {
    const { execFile, children } = createFakeExecFile();
    const run = createHostGitRunner({
      execFile,
      openStableDirectory,
      registry,
    });

    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace);

    const resultPromise = run(['status'], {
      cwd: workspace,
      env: {},
      timeoutMs: 60_000,
      jobId: 'job-1',
      attemptId: 'attempt-1',
    });

    await vi.waitFor(() => expect(children).toHaveLength(1));
    const execOptions = vi.mocked(execFile).mock.calls[0]![2];
    expectStablePathForDirectory(execOptions.cwd, workspace);
    expect(execOptions).toEqual(
      expect.objectContaining({
        env: {},
        detached: true,
        encoding: 'utf8',
      }),
    );
    const [child] = children;
    child.callback(null, 'ok', '');

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(vi.mocked(execFile).mock.calls[0]![0]).toBe('git');
    expect(vi.mocked(execFile).mock.calls[0]![1]).toEqual(['status']);
  });

  it('closes the stable directory once when execFile throws synchronously', async () => {
    const close = vi.fn(async () => undefined);
    const stableStat = fs.statSync(tmp);
    const openStableDirectory = vi.fn(async () => ({
      fd: 7,
      path: '/stable/workspace',
      stat: async () => stableStat,
      close,
    }));
    const execFile = vi.fn(() => {
      throw new Error('spawn failed');
    });
    const run = createHostGitRunner({
      execFile: execFile as unknown as HostGitRunnerDependencies['execFile'],
      openStableDirectory:
        openStableDirectory as unknown as HostGitRunnerDependencies['openStableDirectory'],
      registry,
    });

    await expect(
      run(['status'], {
        cwd: path.join(tmp, 'workspace'),
        env: {},
        timeoutMs: 60_000,
      }),
    ).rejects.toThrow('spawn failed');

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('points GIT_WORK_TREE at the stable descriptor', async () => {
    const { execFile, children } = createFakeExecFile();
    const run = createHostGitRunner({
      execFile,
      openStableDirectory,
      registry,
    });

    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace);

    const resultPromise = run(['status'], {
      cwd: workspace,
      env: { GIT_WORK_TREE: workspace, KEEP_ME: 'yes' },
      timeoutMs: 60_000,
      jobId: 'job-1',
      attemptId: 'attempt-1',
    });

    await vi.waitFor(() => expect(children).toHaveLength(1));
    const execOptions = vi.mocked(execFile).mock.calls[0]![2];
    expectStablePathForDirectory(execOptions.cwd, workspace);
    expect(execOptions.env?.GIT_WORK_TREE).toBe(execOptions.cwd);
    expect(execOptions.env?.KEEP_ME).toBe('yes');
    children[0].callback(null, 'ok', '');
    await resultPromise;
  });

  it('registers the child in the attempt-aware registry', async () => {
    const { execFile, children } = createFakeExecFile();
    const run = createHostGitRunner({
      execFile,
      openStableDirectory,
      registry,
    });

    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace);

    run(['status'], {
      cwd: workspace,
      env: {},
      timeoutMs: 60_000,
      jobId: 'job-1',
      attemptId: 'attempt-1',
    });

    await vi.waitFor(() => expect(children).toHaveLength(1));
    expect(registry.get('job-1', 'attempt-1')).not.toBeNull();
    children[0].callback(null, 'ok', '');
  });

  it('times out and escalates through the registry', async () => {
    vi.useFakeTimers();
    const { execFile, children } = createFakeExecFile();
    const run = createHostGitRunner({
      execFile,
      openStableDirectory,
      registry,
      timers: { setTimeout, clearTimeout },
    });

    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace);

    const resultPromise = run(['push'], {
      cwd: workspace,
      env: {},
      timeoutMs: 5_000,
      jobId: 'job-1',
      attemptId: 'attempt-1',
    });

    await vi.waitFor(() => expect(children).toHaveLength(1));
    vi.advanceTimersByTime(5_000);

    await expect(resultPromise).rejects.toThrow(HostGitTimeoutError);
    expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('can be cancelled via the registry and reports cancellation', async () => {
    const { execFile, children } = createFakeExecFile();
    const run = createHostGitRunner({
      execFile,
      openStableDirectory,
      registry,
    });

    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace);

    const resultPromise = run(['push'], {
      cwd: workspace,
      env: {},
      timeoutMs: 60_000,
      jobId: 'job-1',
      attemptId: 'attempt-1',
    });

    await vi.waitFor(() => expect(children).toHaveLength(1));
    const lease = registry.get('job-1', 'attempt-1');
    expect(lease).not.toBeNull();
    registry.terminate(lease!, 'cancelled');

    await expect(resultPromise).rejects.toThrow(HostGitCancelledError);
  });
});
