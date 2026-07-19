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
    const [child] = children;
    child.callback(null, 'ok', '');

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['status'],
      expect.objectContaining({
        cwd: expect.stringMatching(/^\/(?:proc\/self|dev)\/fd\/\d+$/),
        env: {},
        detached: true,
        encoding: 'utf8',
      }),
      expect.any(Function),
    );
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
    children[0].callback(null, 'ok', '');
    await resultPromise;

    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['status'],
      expect.objectContaining({
        cwd: expect.stringMatching(/^\/(?:proc\/self|dev)\/fd\/\d+$/),
        env: expect.objectContaining({
          GIT_WORK_TREE: expect.stringMatching(
            /^\/(?:proc\/self|dev)\/fd\/\d+$/,
          ),
          KEEP_ME: 'yes',
        }),
      }),
      expect.any(Function),
    );
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
