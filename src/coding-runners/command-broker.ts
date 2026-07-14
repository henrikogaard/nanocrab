import path from 'node:path';

import {
  buildDevinChildEnvironment,
  type DevinStageKind,
} from './devin-host.js';

export interface BrokerRequest {
  stageKind: DevinStageKind;
  workspace: string;
  cwd: string;
  argv: readonly string[];
  home: string;
  protectedPaths: readonly string[];
  trustedRuntimeReadRoots: readonly string[];
}

export type BrokerCommandExecutor = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    shell: false;
    stdio: 'inherit';
  },
) => Promise<number>;

export interface CommandBrokerDependencies {
  platform: NodeJS.Platform;
  execute: BrokerCommandExecutor;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  environmentSource: NodeJS.ProcessEnv;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
}

const CONTROL_CHARACTER = /[\0\n\r]/;
const DANGEROUS_SCRIPT_NAME = /(install|publish|release|deploy)/i;
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const INSPECTION_EXECUTABLES = new Set([
  'pwd',
  'ls',
  'find',
  'rg',
  'grep',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'stat',
]);

function isAtOrBelow(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return isAtOrBelow(left, right) || isAtOrBelow(right, left);
}

function assertCanonicalRoot(value: string, label: string): void {
  if (
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.normalize(value) !== value ||
    value === path.parse(value).root
  ) {
    throw new Error(`${label} must be an explicit canonical root`);
  }
}

function validateIsolationRoots(request: BrokerRequest): void {
  if (typeof request.home !== 'string') {
    throw new Error('Service home isolation root is required');
  }
  assertCanonicalRoot(request.home, 'Service home');
  if (
    !Array.isArray(request.protectedPaths) ||
    request.protectedPaths.length === 0
  ) {
    throw new Error('Protected roots are required');
  }
  if (
    !Array.isArray(request.trustedRuntimeReadRoots) ||
    request.trustedRuntimeReadRoots.length === 0
  ) {
    throw new Error('Trusted runtime read roots are required');
  }
  const seenProtectedPaths = new Set<string>();
  for (const protectedPath of request.protectedPaths) {
    assertCanonicalRoot(protectedPath, 'Protected path');
    if (seenProtectedPaths.has(protectedPath)) {
      throw new Error('Duplicate protected root');
    }
    seenProtectedPaths.add(protectedPath);
    if (pathsOverlap(protectedPath, request.workspace)) {
      throw new Error('Protected path overlaps the workspace');
    }
  }
  const seenRuntimeRoots = new Set<string>();
  for (const runtimeRoot of request.trustedRuntimeReadRoots) {
    assertCanonicalRoot(runtimeRoot, 'Trusted runtime read root');
    if (
      [...seenRuntimeRoots].some((seenRuntimeRoot) =>
        pathsOverlap(runtimeRoot, seenRuntimeRoot),
      )
    ) {
      throw new Error('Duplicate or overlapping trusted runtime read root');
    }
    seenRuntimeRoots.add(runtimeRoot);
    if (isAtOrBelow(request.home, runtimeRoot)) {
      throw new Error('Trusted runtime read root exposes service home');
    }
    if (
      request.protectedPaths.some((protectedPath) =>
        pathsOverlap(runtimeRoot, protectedPath),
      )
    ) {
      throw new Error('Trusted runtime read root overlaps a protected path');
    }
  }
}

function validateSandboxMountRoots(
  request: BrokerRequest,
  temporaryDirectory: string,
): void {
  if (
    request.protectedPaths.some((protectedPath) =>
      pathsOverlap(protectedPath, temporaryDirectory),
    )
  ) {
    throw new Error('Protected root overlaps writable temp');
  }
  if (
    request.trustedRuntimeReadRoots.some(
      (runtimeRoot) =>
        pathsOverlap(runtimeRoot, request.workspace) ||
        pathsOverlap(runtimeRoot, temporaryDirectory),
    )
  ) {
    throw new Error('Trusted runtime root overlaps a writable root');
  }
}

function assertRelativePath(value: string): void {
  if (
    !value ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/).includes('..') ||
    CONTROL_CHARACTER.test(value)
  ) {
    throw new Error('Command denied: invalid external path operand');
  }
}

function assertNoUnknownOption(value: string): void {
  if (value.startsWith('-')) {
    throw new Error(`Command denied: option ${value} is not allowed`);
  }
}

function validateLs(args: readonly string[]): void {
  const flags = new Set(['-a', '-l', '-la', '-al', '-1']);
  for (const arg of args) {
    if (arg.startsWith('-')) {
      if (!flags.has(arg)) throw new Error('Command denied: invalid ls option');
    } else {
      assertRelativePath(arg);
    }
  }
}

function validateFind(args: readonly string[]): void {
  if (args.length === 0)
    throw new Error('Command denied: find requires a root');
  assertRelativePath(args[0]!);
  let index = 1;
  while (index < args.length) {
    const token = args[index++];
    if (token === '-print') continue;
    const value = args[index++];
    if (value === undefined)
      throw new Error('Command denied: incomplete find predicate');
    if (token === '-maxdepth') {
      if (!/^\d+$/.test(value))
        throw new Error('Command denied: invalid find depth');
    } else if (token === '-type') {
      if (!['f', 'd', 'l'].includes(value))
        throw new Error('Command denied: invalid find type');
    } else if (token === '-name' || token === '-path') {
      if (CONTROL_CHARACTER.test(value) || path.isAbsolute(value)) {
        throw new Error('Command denied: invalid find pattern');
      }
    } else {
      throw new Error(
        'Command denied: find action or predicate is not allowed',
      );
    }
  }
}

function validateRg(args: readonly string[]): void {
  const booleanFlags = new Set([
    '-n',
    '--line-number',
    '-l',
    '--files-with-matches',
    '--files',
    '-F',
    '--fixed-strings',
    '-i',
    '--ignore-case',
    '--hidden',
    '--no-ignore',
  ]);
  let index = 0;
  let filesMode = false;
  while (index < args.length && args[index]!.startsWith('-')) {
    const flag = args[index++]!;
    if (flag === '--') break;
    if (flag === '-g' || flag === '--glob') {
      const glob = args[index++];
      if (!glob || CONTROL_CHARACTER.test(glob) || path.isAbsolute(glob)) {
        throw new Error('Command denied: invalid rg glob');
      }
      continue;
    }
    if (!booleanFlags.has(flag))
      throw new Error('Command denied: invalid rg option');
    if (flag === '--files') filesMode = true;
  }
  if (!filesMode) {
    const pattern = args[index++];
    if (pattern === undefined || CONTROL_CHARACTER.test(pattern)) {
      throw new Error('Command denied: rg requires a safe pattern');
    }
  }
  for (; index < args.length; index += 1) assertRelativePath(args[index]!);
}

function validateGrep(args: readonly string[]): void {
  const flags = new Set(['-n', '-r', '-i', '-F', '-E', '-l']);
  let index = 0;
  while (index < args.length && flags.has(args[index]!)) index += 1;
  const pattern = args[index++];
  if (pattern === undefined || CONTROL_CHARACTER.test(pattern)) {
    throw new Error('Command denied: grep requires a safe pattern');
  }
  assertNoUnknownOption(pattern);
  if (index === args.length)
    throw new Error('Command denied: grep requires a path');
  for (; index < args.length; index += 1) assertRelativePath(args[index]!);
}

function validateFileReader(executable: string, args: readonly string[]): void {
  let index = 0;
  if (executable === 'head' || executable === 'tail') {
    if (args[0] === '-n') {
      if (!/^[1-9]\d*$/.test(args[1] ?? '')) {
        throw new Error('Command denied: invalid line count');
      }
      index = 2;
    }
  } else if (
    executable === 'wc' &&
    ['-l', '-w', '-c'].includes(args[0] ?? '')
  ) {
    index = 1;
  }
  if (args[index] === '--') index += 1;
  if (index === args.length)
    throw new Error(`Command denied: ${executable} requires a path`);
  for (; index < args.length; index += 1) {
    assertNoUnknownOption(args[index]!);
    assertRelativePath(args[index]!);
  }
}

function validateGit(args: readonly string[]): void {
  const subcommand = args[0];
  const rest = args.slice(1);
  if (!subcommand || subcommand.startsWith('-')) {
    throw new Error('Command denied: Git subcommand must be argv[1]');
  }
  if (subcommand === 'branch') {
    if (rest.length !== 1 || rest[0] !== '--show-current') {
      throw new Error(
        'Command denied: only git branch --show-current is allowed',
      );
    }
    return;
  }
  if (subcommand === 'status') {
    const allowed = new Set(['--short', '--porcelain', '--porcelain=v1']);
    if (rest.length > 1 || rest.some((arg) => !allowed.has(arg))) {
      throw new Error('Command denied: invalid git status option');
    }
    return;
  }
  if (subcommand === 'rev-parse') {
    const exact = new Set([
      '--show-toplevel',
      '--show-prefix',
      '--git-dir',
      '--is-inside-work-tree',
      'HEAD',
    ]);
    if (rest.length !== 1 || !exact.has(rest[0]!)) {
      throw new Error('Command denied: invalid git rev-parse form');
    }
    return;
  }
  if (subcommand === 'diff') {
    const flags = new Set([
      '--check',
      '--stat',
      '--name-only',
      '--cached',
      '--staged',
      '--no-ext-diff',
      '--no-textconv',
      '--',
    ]);
    for (const arg of rest) {
      if (arg.startsWith('-')) {
        if (!flags.has(arg))
          throw new Error('Command denied: invalid git diff option');
      } else assertRelativePath(arg);
    }
    return;
  }
  if (subcommand === 'log') {
    const flags = new Set([
      '--oneline',
      '--decorate',
      '--stat',
      '--name-only',
      '--no-merges',
      '--all',
      '--no-ext-diff',
      '--no-textconv',
      '--',
    ]);
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index]!;
      if (arg === '-n') {
        if (!/^[1-9]\d*$/.test(rest[++index] ?? '')) {
          throw new Error('Command denied: invalid git log count');
        }
      } else if (/^--max-count=[1-9]\d*$/.test(arg) || flags.has(arg)) {
        continue;
      } else if (arg.startsWith('-')) {
        throw new Error('Command denied: invalid git log option');
      } else assertRelativePath(arg);
    }
    return;
  }
  if (subcommand === 'show') {
    const flags = new Set([
      '--stat',
      '--name-only',
      '--oneline',
      '--no-ext-diff',
      '--no-textconv',
      '--',
    ]);
    for (const arg of rest) {
      if (arg.startsWith('-')) {
        if (!flags.has(arg))
          throw new Error('Command denied: invalid git show option');
      } else assertRelativePath(arg);
    }
    return;
  }
  if (subcommand === 'ls-files') {
    const flags = new Set([
      '--cached',
      '--modified',
      '--others',
      '--exclude-standard',
      '--error-unmatch',
      '--',
    ]);
    for (const arg of rest) {
      if (arg.startsWith('-')) {
        if (!flags.has(arg))
          throw new Error('Command denied: invalid git ls-files option');
      } else assertRelativePath(arg);
    }
    return;
  }
  throw new Error('Command denied: Git mutation or unknown subcommand');
}

function validateBuildCommand(argv: readonly string[]): void {
  const [executable, ...args] = argv;
  if (PACKAGE_MANAGERS.has(executable!)) {
    if (args.length === 1 && args[0] === 'test') return;
    if (
      args.length === 2 &&
      args[0] === 'run' &&
      /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(args[1]!) &&
      !DANGEROUS_SCRIPT_NAME.test(args[1]!)
    ) {
      return;
    }
    throw new Error('Command denied: package command is not allowed');
  }
  if (
    executable === 'cargo' &&
    args.length === 1 &&
    ['test', 'check', 'build'].includes(args[0]!)
  )
    return;
  if (
    executable === 'go' &&
    args.length === 1 &&
    ['test', 'build', 'vet'].includes(args[0]!)
  )
    return;
  if (executable === 'pytest' && args.length === 0) return;
  if (
    executable === 'python' &&
    args.length === 2 &&
    args[0] === '-m' &&
    args[1] === 'pytest'
  )
    return;
  throw new Error('Command denied: build or test command is not allowed');
}

export function validateBrokerCommand(request: BrokerRequest): void {
  if (!path.isAbsolute(request.workspace) || !path.isAbsolute(request.cwd)) {
    throw new Error('Invalid broker workspace or cwd');
  }
  validateIsolationRoots(request);
  if (
    !isAtOrBelow(path.resolve(request.cwd), path.resolve(request.workspace))
  ) {
    throw new Error('Command cwd escapes the workspace');
  }
  if (request.argv.length === 0) throw new Error('Command denied: empty argv');
  for (const arg of request.argv) {
    if (!arg || CONTROL_CHARACTER.test(arg))
      throw new Error('Command denied: invalid argument');
  }
  const executable = request.argv[0]!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(executable)) {
    throw new Error('Command denied: invalid executable');
  }
  const args = request.argv.slice(1);
  if (executable === 'pwd') {
    if (args.length !== 0)
      throw new Error('Command denied: pwd accepts no arguments');
    return;
  }
  if (executable === 'ls') return validateLs(args);
  if (executable === 'find') return validateFind(args);
  if (executable === 'rg') return validateRg(args);
  if (executable === 'grep') return validateGrep(args);
  if (['cat', 'head', 'tail', 'wc', 'file', 'stat'].includes(executable)) {
    return validateFileReader(executable, args);
  }
  if (executable === 'git') return validateGit(args);
  if (INSPECTION_EXECUTABLES.has(executable)) {
    throw new Error('Command denied: invalid inspection command');
  }
  if (request.stageKind !== 'implement' && request.stageKind !== 'direct') {
    throw new Error('Command denied during read-only stage');
  }
  validateBuildCommand(request.argv);
}

function isBuildCommand(request: BrokerRequest): boolean {
  return (
    !INSPECTION_EXECUTABLES.has(request.argv[0]!) && request.argv[0] !== 'git'
  );
}

function sandboxPathFilters(value: string): string {
  return `(literal ${JSON.stringify(value)}) (subpath ${JSON.stringify(value)})`;
}

async function assertCanonicalIsolationPaths(
  request: BrokerRequest,
  temporaryDirectory: string,
  deps: CommandBrokerDependencies,
): Promise<void> {
  for (const value of [
    request.home,
    ...request.protectedPaths,
    ...request.trustedRuntimeReadRoots,
    temporaryDirectory,
  ]) {
    if ((await deps.realpath(value)) !== value) {
      throw new Error('Isolation root is not canonical');
    }
  }
}

function sandboxProfile(
  workspace: string,
  temporaryDirectory: string,
  trustedRuntimeReadRoots: readonly string[],
  workspaceWritable: boolean,
): string {
  const readableRoots = [
    ...trustedRuntimeReadRoots,
    workspace,
    temporaryDirectory,
  ];
  const rules = [
    '(version 1)',
    '(deny default)',
    '(allow process-exec)',
    '(allow process-fork)',
    '(deny network*)',
    `(allow file-read* ${readableRoots.map(sandboxPathFilters).join(' ')})`,
    `(allow file-write* (subpath ${JSON.stringify(temporaryDirectory)}))`,
  ];
  if (workspaceWritable) {
    rules.push(`(allow file-write* (subpath ${JSON.stringify(workspace)}))`);
  }
  return rules.join(' ');
}

function sandboxDirectoryArgs(values: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const value of values) {
    let current = value;
    while (current !== path.parse(current).root) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return [...directories]
    .sort(
      (left, right) =>
        left.split(path.sep).length - right.split(path.sep).length,
    )
    .flatMap((directory) => ['--dir', directory]);
}

export function buildSandboxedCommand(
  request: BrokerRequest,
  deps: Pick<
    CommandBrokerDependencies,
    'platform' | 'sandboxExecutable' | 'environmentSource'
  >,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  validateBrokerCommand(request);
  const workspaceWritable = isBuildCommand(request);
  const configuredTemporaryDirectory = deps.environmentSource.TMPDIR ?? '/tmp';
  if (!path.isAbsolute(configuredTemporaryDirectory)) {
    throw new Error('Sandbox temp path is invalid');
  }
  const temporaryDirectory = path.resolve(configuredTemporaryDirectory);
  validateSandboxMountRoots(request, temporaryDirectory);
  const env = buildDevinChildEnvironment({
    ...deps.environmentSource,
    HOME: request.home,
    TMPDIR: temporaryDirectory,
  });
  if (deps.platform === 'linux') {
    if (deps.sandboxExecutable !== '/usr/bin/bwrap') {
      throw new Error('Linux command sandbox isolation is unavailable');
    }
    return {
      executable: deps.sandboxExecutable,
      args: [
        '--unshare-net',
        '--unshare-pid',
        '--unshare-ipc',
        '--new-session',
        '--die-with-parent',
        '--tmpfs',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        ...sandboxDirectoryArgs([
          ...request.trustedRuntimeReadRoots,
          request.workspace,
          temporaryDirectory,
        ]),
        ...request.trustedRuntimeReadRoots.flatMap((runtimeRoot) => [
          '--ro-bind',
          runtimeRoot,
          runtimeRoot,
        ]),
        workspaceWritable ? '--bind' : '--ro-bind',
        request.workspace,
        request.workspace,
        '--bind',
        temporaryDirectory,
        temporaryDirectory,
        '--chdir',
        request.cwd,
        '--',
        ...request.argv,
      ],
      env,
    };
  }
  if (deps.platform === 'darwin') {
    if (deps.sandboxExecutable !== '/usr/bin/sandbox-exec') {
      throw new Error('macOS command sandbox isolation is unavailable');
    }
    return {
      executable: deps.sandboxExecutable,
      args: [
        '-p',
        sandboxProfile(
          request.workspace,
          temporaryDirectory,
          request.trustedRuntimeReadRoots,
          workspaceWritable,
        ),
        '--',
        ...request.argv,
      ],
      env,
    };
  }
  throw new Error('Unsupported command sandbox platform');
}

async function assertManifestScript(
  request: BrokerRequest,
  deps: CommandBrokerDependencies,
): Promise<void> {
  const [executable, verb, scriptName] = request.argv;
  if (!PACKAGE_MANAGERS.has(executable!) || verb !== 'run') return;
  if (!scriptName || DANGEROUS_SCRIPT_NAME.test(scriptName)) {
    throw new Error('Command denied: unsafe package script');
  }
  let manifest: unknown;
  try {
    const manifestPath = await deps.realpath(
      path.join(request.workspace, 'package.json'),
    );
    if (!isAtOrBelow(manifestPath, request.workspace)) {
      throw new Error('Package manifest escapes the workspace');
    }
    manifest = JSON.parse(await deps.readFile(manifestPath));
  } catch (error) {
    throw new Error('Unable to verify package script manifest', {
      cause: error,
    });
  }
  const scripts = (manifest as { scripts?: unknown })?.scripts;
  if (
    !scripts ||
    typeof scripts !== 'object' ||
    !Object.prototype.hasOwnProperty.call(scripts, scriptName) ||
    typeof (scripts as Record<string, unknown>)[scriptName] !== 'string'
  ) {
    throw new Error(
      'Command denied: package script is not approved by the manifest',
    );
  }
}

function inspectionPathIndexes(argv: readonly string[]): number[] {
  const [executable, ...args] = argv;
  if (executable === 'ls') {
    return args.flatMap((arg, index) =>
      arg.startsWith('-') ? [] : [index + 1],
    );
  }
  if (executable === 'find') return [1];
  if (executable === 'rg') {
    let index = 0;
    let filesMode = false;
    while (index < args.length && args[index]!.startsWith('-')) {
      const flag = args[index++]!;
      if (flag === '--') break;
      if (flag === '-g' || flag === '--glob') index += 1;
      if (flag === '--files') filesMode = true;
    }
    if (!filesMode) index += 1;
    return args.slice(index).map((_, offset) => index + offset + 1);
  }
  if (executable === 'grep') {
    const flags = new Set(['-n', '-r', '-i', '-F', '-E', '-l']);
    let index = 0;
    while (index < args.length && flags.has(args[index]!)) index += 1;
    index += 1;
    return args.slice(index).map((_, offset) => index + offset + 1);
  }
  if (['cat', 'head', 'tail', 'wc', 'file', 'stat'].includes(executable!)) {
    let index = 0;
    if ((executable === 'head' || executable === 'tail') && args[0] === '-n') {
      index = 2;
    } else if (
      executable === 'wc' &&
      ['-l', '-w', '-c'].includes(args[0] ?? '')
    ) {
      index = 1;
    }
    if (args[index] === '--') index += 1;
    return args.slice(index).map((_, offset) => index + offset + 1);
  }
  return [];
}

async function canonicalizeInspectionPaths(
  request: BrokerRequest,
  deps: CommandBrokerDependencies,
): Promise<string[]> {
  const argv = [...request.argv];
  for (const index of inspectionPathIndexes(argv)) {
    const canonicalPath = await deps.realpath(
      path.resolve(request.cwd, argv[index]!),
    );
    if (!isAtOrBelow(canonicalPath, request.workspace)) {
      throw new Error('Command read path escapes the workspace');
    }
    argv[index] = canonicalPath;
  }
  return argv;
}

function hardenedGitArgs(args: readonly string[]): string[] {
  const [subcommand, ...rest] = args;
  const result = [
    '--no-optional-locks',
    '--no-pager',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    subcommand!,
  ];
  if (['diff', 'log', 'show'].includes(subcommand!)) {
    if (!rest.includes('--no-ext-diff')) result.push('--no-ext-diff');
    if (!rest.includes('--no-textconv')) result.push('--no-textconv');
  }
  result.push(...rest);
  return result;
}

function replaceSandboxedArgv(
  command: { args: string[] },
  argv: readonly string[],
): void {
  const separator = command.args.indexOf('--');
  if (separator < 0) {
    throw new Error('Sandbox command separator is missing');
  }
  command.args.splice(separator + 1, command.args.length, ...argv);
}

export async function runCommandBrokerCli(
  request: BrokerRequest,
  deps: CommandBrokerDependencies,
): Promise<number> {
  validateBrokerCommand(request);
  const canonicalWorkspace = await deps.realpath(request.workspace);
  const canonicalCwd = await deps.realpath(request.cwd);
  if (!isAtOrBelow(canonicalCwd, canonicalWorkspace)) {
    throw new Error('Canonical command cwd escapes the workspace');
  }
  const canonicalRequest: BrokerRequest = {
    ...request,
    workspace: canonicalWorkspace,
    cwd: canonicalCwd,
  };
  const configuredTemp = deps.environmentSource.TMPDIR ?? '/tmp';
  if (!path.isAbsolute(configuredTemp)) {
    throw new Error('Sandbox temp path is invalid');
  }
  const canonicalTemp = await deps.realpath(configuredTemp);
  await assertCanonicalIsolationPaths(canonicalRequest, canonicalTemp, deps);
  await assertManifestScript(canonicalRequest, deps);
  const canonicalArgv = await canonicalizeInspectionPaths(
    canonicalRequest,
    deps,
  );
  let executionDependencies: Pick<
    CommandBrokerDependencies,
    'platform' | 'sandboxExecutable' | 'environmentSource'
  > = deps;
  if (isBuildCommand(canonicalRequest)) {
    executionDependencies = {
      ...deps,
      environmentSource: {
        ...deps.environmentSource,
        TMPDIR: canonicalTemp,
      },
    };
  }
  const command = buildSandboxedCommand(
    canonicalRequest,
    executionDependencies,
  );
  let brokerArgv = canonicalArgv;
  if (canonicalRequest.argv[0] === 'git') {
    brokerArgv = ['git', ...hardenedGitArgs(canonicalRequest.argv.slice(1))];
    command.env.GIT_OPTIONAL_LOCKS = '0';
  }
  replaceSandboxedArgv(command, brokerArgv);
  return deps.execute(command.executable, command.args, {
    cwd: canonicalCwd,
    env: command.env,
    shell: false,
    stdio: 'inherit',
  });
}
