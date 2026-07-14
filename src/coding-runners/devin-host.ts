import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { VerifiedDevinRuntimeContext } from '../agent-runtime-registry.js';
import type { PipelineStageKind } from '../control-plane/types.js';
import { createStreamingLogRedactor } from '../logger.js';
import type { ProcessLease, ProcessRegistry } from './process-registry.js';
import type {
  CodingProcessSpawner,
  CodingRunnerAdapter,
  CodingRunnerInput,
  CodingRunnerOutputChunk,
  CodingRunnerResult,
  CodingTimerTransport,
} from './types.js';

export type DevinStageKind = PipelineStageKind | 'direct';

export interface DevinAgentConfig {
  system_instructions: string;
  allowed_tools: string[];
  permissions: {
    allow: string[];
    ask: [];
    deny: string[];
  };
}

export function buildDevinAgentConfig(input: {
  stageKind: DevinStageKind;
  workspace: string;
  jobRoot: string;
  brokerPath: string;
  devinCredentialPath: string;
  home: string;
  nanocrabConfigRoot: string;
}): DevinAgentConfig {
  const writable =
    input.stageKind === 'implement' || input.stageKind === 'direct';
  const metadataRoot = path.join(input.jobRoot, '.nanocrab');
  const allow = [`Read(${input.workspace}/**)`, `Exec(${input.brokerPath})`];
  if (writable) allow.push(`Write(${input.workspace}/**)`);

  return {
    system_instructions: writable
      ? 'Modify only repository files required by the approved task. Use the NanoCrab command broker for approved build and test commands. Do not commit, push, or open pull requests.'
      : 'Do not modify repository files. Inspect the repository only through the approved read tools and NanoCrab command broker. Do not commit, push, or open pull requests.',
    allowed_tools: writable
      ? ['read', 'grep', 'glob', 'edit', 'write', 'exec']
      : ['read', 'grep', 'glob', 'exec'],
    permissions: {
      allow,
      ask: [],
      deny: [
        `Read(${metadataRoot}/**)`,
        `Read(${input.devinCredentialPath})`,
        `Read(${path.join(input.home, '.ssh')}/**)`,
        `Read(${path.join(input.home, '.gnupg')}/**)`,
        `Read(${input.nanocrabConfigRoot}/**)`,
        `Write(${metadataRoot}/**)`,
        `Write(${path.join(input.workspace, '.git')})`,
        `Write(${path.join(input.workspace, '.git')}/**)`,
        `Write(${input.devinCredentialPath})`,
        `Write(${path.join(input.home, '.ssh')}/**)`,
        `Write(${path.join(input.home, '.gnupg')}/**)`,
        `Write(${input.nanocrabConfigRoot}/**)`,
      ],
    },
  };
}

const TRUSTED_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
const CHILD_ENV_KEYS = [
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const;

export function buildDevinChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  environment.PATH = TRUSTED_PATH;
  environment.TERM = 'dumb';
  environment.NO_COLOR = '1';
  return environment;
}

interface DevinBrokerLauncherDependencies {
  mkdir(
    path: string,
    options: { recursive: true; mode: number },
  ): Promise<unknown>;
  writeFile(
    path: string,
    data: string,
    options: { encoding: 'utf8'; mode: number; flag: 'wx' },
  ): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<string>;
}

export interface DevinBrokerLauncherInput {
  stageKind: DevinStageKind;
  workspace: string;
  jobRoot: string;
  commandBrokerModulePath: string;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  nodeExecutable: string;
  home: string;
  protectedPaths: readonly string[];
  trustedRuntimeReadRoots: readonly string[];
}

export interface EnsureDevinBrokerLauncherDependencies extends DevinBrokerLauncherDependencies {
  lstat(path: string): Promise<fs.Stats>;
  stat(path: string): Promise<fs.Stats>;
  getuid(): number;
  open(
    path: string,
    flags: number,
    mode?: number,
  ): Promise<ImmutableFileHandle>;
}

export interface EnsureDevinAgentConfigDependencies {
  lstat(path: string): Promise<fs.Stats>;
  getuid(): number;
  open(
    path: string,
    flags: number,
    mode?: number,
  ): Promise<ImmutableFileHandle>;
}

export interface ImmutableFileHandle {
  stat(): Promise<fs.Stats>;
  writeFile(data: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  chmod(mode: number): Promise<void>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

const launcherDependencies: EnsureDevinBrokerLauncherDependencies = {
  mkdir: fs.promises.mkdir,
  writeFile: fs.promises.writeFile,
  chmod: fs.promises.chmod,
  realpath: (value) => fs.promises.realpath(value),
  lstat: (value) => fs.promises.lstat(value),
  stat: (value) => fs.promises.stat(value),
  getuid: () => process.getuid?.() ?? -1,
  open: (value, flags, mode) => fs.promises.open(value, flags, mode),
};

function isAtOrBelow(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function buildDevinCommandBrokerLauncherSource(
  input: DevinBrokerLauncherInput,
  realpath: (path: string) => Promise<string>,
): Promise<string> {
  const moduleUrl = pathToFileURL(input.commandBrokerModulePath).href;
  const canonicalNodeExecutable = await realpath(input.nodeExecutable);
  if (
    canonicalNodeExecutable !== input.nodeExecutable ||
    !path.isAbsolute(canonicalNodeExecutable) ||
    path.normalize(canonicalNodeExecutable) !== canonicalNodeExecutable ||
    /[\0\n\r\t ]/.test(canonicalNodeExecutable) ||
    !input.trustedRuntimeReadRoots.some((runtimeRoot) =>
      isAtOrBelow(canonicalNodeExecutable, runtimeRoot),
    )
  ) {
    throw new Error(
      'Node executable is not canonical or inside a trusted runtime root',
    );
  }
  return `#!${canonicalNodeExecutable}
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { runCommandBrokerCli } from ${JSON.stringify(moduleUrl)};

const execute = (executable, args, options) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { ...options, shell: false, stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (signal) reject(new Error('Broker command terminated by signal'));
    else resolve(code ?? 1);
  });
});

const exitCode = await runCommandBrokerCli({
  stageKind: ${JSON.stringify(input.stageKind)},
  workspace: ${JSON.stringify(input.workspace)},
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  home: ${JSON.stringify(input.home)},
  protectedPaths: ${JSON.stringify(input.protectedPaths)},
  trustedRuntimeReadRoots: ${JSON.stringify(input.trustedRuntimeReadRoots)},
}, {
  platform: process.platform,
  execute,
  readFile: (file) => readFile(file, 'utf8'),
  realpath,
  environmentSource: process.env,
  sandboxExecutable: ${JSON.stringify(input.sandboxExecutable)},
});
process.exitCode = exitCode;
`;
}

export async function writeDevinCommandBrokerLauncher(
  input: DevinBrokerLauncherInput,
  dependencies: EnsureDevinBrokerLauncherDependencies = launcherDependencies,
): Promise<string> {
  return ensureDevinCommandBrokerLauncher(input, dependencies);
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function exactMode(stats: fs.Stats): number {
  return stats.mode & 0o777;
}

async function validateImmutableDirectory(
  directory: string,
  mode: number,
  dependencies: EnsureDevinBrokerLauncherDependencies,
): Promise<void> {
  // Node does not expose descriptor-relative openat(2). A same-UID attacker
  // could still swap a parent component after this identity check; final files
  // are therefore opened separately with O_NOFOLLOW and verified by handle.
  const first = await dependencies.lstat(directory);
  const canonical = await dependencies.realpath(directory);
  const followed = await dependencies.stat(directory);
  const final = await dependencies.lstat(directory);
  if (
    first.isSymbolicLink() ||
    !first.isDirectory() ||
    first.uid !== dependencies.getuid() ||
    exactMode(first) !== mode ||
    canonical !== directory ||
    !sameFileIdentity(first, followed) ||
    !sameFileIdentity(first, final) ||
    final.isSymbolicLink() ||
    !final.isDirectory() ||
    final.uid !== dependencies.getuid() ||
    exactMode(final) !== mode
  ) {
    throw new Error('Immutable Devin launcher parent directory is unsafe');
  }
}

export async function ensureDevinCommandBrokerLauncher(
  input: DevinBrokerLauncherInput,
  dependencies: EnsureDevinBrokerLauncherDependencies,
): Promise<string> {
  const directory = path.join(input.jobRoot, '.nanocrab', 'bin');
  const launcherPath = path.join(directory, 'nanocrab-job-exec');
  let exists = true;
  try {
    await dependencies.lstat(launcherPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    exists = false;
  }

  if (!exists) {
    try {
      await dependencies.lstat(directory);
    } catch (parentError) {
      if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw parentError;
      }
      await dependencies.mkdir(directory, { recursive: true, mode: 0o700 });
    }
    await validateImmutableDirectory(directory, 0o700, dependencies);
    const source = await buildDevinCommandBrokerLauncherSource(
      input,
      dependencies.realpath,
    );
    await createAndVerifyImmutableFile(
      launcherPath,
      source,
      0o555,
      dependencies,
      'Devin command broker launcher',
    );
    await dependencies.chmod(directory, 0o500);
    await validateImmutableDirectory(directory, 0o500, dependencies);
    return launcherPath;
  }

  const firstDirectory = await dependencies.lstat(directory);
  const uid = dependencies.getuid();
  if (
    firstDirectory.isSymbolicLink() ||
    !firstDirectory.isDirectory() ||
    firstDirectory.uid !== uid ||
    exactMode(firstDirectory) !== 0o500
  ) {
    throw new Error(
      'Immutable Devin command broker launcher metadata is unsafe',
    );
  }

  const canonicalDirectory = await dependencies.realpath(directory);
  if (canonicalDirectory !== directory) {
    throw new Error('Immutable Devin command broker launcher is noncanonical');
  }
  const followedDirectory = await dependencies.stat(directory);
  if (!sameFileIdentity(firstDirectory, followedDirectory)) {
    throw new Error('Immutable Devin command broker launcher identity changed');
  }
  const expectedSource = await buildDevinCommandBrokerLauncherSource(
    input,
    dependencies.realpath,
  );
  await openAndVerifyImmutableFile(
    launcherPath,
    expectedSource,
    0o555,
    dependencies,
    'Devin command broker launcher',
  );
  const finalDirectory = await dependencies.lstat(directory);
  if (
    !sameFileIdentity(firstDirectory, finalDirectory) ||
    finalDirectory.isSymbolicLink() ||
    !finalDirectory.isDirectory() ||
    finalDirectory.uid !== uid ||
    exactMode(finalDirectory) !== 0o500
  ) {
    throw new Error(
      'Immutable Devin command broker launcher validation failed',
    );
  }
  return launcherPath;
}

async function readExactHandle(
  handle: ImmutableFileHandle,
  length: number,
): Promise<Buffer> {
  const output = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(
      output,
      offset,
      length - offset,
      offset,
    );
    if (bytesRead <= 0) throw new Error('Immutable file ended unexpectedly');
    offset += bytesRead;
  }
  return output;
}

async function verifyImmutableHandle(
  handle: ImmutableFileHandle,
  expectedSource: string,
  mode: number,
  uid: number,
  label: string,
): Promise<void> {
  const expected = Buffer.from(expectedSource, 'utf8');
  const first = await handle.stat();
  if (
    !first.isFile() ||
    first.uid !== uid ||
    exactMode(first) !== mode ||
    first.size !== expected.length
  ) {
    throw new Error(`Immutable ${label} metadata is unsafe`);
  }
  const actual = await readExactHandle(handle, expected.length);
  const final = await handle.stat();
  if (
    !sameFileIdentity(first, final) ||
    !final.isFile() ||
    final.uid !== uid ||
    exactMode(final) !== mode ||
    final.size !== expected.length ||
    !actual.equals(expected)
  ) {
    throw new Error(`Immutable ${label} validation failed`);
  }
}

async function openAndVerifyImmutableFile(
  filePath: string,
  expectedSource: string,
  mode: number,
  dependencies: Pick<EnsureDevinAgentConfigDependencies, 'getuid' | 'open'>,
  label: string,
): Promise<void> {
  const flags =
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  let handle: ImmutableFileHandle | undefined;
  try {
    handle = await dependencies.open(filePath, flags);
    await verifyImmutableHandle(
      handle,
      expectedSource,
      mode,
      dependencies.getuid(),
      label,
    );
  } catch (error) {
    throw new Error(`Immutable ${label} open or validation failed`, {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

async function createAndVerifyImmutableFile(
  filePath: string,
  expectedSource: string,
  mode: number,
  dependencies: Pick<EnsureDevinAgentConfigDependencies, 'getuid' | 'open'>,
  label: string,
): Promise<void> {
  const flags =
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_RDWR |
    fs.constants.O_NOFOLLOW;
  let handle: ImmutableFileHandle | undefined;
  try {
    handle = await dependencies.open(filePath, flags, mode);
    await handle.writeFile(expectedSource, 'utf8');
    await handle.sync();
    await handle.chmod(mode);
    await verifyImmutableHandle(
      handle,
      expectedSource,
      mode,
      dependencies.getuid(),
      label,
    );
  } catch (error) {
    throw new Error(`Immutable ${label} creation or validation failed`, {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

export async function ensureDevinAgentConfig(
  configPath: string,
  expectedSource: string,
  dependencies: EnsureDevinAgentConfigDependencies,
): Promise<void> {
  let exists = true;
  try {
    await dependencies.lstat(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    exists = false;
  }
  if (exists) {
    await openAndVerifyImmutableFile(
      configPath,
      expectedSource,
      0o600,
      dependencies,
      'Devin agent config',
    );
  } else {
    await createAndVerifyImmutableFile(
      configPath,
      expectedSource,
      0o600,
      dependencies,
      'Devin agent config',
    );
  }
}

export interface DevinHostRunnerDependencies {
  spawn: CodingProcessSpawner;
  registry: ProcessRegistry;
  timers: CodingTimerTransport;
  environmentSource: NodeJS.ProcessEnv;
  knownSecrets: readonly string[];
  ensureAgentConfig(path: string, data: string): Promise<void>;
  realpath(path: string): Promise<string>;
  getVerifiedRuntimeContext(): VerifiedDevinRuntimeContext | null;
  ensureCommandBrokerLauncher: (
    input: DevinBrokerLauncherInput,
  ) => Promise<string>;
  commandBrokerModulePath: string;
  devinCredentialPath: string;
  home: string;
  nanocrabConfigRoot: string;
  signalProcessGroup(pid: number, signal: NodeJS.Signals): void;
}

export interface DevinHostRunnerProductionDependencies extends Omit<
  DevinHostRunnerDependencies,
  'ensureAgentConfig' | 'ensureCommandBrokerLauncher'
> {
  filesystem?: EnsureDevinBrokerLauncherDependencies &
    EnsureDevinAgentConfigDependencies;
}

const productionImmutableFileDependencies: EnsureDevinBrokerLauncherDependencies &
  EnsureDevinAgentConfigDependencies = {
  ...launcherDependencies,
  lstat: (value) => fs.promises.lstat(value),
  stat: (value) => fs.promises.stat(value),
  getuid: () => process.getuid?.() ?? -1,
  open: (value, flags, mode) => fs.promises.open(value, flags, mode),
};

export function createProductionDevinHostRunner(
  dependencies: DevinHostRunnerProductionDependencies,
): CodingRunnerAdapter {
  const {
    filesystem = productionImmutableFileDependencies,
    ...runnerDependencies
  } = dependencies;
  return createDevinHostRunner({
    ...runnerDependencies,
    ensureAgentConfig: (configPath, source) =>
      ensureDevinAgentConfig(configPath, source, filesystem),
    ensureCommandBrokerLauncher: (input) =>
      ensureDevinCommandBrokerLauncher(input, filesystem),
  });
}

const MAX_SAFE_OUTPUT = 1_048_576;
const STDERR_TAIL = 8_192;

interface ActiveRun {
  leaseToken: string;
  cancel(): boolean;
}

interface LatestRunIdentity {
  attemptId: string;
  leaseToken: string;
}

function runKey(jobId: string, attemptId: string): string {
  return `${jobId}\0${attemptId}`;
}

function failedBeforeSpawn(
  attemptId: string,
  detail: string,
): CodingRunnerResult {
  return {
    attemptId,
    state: 'failed',
    exitCode: null,
    signal: null,
    detail,
  };
}

function isAtOrBelowPath(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function createDevinHostRunner(
  deps: DevinHostRunnerDependencies,
): CodingRunnerAdapter {
  const activeRuns = new Map<string, ActiveRun>();
  const latestRunByJob = new Map<string, LatestRunIdentity>();

  return {
    async run(input: CodingRunnerInput): Promise<CodingRunnerResult> {
      const runtime = deps.getVerifiedRuntimeContext();
      if (!runtime) {
        return failedBeforeSpawn(
          input.attemptId,
          'Devin runtime verification is unavailable',
        );
      }

      let workspace: string;
      let promptFile: string;
      let home: string;
      let devinCredentialPath: string;
      let nanocrabConfigRoot: string;
      try {
        [workspace, promptFile, home, devinCredentialPath, nanocrabConfigRoot] =
          await Promise.all([
            deps.realpath(input.workspace),
            deps.realpath(input.promptFile),
            deps.realpath(deps.home),
            deps.realpath(deps.devinCredentialPath),
            deps.realpath(deps.nanocrabConfigRoot),
          ]);
      } catch {
        return failedBeforeSpawn(
          input.attemptId,
          'Devin workspace layout is invalid',
        );
      }

      const metadataDir = path.dirname(promptFile);
      const jobRoot = path.dirname(metadataDir);
      const validLayout =
        workspace === input.workspace &&
        promptFile === input.promptFile &&
        home === deps.home &&
        devinCredentialPath === deps.devinCredentialPath &&
        nanocrabConfigRoot === deps.nanocrabConfigRoot &&
        path.basename(metadataDir) === '.nanocrab' &&
        path.basename(promptFile) === 'prompt.txt' &&
        path.dirname(workspace) === jobRoot &&
        workspace !== metadataDir &&
        !isAtOrBelowPath(metadataDir, workspace) &&
        !isAtOrBelowPath(workspace, metadataDir);
      if (!validLayout) {
        return failedBeforeSpawn(
          input.attemptId,
          'Devin workspace layout is invalid',
        );
      }

      const stageKind = input.stageKind ?? 'direct';
      let brokerPath: string;
      const agentConfigPath = path.join(metadataDir, 'devin-agent.json');
      try {
        brokerPath = await deps.ensureCommandBrokerLauncher({
          stageKind,
          workspace,
          jobRoot,
          commandBrokerModulePath: deps.commandBrokerModulePath,
          sandboxExecutable: runtime.sandboxExecutable,
          nodeExecutable: runtime.nodeExecutable,
          home,
          protectedPaths: [
            metadataDir,
            devinCredentialPath,
            nanocrabConfigRoot,
          ],
          trustedRuntimeReadRoots: runtime.trustedRuntimeReadRoots,
        });
        const expectedBrokerPath = path.join(
          metadataDir,
          'bin',
          'nanocrab-job-exec',
        );
        if (brokerPath !== expectedBrokerPath) {
          throw new Error('Unexpected command broker path');
        }
        const config = buildDevinAgentConfig({
          stageKind,
          workspace,
          jobRoot,
          brokerPath,
          devinCredentialPath,
          home,
          nanocrabConfigRoot,
        });
        await deps.ensureAgentConfig(agentConfigPath, JSON.stringify(config));
      } catch {
        return failedBeforeSpawn(
          input.attemptId,
          'Devin runner configuration failed',
        );
      }

      let child;
      try {
        child = deps.spawn(
          runtime.executable,
          [
            '--prompt-file',
            promptFile,
            '--model',
            input.model,
            '--permission-mode',
            'auto',
            '--sandbox',
            '--agent-config',
            agentConfigPath,
            '--respect-workspace-trust',
            'true',
            '-p',
          ],
          {
            cwd: workspace,
            env: buildDevinChildEnvironment(deps.environmentSource),
            shell: false,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
      } catch {
        return failedBeforeSpawn(
          input.attemptId,
          'Devin process failed to start',
        );
      }

      let lease: ProcessLease;
      try {
        lease = deps.registry.register({
          jobId: input.jobId,
          attemptId: input.attemptId,
          process: child,
        });
      } catch {
        if (child.pid && child.pid > 0) {
          try {
            deps.signalProcessGroup(-child.pid, 'SIGTERM');
          } catch {
            // A detached process with a PID is never signalled as an individual.
          }
        } else {
          try {
            child.kill('SIGTERM');
          } catch {
            // A PID-less unleased child is best-effort terminated.
          }
        }
        return failedBeforeSpawn(
          input.attemptId,
          'Devin process registration failed',
        );
      }

      latestRunByJob.set(input.jobId, {
        attemptId: input.attemptId,
        leaseToken: lease.leaseToken,
      });
      const key = runKey(input.jobId, input.attemptId);
      const stdoutRedactor = createStreamingLogRedactor({
        knownSecrets: deps.knownSecrets,
      });
      const stderrRedactor = createStreamingLogRedactor({
        knownSecrets: deps.knownSecrets,
      });
      let safeOutputLength = 0;
      const truncationEmitted = { stdout: false, stderr: false };
      let stderrTail = '';
      let settled = false;
      let timeoutHandle: unknown;

      const ownsOutput = (): boolean =>
        !settled &&
        deps.registry.owns(lease) &&
        latestRunByJob.get(input.jobId)?.attemptId === input.attemptId &&
        latestRunByJob.get(input.jobId)?.leaseToken === lease.leaseToken;

      const emitSafe = (
        stream: CodingRunnerOutputChunk['stream'],
        safeText: string,
        duringSettlement = false,
      ): void => {
        if (!safeText) return;
        const allowed = duringSettlement
          ? deps.registry.owns(lease) &&
            latestRunByJob.get(input.jobId)?.attemptId === input.attemptId &&
            latestRunByJob.get(input.jobId)?.leaseToken === lease.leaseToken
          : ownsOutput();
        if (!allowed) return;
        if (stream === 'stderr') {
          stderrTail = (stderrTail + safeText).slice(-STDERR_TAIL);
        }
        const marker = '[NanoCrab: Devin output truncated]\n';
        const reservedMarkerBytes =
          Object.values(truncationEmitted).filter((value) => !value).length *
          marker.length;
        const remaining = Math.max(
          0,
          MAX_SAFE_OUTPUT - safeOutputLength - reservedMarkerBytes,
        );
        const truncated = safeText.length > remaining;
        const bounded = truncated
          ? safeText.slice(0, remaining) +
            (truncationEmitted[stream] ? '' : marker)
          : safeText;
        if (!bounded) return;
        safeOutputLength += bounded.length;
        if (truncated) truncationEmitted[stream] = true;
        input.onOutput({ stream, text: bounded });
      };

      const resultPromise = new Promise<CodingRunnerResult>((resolve) => {
        const settle = (
          result: CodingRunnerResult,
          releaseLease: boolean,
        ): boolean => {
          if (settled) return false;
          settled = true;
          if (timeoutHandle !== undefined)
            deps.timers.clearTimeout(timeoutHandle);
          emitSafe('stdout', stdoutRedactor.flush(), true);
          emitSafe('stderr', stderrRedactor.flush(), true);
          if (releaseLease) deps.registry.compareAndDelete(lease);
          if (activeRuns.get(key)?.leaseToken === lease.leaseToken) {
            activeRuns.delete(key);
          }
          if (
            latestRunByJob.get(input.jobId)?.attemptId === input.attemptId &&
            latestRunByJob.get(input.jobId)?.leaseToken === lease.leaseToken
          ) {
            latestRunByJob.delete(input.jobId);
          }
          if (result.state === 'failed' && result.exitCode !== null) {
            result.detail = `Devin exited with code ${result.exitCode}: ${stderrTail}`;
          }
          resolve(result);
          return true;
        };

        child.stdout?.on('data', (chunk) => {
          if (!ownsOutput()) return;
          emitSafe('stdout', stdoutRedactor.write(String(chunk)));
        });
        child.stderr?.on('data', (chunk) => {
          if (!ownsOutput()) return;
          emitSafe('stderr', stderrRedactor.write(String(chunk)));
        });
        child.once('error', () => {
          settle(
            failedBeforeSpawn(input.attemptId, 'Devin process failed to start'),
            true,
          );
        });
        child.once('close', (code, signal) => {
          settle(
            code === 0
              ? {
                  attemptId: input.attemptId,
                  state: 'succeeded',
                  exitCode: code,
                  signal,
                }
              : {
                  attemptId: input.attemptId,
                  state: 'failed',
                  exitCode: code,
                  signal,
                  detail:
                    code === null
                      ? 'Devin process terminated unexpectedly'
                      : undefined,
                },
            true,
          );
        });

        const activeRun: ActiveRun = {
          leaseToken: lease.leaseToken,
          cancel: () => {
            if (settled || !deps.registry.terminate(lease, 'cancelled')) {
              return false;
            }
            settle(
              {
                attemptId: input.attemptId,
                state: 'cancelled',
                exitCode: null,
                signal: null,
                detail: 'Devin process cancelled',
              },
              false,
            );
            return true;
          },
        };
        activeRuns.set(key, activeRun);
        timeoutHandle = deps.timers.setTimeout(() => {
          if (settled) return;
          deps.registry.terminate(lease, 'timed_out');
          settle(
            {
              attemptId: input.attemptId,
              state: 'timed_out',
              exitCode: null,
              signal: null,
              detail: 'Devin process timed out',
            },
            false,
          );
        }, input.timeoutMs);
      });

      return resultPromise;
    },

    cancel(jobId: string, attemptId: string): boolean {
      return activeRuns.get(runKey(jobId, attemptId))?.cancel() ?? false;
    },
  };
}
