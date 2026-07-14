import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CODING_WORKSPACE_DIR } from './config.js';

export type GitTransport = (
  args: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
  },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface CodingWorkspaceInput {
  jobId: string;
  repo: string;
  defaultBranch: string;
  branch: string;
  workspace: string;
  isFirstRun: boolean;
}

export interface PreparedCodingWorkspace {
  jobRoot: string;
  metadataDir: string;
  workspace: string;
  resumed: boolean;
  gitState: {
    staged: string;
    unstaged: string;
    untracked: string;
    unpushed: string;
  };
}

export interface CodingWorkspaceEvidence {
  diffStat: string;
  changedFiles: string[];
  untrackedFiles: string[];
  testEvidence: {
    status: 'not_reported';
    summary: string;
  };
}

type AskpassFactory = (
  token: string,
) => Promise<{ path: string; dispose(): Promise<void> }>;

interface CodingWorkspaceDeps {
  git: GitTransport;
  realpath: (value: string) => Promise<string>;
  lstat: (value: string) => Promise<fs.Stats>;
  mkdir: typeof fs.promises.mkdir;
  githubToken?: string | null;
  createAskpass?: AskpassFactory;
}

const GIT_TIMEOUT_MS = 120_000;
const TRUSTED_GIT_ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
};

const HARDENED_GIT_CONFIG = [
  ['credential.helper', ''],
  ['credential.interactive', 'never'],
  ['core.hooksPath', '/dev/null'],
  ['core.fsmonitor', 'false'],
  ['core.untrackedCache', 'false'],
  ['core.sshCommand', 'false'],
  ['protocol.allow', 'never'],
  ['protocol.https.allow', 'always'],
  ['protocol.http.allow', 'never'],
  ['protocol.ssh.allow', 'never'],
  ['protocol.file.allow', 'never'],
  ['protocol.ext.allow', 'never'],
  ['remote.origin.proxy', ''],
  ['http.proxy', ''],
  ['http.curloptResolve', ''],
  ['http.followRedirects', 'false'],
  ['http.sslVerify', 'true'],
  ['submodule.recurse', 'false'],
] as const;

const EMPTY_GIT_STATE: PreparedCodingWorkspace['gitState'] = {
  staged: '',
  unstaged: '',
  untracked: '',
  unpushed: '',
};

export function validateCodingRepoSlug(value: string): void {
  const components = value.split('/');
  if (
    components.length !== 2 ||
    components.some(
      (component) =>
        !/^[A-Za-z0-9_.-]+$/.test(component) ||
        component === '.' ||
        component === '..',
    )
  ) {
    throw new Error('Invalid GitHub repository slug');
  }
}

export function validateCodingBranch(value: string): void {
  const components = value.split('/');
  const hasForbiddenCharacter = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code <= 0x20 ||
      code === 0x7f ||
      ['~', '^', ':', '?', '*', '\\', '['].includes(character)
    );
  });
  if (
    !value ||
    value.startsWith('-') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('//') ||
    hasForbiddenCharacter ||
    components.some(
      (component) =>
        component === '.' || component === '..' || component.endsWith('.lock'),
    )
  ) {
    throw new Error('Invalid Git branch name');
  }
}

function validateJobId(value: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
    throw new Error('Invalid coding job identity');
  }
}

function isStrictlyBelow(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    Boolean(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function assertBelow(candidate: string, parent: string, label: string): void {
  if (!isStrictlyBelow(candidate, parent)) {
    throw new Error(`${label} escapes its approved parent`);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function pathExists(
  value: string,
  lstat: CodingWorkspaceDeps['lstat'],
): Promise<boolean> {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new Error('Unable to inspect coding workspace path', {
      cause: error,
    });
  }
}

async function createTemporaryAskpass(): ReturnType<AskpassFactory> {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'nanocrab-git-askpass-'),
  );
  const helperPath = path.join(directory, 'askpass.sh');
  const helper = [
    '#!/bin/sh',
    'case "$1" in',
    "  *Username*https://github.com\\'*|*Username*https://github.com/*) printf '%s\\n' 'x-access-token' ;;",
    "  *Password*https://x-access-token@github.com\\'*|*Password*https://x-access-token@github.com/*) printf '%s\\n' \"$NANOCRAB_GIT_TOKEN\" ;;",
    '  *) exit 1 ;;',
    'esac',
    '',
  ].join('\n');

  try {
    await fs.promises.writeFile(helperPath, helper, { mode: 0o700 });
    await fs.promises.chmod(helperPath, 0o700);
  } catch (error) {
    await fs.promises
      .rm(directory, { recursive: true, force: true })
      .catch(() => undefined);
    throw new Error('Unable to create Git credential helper', { cause: error });
  }

  return {
    path: helperPath,
    async dispose() {
      await fs.promises.rm(directory, { recursive: true, force: true });
    },
  };
}

function redact(value: string, token: string): string {
  return token ? value.split(token).join('[REDACTED]') : value;
}

function validateApprovedHostGitArgs(args: readonly string[]): void {
  if (
    args.length === 5 &&
    args[0] === 'clone' &&
    args[1] === '--depth' &&
    args[2] === '50' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      args[3],
    ) &&
    path.isAbsolute(args[4])
  ) {
    const repo = args[3].slice('https://github.com/'.length, -'.git'.length);
    validateCodingRepoSlug(repo);
    return;
  }

  if (
    args.length === 5 &&
    args[0] === 'fetch' &&
    args[1] === 'origin' &&
    args[3] === '--depth' &&
    args[4] === '50'
  ) {
    validateCodingBranch(args[2]);
    return;
  }

  if (args.length === 3 && args[0] === 'push' && args[1] === 'origin') {
    const branch = args[2].startsWith(':') ? args[2].slice(1) : args[2];
    validateCodingBranch(branch);
    return;
  }

  if (
    args.length === 4 &&
    args[0] === 'push' &&
    args[1] === 'origin' &&
    args[3] === '--force-with-lease'
  ) {
    const separator = args[2].indexOf(':');
    const branch = args[2].slice(0, separator);
    const destination = args[2].slice(separator + 1);
    validateCodingBranch(branch);
    if (separator < 1 || destination !== `refs/heads/${branch}`) {
      throw new Error('Git arguments are not an approved remote operation');
    }
    return;
  }

  throw new Error('Git arguments are not an approved remote operation');
}

function hardenedGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...TRUSTED_GIT_ENV,
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_SSH_COMMAND: 'false',
    GIT_CONFIG_COUNT: String(HARDENED_GIT_CONFIG.length),
  };
  HARDENED_GIT_CONFIG.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function credentialedGitEnvironment(
  helperPath: string,
  token: string,
): NodeJS.ProcessEnv {
  return {
    ...hardenedGitEnvironment(),
    GIT_ASKPASS: helperPath,
    GIT_TERMINAL_PROMPT: '0',
    NANOCRAB_GIT_TOKEN: token,
  };
}

export async function runApprovedHostGit(
  args: readonly string[],
  options: {
    cwd?: string;
    token: string;
    git: GitTransport;
    createAskpass: AskpassFactory;
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (!options.token) throw new Error('Git credential is required');
  if (args.some((argument) => argument.includes(options.token))) {
    throw new Error('Git arguments must not contain credentials');
  }
  validateApprovedHostGitArgs(args);

  let helper: Awaited<ReturnType<AskpassFactory>> | undefined;
  try {
    helper = await options.createAskpass(options.token);
    const result = await options.git(args, {
      cwd: options.cwd,
      timeoutMs: GIT_TIMEOUT_MS,
      env: credentialedGitEnvironment(helper.path, options.token),
    });
    return {
      stdout: redact(result.stdout, options.token),
      stderr: redact(result.stderr, options.token),
      exitCode: result.exitCode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    const sanitized = redact(message, options.token);
    throw new Error(`Approved Git operation failed: ${sanitized}`, {
      // Raw transport errors may contain credentials, including in their stack.
      // eslint-disable-next-line preserve-caught-error
      cause: new Error(sanitized),
    });
  } finally {
    if (helper) {
      await helper.dispose().catch(() => undefined);
    }
  }
}

function requireGitSuccess(
  result: Awaited<ReturnType<GitTransport>>,
  operation: string,
): void {
  if (result.exitCode !== 0) {
    throw new Error(`${operation} failed`);
  }
}

async function runLocalGit(
  git: GitTransport,
  args: readonly string[],
  cwd: string,
  operation: string,
): Promise<Awaited<ReturnType<GitTransport>>> {
  let result: Awaited<ReturnType<GitTransport>>;
  try {
    result = await git(args, {
      cwd,
      env: hardenedGitEnvironment(),
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (error) {
    void error;
    throw new Error(`${operation} failed`, {
      // Local transport errors may echo an unsafe origin from Git metadata.
      // eslint-disable-next-line preserve-caught-error
      cause: new Error('Local Git transport failed'),
    });
  }
  requireGitSuccess(result, operation);
  return result;
}

export async function collectCodingWorkspaceEvidence(
  workspace: string,
  deps: Pick<CodingWorkspaceDeps, 'git'>,
): Promise<CodingWorkspaceEvidence> {
  if (!path.isAbsolute(workspace) || path.normalize(workspace) !== workspace) {
    throw new Error('Coding workspace evidence path must be canonical');
  }
  const [diffStat, changedFiles, untrackedFiles] = await Promise.all([
    runLocalGit(
      deps.git,
      ['diff', '--stat', 'HEAD'],
      workspace,
      'Git diff evidence collection',
    ),
    runLocalGit(
      deps.git,
      ['diff', '--name-only', 'HEAD'],
      workspace,
      'Git changed-file evidence collection',
    ),
    runLocalGit(
      deps.git,
      ['ls-files', '--others', '--exclude-standard'],
      workspace,
      'Git untracked-file evidence collection',
    ),
  ]);
  const lines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  return {
    diffStat: diffStat.stdout.trim(),
    changedFiles: lines(changedFiles.stdout),
    untrackedFiles: lines(untrackedFiles.stdout),
    testEvidence: {
      status: 'not_reported',
      summary:
        'No trusted test evidence was reported by the Devin host runner.',
    },
  };
}

function canonicalOriginMatches(rawOrigin: string, repo: string): boolean {
  const origin = rawOrigin.trim();
  if (origin === `git@github.com:${repo}.git`) return true;

  try {
    const parsed = new URL(origin);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
    parsed.username = '';
    parsed.password = '';
    return parsed.toString() === `https://github.com/${repo}.git`;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function parseStatus(
  stdout: string,
): Pick<
  PreparedCodingWorkspace['gitState'],
  'staged' | 'unstaged' | 'untracked'
> {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of stdout.split('\n').filter(Boolean)) {
    if (line.startsWith('?? ')) {
      untracked.push(line.slice(3));
      continue;
    }
    if (line[0] && line[0] !== ' ') staged.push(line);
    if (line[1] && line[1] !== ' ') unstaged.push(line);
  }

  return {
    staged: staged.join('\n'),
    unstaged: unstaged.join('\n'),
    untracked: untracked.join('\n'),
  };
}

function assertOutsideMetadata(
  candidate: string,
  canonicalMetadataDir: string,
  label: string,
): void {
  const relative = path.relative(canonicalMetadataDir, candidate);
  if (
    !relative ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  ) {
    throw new Error(`${label} overlaps protected coding metadata`);
  }
}

async function validateWorkspaceParentChain(
  requestedWorkspace: string,
  requestedJobRoot: string,
  canonicalJobRoot: string,
  canonicalMetadataDir: string,
  deps: CodingWorkspaceDeps,
): Promise<void> {
  const requestedParent = path.dirname(requestedWorkspace);
  const relativeParent = path.relative(requestedJobRoot, requestedParent);
  if (!relativeParent) return;

  let current = requestedJobRoot;
  for (const component of relativeParent.split(path.sep)) {
    current = path.join(current, component);
    let currentStats: fs.Stats;
    try {
      currentStats = await deps.lstat(current);
    } catch (error) {
      if (isMissing(error)) return;
      throw new Error('Unable to inspect coding workspace parent', {
        cause: error,
      });
    }
    if (currentStats.isSymbolicLink()) {
      throw new Error('Coding workspace parent must not be a symlink');
    }
    if (!currentStats.isDirectory()) {
      throw new Error('Coding workspace parent must be a directory');
    }
    const canonicalParent = await deps.realpath(current);
    assertBelow(canonicalParent, canonicalJobRoot, 'Coding workspace parent');
    assertOutsideMetadata(
      canonicalParent,
      canonicalMetadataDir,
      'Coding workspace parent',
    );
  }
}

async function inspectExistingCheckout(
  input: CodingWorkspaceInput,
  deps: CodingWorkspaceDeps,
  canonicalWorkspace: string,
): Promise<PreparedCodingWorkspace['gitState']> {
  const gitMetadata = await deps
    .lstat(path.join(input.workspace, '.git'))
    .catch(() => undefined);
  if (
    !gitMetadata ||
    !gitMetadata.isDirectory() ||
    gitMetadata.isSymbolicLink()
  ) {
    throw new Error('Coding workspace has corrupt Git metadata');
  }

  const localInspectionQueries = [
    ['rev-parse', '--is-inside-work-tree'],
    ['remote', 'get-url', 'origin'],
    ['branch', '--show-current'],
    ['status', '--porcelain=v1'],
    ['log', '--format=%H %s', `origin/${input.defaultBranch}..HEAD`],
  ] as const;
  const [workTree, origin, branch, status, unpushed] = await Promise.all(
    localInspectionQueries.map((args) =>
      runLocalGit(
        deps.git,
        args,
        canonicalWorkspace,
        `Git ${args[0]} inspection`,
      ),
    ),
  );

  if (workTree.stdout.trim() !== 'true') {
    throw new Error('Coding workspace is not a valid Git work tree');
  }
  if (!canonicalOriginMatches(origin.stdout, input.repo)) {
    throw new Error(
      'Coding workspace origin does not match the approved repository',
    );
  }
  if (branch.stdout.trim() !== input.branch) {
    throw new Error(
      'Coding workspace branch does not match the approved branch',
    );
  }

  return {
    ...parseStatus(status.stdout),
    unpushed: unpushed.stdout.trim(),
  };
}

export async function prepareCodingWorkspace(
  input: CodingWorkspaceInput,
  deps: CodingWorkspaceDeps,
): Promise<PreparedCodingWorkspace> {
  validateCodingRepoSlug(input.repo);
  validateCodingBranch(input.defaultBranch);
  validateCodingBranch(input.branch);
  validateJobId(input.jobId);

  const jobsRoot = path.resolve(CODING_WORKSPACE_DIR, 'jobs');
  const jobRoot = path.resolve(jobsRoot, input.jobId);
  if (path.dirname(jobRoot) !== jobsRoot) {
    throw new Error('Coding job path escapes the jobs directory');
  }
  if (!path.isAbsolute(input.workspace)) {
    throw new Error('Coding workspace must be absolute');
  }
  const requestedWorkspace = path.resolve(input.workspace);
  assertBelow(requestedWorkspace, jobRoot, 'Coding workspace');
  const metadataDir = path.join(jobRoot, '.nanocrab');
  if (
    requestedWorkspace === metadataDir ||
    requestedWorkspace.startsWith(`${metadataDir}${path.sep}`)
  ) {
    throw new Error('Coding workspace overlaps protected job metadata');
  }

  await deps.mkdir(jobsRoot, { recursive: true });
  const canonicalJobsRoot = await deps.realpath(jobsRoot);
  await deps.mkdir(jobRoot, { recursive: true });
  const jobRootStats = await deps.lstat(jobRoot);
  if (jobRootStats.isSymbolicLink() || !jobRootStats.isDirectory()) {
    throw new Error('Coding job root must be a real directory');
  }
  const canonicalJobRoot = await deps.realpath(jobRoot);
  assertBelow(canonicalJobRoot, canonicalJobsRoot, 'Coding job root');
  await deps.mkdir(metadataDir, { recursive: true });
  const metadataStats = await deps.lstat(metadataDir);
  if (metadataStats.isSymbolicLink() || !metadataStats.isDirectory()) {
    throw new Error('Coding metadata directory must be a real directory');
  }
  const canonicalMetadataDir = await deps.realpath(metadataDir);
  assertBelow(
    canonicalMetadataDir,
    canonicalJobRoot,
    'Coding metadata directory',
  );

  await validateWorkspaceParentChain(
    requestedWorkspace,
    jobRoot,
    canonicalJobRoot,
    canonicalMetadataDir,
    deps,
  );

  const exists = await pathExists(requestedWorkspace, deps.lstat);
  if (exists) {
    const canonicalWorkspace = await deps.realpath(requestedWorkspace);
    assertBelow(canonicalWorkspace, canonicalJobRoot, 'Coding workspace');
    assertOutsideMetadata(
      canonicalWorkspace,
      canonicalMetadataDir,
      'Coding workspace',
    );
    const gitState = await inspectExistingCheckout(
      input,
      deps,
      canonicalWorkspace,
    );
    return {
      jobRoot: canonicalJobRoot,
      metadataDir: canonicalMetadataDir,
      workspace: canonicalWorkspace,
      resumed: true,
      gitState,
    };
  }

  if (!input.isFirstRun) {
    throw new Error('Coding workspace is missing for retry');
  }
  if (!deps.githubToken) {
    throw new Error('GitHub credential is required for first-run checkout');
  }
  const createAskpass = deps.createAskpass ?? createTemporaryAskpass;
  const remoteUrl = `https://github.com/${input.repo}.git`;
  const clone = await runApprovedHostGit(
    ['clone', '--depth', '50', remoteUrl, requestedWorkspace],
    {
      token: deps.githubToken,
      git: deps.git,
      createAskpass,
    },
  );
  requireGitSuccess(clone, 'Git clone');

  const canonicalWorkspace = await deps.realpath(requestedWorkspace);
  assertBelow(canonicalWorkspace, canonicalJobRoot, 'Coding workspace');
  assertOutsideMetadata(
    canonicalWorkspace,
    canonicalMetadataDir,
    'Coding workspace',
  );
  const fetchResult = await runApprovedHostGit(
    ['fetch', 'origin', input.defaultBranch, '--depth', '50'],
    {
      cwd: canonicalWorkspace,
      token: deps.githubToken,
      git: deps.git,
      createAskpass,
    },
  );
  requireGitSuccess(fetchResult, 'Git fetch');
  await runLocalGit(
    deps.git,
    ['checkout', '-B', input.defaultBranch, `origin/${input.defaultBranch}`],
    canonicalWorkspace,
    'Git default branch checkout',
  );
  await runLocalGit(
    deps.git,
    ['checkout', '-B', input.branch],
    canonicalWorkspace,
    'Git job branch checkout',
  );

  return {
    jobRoot: canonicalJobRoot,
    metadataDir: canonicalMetadataDir,
    workspace: canonicalWorkspace,
    resumed: false,
    gitState: { ...EMPTY_GIT_STATE },
  };
}
