import fs from 'node:fs';
import path from 'node:path';

import {
  buildCursorChildEnvironment,
  buildCursorCliInvocation,
  buildCursorSandboxedLaunch,
  resolveCursorExecutable,
  validateCursorWorkspace,
} from './cursor-cli.js';
import type {
  CodingProcessSpawner,
  CodingRunnerAdapter,
  CodingRunnerResult,
  CodingTimerTransport,
} from './types.js';
import type { ProcessLease, ProcessRegistry } from './process-registry.js';

const MAX_OUTPUT = 1_048_576;

export interface CursorHostRunnerDependencies {
  spawn: CodingProcessSpawner;
  registry: ProcessRegistry;
  timers: CodingTimerTransport;
  environmentSource: NodeJS.ProcessEnv;
  authAvailable: () => boolean;
  isolationAvailable: () => boolean;
  realpath(value: string): Promise<string>;
  readFile(value: string): Promise<string>;
  executable?: string;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  platform: NodeJS.Platform;
  buildSandboxedLaunch?: typeof buildCursorSandboxedLaunch;
  resolveExecutable?: () => string;
}

const productionFilesystem = {
  realpath: (value: string) => fs.promises.realpath(value),
  readFile: (value: string) => fs.promises.readFile(value, 'utf8'),
};

export function createProductionCursorHostRunner(
  dependencies: Omit<CursorHostRunnerDependencies, 'realpath' | 'readFile'>,
): CodingRunnerAdapter {
  return createCursorHostRunner({
    ...dependencies,
    ...productionFilesystem,
    buildSandboxedLaunch: buildCursorSandboxedLaunch,
  });
}

function failed(attemptId: string, detail: string): CodingRunnerResult {
  return { attemptId, state: 'failed', exitCode: null, signal: null, detail };
}

function isAtOrBelow(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function trimOutput(value: string): string {
  return value.length > MAX_OUTPUT ? value.slice(-MAX_OUTPUT) : value;
}

export function createCursorHostRunner(
  deps: CursorHostRunnerDependencies,
): CodingRunnerAdapter {
  const active = new Map<string, ProcessLease>();
  return {
    async run(input): Promise<CodingRunnerResult> {
      if (!deps.authAvailable()) {
        return failed(input.attemptId, 'CURSOR_API_KEY is not configured');
      }
      if (!deps.isolationAvailable()) {
        return failed(
          input.attemptId,
          'Cursor host isolation adapter is not verified',
        );
      }

      let workspace: string;
      let promptFile: string;
      try {
        validateCursorWorkspace(input.workspace);
        workspace = await deps.realpath(input.workspace);
        promptFile = await deps.realpath(input.promptFile);
        if (workspace !== input.workspace) {
          return failed(input.attemptId, 'Cursor workspace is not canonical');
        }
        const metadataDir = path.dirname(promptFile);
        const jobRoot = path.dirname(metadataDir);
        if (
          path.basename(metadataDir) !== '.nanocrab' ||
          path.basename(promptFile) !== 'prompt.txt' ||
          path.dirname(workspace) !== jobRoot ||
          isAtOrBelow(metadataDir, workspace) ||
          isAtOrBelow(workspace, metadataDir)
        ) {
          return failed(input.attemptId, 'Cursor workspace layout is invalid');
        }
      } catch {
        return failed(input.attemptId, 'Cursor workspace layout is invalid');
      }

      let prompt: string;
      try {
        prompt = await deps.readFile(promptFile);
      } catch {
        return failed(input.attemptId, 'Cursor prompt file is unavailable');
      }

      let environment: NodeJS.ProcessEnv;
      try {
        environment = buildCursorChildEnvironment(deps.environmentSource);
      } catch (error) {
        return failed(
          input.attemptId,
          error instanceof Error ? error.message : String(error),
        );
      }
      let executable: string;
      try {
        const selectedExecutable =
          deps.resolveExecutable?.() ||
          deps.executable ||
          resolveCursorExecutable();
        executable = await deps.realpath(selectedExecutable);
        if (
          !path.isAbsolute(executable) ||
          executable === path.parse(executable).root
        ) {
          return failed(input.attemptId, 'Cursor executable is not canonical');
        }
      } catch {
        return failed(input.attemptId, 'Cursor executable is unavailable');
      }
      const invocation = buildCursorCliInvocation({
        executable,
        model: input.model,
        prompt,
        workspace,
      });
      let launch: { executable: string; args: string[] };
      try {
        launch = (deps.buildSandboxedLaunch || buildCursorSandboxedLaunch)({
          platform: deps.platform,
          sandboxExecutable: deps.sandboxExecutable,
          workspace,
          executable: invocation.executable,
          args: invocation.args,
          temporaryDirectory: deps.environmentSource.TMPDIR || '/tmp',
        });
      } catch (error) {
        return failed(
          input.attemptId,
          `Cursor sandbox launch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let child: ReturnType<CodingProcessSpawner>;
      try {
        child = deps.spawn(launch.executable, launch.args, {
          cwd: workspace,
          env: environment,
          shell: false,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        return failed(
          input.attemptId,
          `Cursor launch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const lease = deps.registry.register({
        jobId: input.jobId,
        attemptId: input.attemptId,
        process: child,
      });
      active.set(input.jobId, lease);
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timeoutHandle: unknown;

      const finish = (result: CodingRunnerResult): void => {
        if (settled) return;
        settled = true;
        if (timeoutHandle !== undefined)
          deps.timers.clearTimeout(timeoutHandle);
        active.delete(input.jobId);
        deps.registry.compareAndDelete(lease);
        void result;
      };

      return await new Promise((resolve) => {
        const settle = (result: CodingRunnerResult): void => {
          if (settled) return;
          finish(result);
          resolve(result);
        };
        child.stdout?.on('data', (chunk: Buffer | string) => {
          const text = chunk.toString();
          stdout = trimOutput(`${stdout}${text}`);
          input.onOutput({ stream: 'stdout', text });
        });
        child.stderr?.on('data', (chunk: Buffer | string) => {
          const text = chunk.toString();
          stderr = trimOutput(`${stderr}${text}`);
          input.onOutput({ stream: 'stderr', text });
        });
        child.once('error', (error) => {
          settle(
            failed(input.attemptId, `Cursor process error: ${error.message}`),
          );
        });
        child.once('close', (code, signal) => {
          settle({
            attemptId: input.attemptId,
            state: code === 0 ? 'succeeded' : 'failed',
            exitCode: code,
            signal,
            ...(code === 0
              ? {}
              : {
                  detail:
                    (stderr || stdout).trim().slice(-8000) ||
                    'Cursor process failed',
                }),
          });
        });
        timeoutHandle = deps.timers.setTimeout(() => {
          if (!deps.registry.terminate(lease, 'timed_out')) return;
          settle({
            attemptId: input.attemptId,
            state: 'timed_out',
            exitCode: null,
            signal: 'SIGTERM',
            detail: 'Cursor process timed out',
          });
        }, input.timeoutMs);
      });
    },
    cancel(jobId, attemptId) {
      const lease = active.get(jobId);
      if (!lease || lease.attemptId !== attemptId) return false;
      return deps.registry.terminate(lease, 'cancelled');
    },
  };
}
