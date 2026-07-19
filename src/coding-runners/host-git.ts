import {
  execFile as defaultExecFile,
  type ChildProcess,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  openStableDirectory as defaultOpenStableDirectory,
  type StableDirectoryHandle,
} from './stable-directory.js';
import {
  codingProcessRegistry,
  type ProcessLease,
  type ProcessRegistry,
} from './process-registry.js';
import type { GitTransport } from '../coding-workspace.js';

export class HostGitTimeoutError extends Error {
  constructor() {
    super('Host Git operation timed out');
  }
}

export class HostGitCancelledError extends Error {
  constructor() {
    super('Host Git operation was cancelled');
  }
}

type ExecFileCallback = (
  error: unknown,
  stdout: string,
  stderr: string,
) => void;

export interface HostGitRunnerDependencies {
  execFile: (
    command: string,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      encoding?: string;
      detached?: boolean;
    },
    callback: ExecFileCallback,
  ) => ChildProcess;
  openStableDirectory: typeof defaultOpenStableDirectory;
  registry: ProcessRegistry;
  timers?: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
}

export function createHostGitRunner(
  deps: HostGitRunnerDependencies,
): GitTransport {
  const {
    execFile,
    openStableDirectory,
    registry,
    timers = { setTimeout, clearTimeout },
  } = deps;

  return async (args, options) => {
    const {
      cwd,
      env,
      timeoutMs,
      stdin,
      jobId,
      attemptId: suppliedAttemptId,
    } = options;
    const attemptId =
      jobId && !suppliedAttemptId ? randomUUID() : suppliedAttemptId;

    let stableHandle: StableDirectoryHandle | undefined;
    let actualCwd = cwd;
    let actualArgs = args;
    let actualEnv = env;

    try {
      if (actualCwd) {
        stableHandle = await openStableDirectory(actualCwd, 'Git cwd');
        actualCwd = stableHandle.path;
        if (env?.GIT_WORK_TREE) {
          actualEnv = { ...env, GIT_WORK_TREE: actualCwd };
        }
      } else if (actualArgs[0] === 'clone') {
        const destination = actualArgs[actualArgs.length - 1];
        if (destination && typeof destination === 'string') {
          const parent = path.dirname(destination);
          const name = path.basename(destination);
          stableHandle = await openStableDirectory(parent, 'Git clone parent');
          actualCwd = stableHandle.path;
          actualArgs = [...actualArgs.slice(0, -1), name];
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Git workspace is not stable: ${message}`, {
        // Filesystem errors may expose paths outside the approved workspace.
        // eslint-disable-next-line preserve-caught-error
        cause: new Error('Git workspace is not stable'),
      });
    }

    return new Promise((resolve, reject) => {
      let timedOut = false;
      let lease: ProcessLease | undefined;
      let timeoutHandle: ReturnType<typeof timers.setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutHandle !== undefined) timers.clearTimeout(timeoutHandle);
        if (stableHandle) {
          stableHandle.close().catch(() => undefined);
          stableHandle = undefined;
        }
      };

      const child = execFile(
        'git',
        [...actualArgs],
        {
          cwd: actualCwd,
          env: actualEnv,
          encoding: 'utf8',
          detached: true,
        },
        (error, stdout, stderr) => {
          if (lease) {
            registry.compareAndDelete(lease);
            lease = undefined;
          }
          cleanup();

          if (error) {
            const execError = error as {
              killed?: boolean;
              code?: string | number | null;
              signal?: NodeJS.Signals;
            };
            if (execError.killed) {
              if (timedOut) {
                reject(new HostGitTimeoutError());
              } else {
                reject(new HostGitCancelledError());
              }
              return;
            }
            if (typeof execError.code === 'number') {
              resolve({
                stdout: String(stdout ?? ''),
                stderr: String(stderr ?? ''),
                exitCode: execError.code,
              });
              return;
            }
            reject(error);
            return;
          }

          resolve({
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
            exitCode: 0,
          });
        },
      );

      if (jobId && attemptId) {
        lease = registry.register({
          jobId,
          attemptId,
          process: child as unknown as Parameters<
            ProcessRegistry['register']
          >[0]['process'],
        });
        timeoutHandle = timers.setTimeout(() => {
          timedOut = true;
          if (lease) registry.terminate(lease, 'timed_out');
          else child.kill('SIGTERM');
        }, timeoutMs);
      } else {
        timeoutHandle = timers.setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          timers.setTimeout(() => child.kill('SIGKILL'), 5_000);
        }, timeoutMs);
      }

      if (stdin !== undefined) child.stdin?.end(stdin);
    });
  };
}

export const runHostGit = createHostGitRunner({
  execFile: defaultExecFile as unknown as HostGitRunnerDependencies['execFile'],
  openStableDirectory: defaultOpenStableDirectory,
  registry: codingProcessRegistry,
});
