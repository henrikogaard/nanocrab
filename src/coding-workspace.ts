import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CODING_WORKSPACE_DIR } from './config.js';
import {
  openStableDirectory,
  openStableDirectoryAt,
  type StableDirectoryHandle,
} from './coding-runners/stable-directory.js';
import {
  HostGitCancelledError,
  HostGitTimeoutError,
} from './coding-runners/host-git.js';

export type GitTransport = (
  args: readonly string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    stdin?: string;
    jobId?: string;
    attemptId?: string;
  },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface CodingWorkspaceInput {
  jobId: string;
  attemptId?: string;
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

export interface CodingWorkspacePublicationInput {
  workspace: string;
  repo: string;
  branch: string;
  commitMessage: string;
  token: string;
  assertOwnership(): void;
  jobId?: string;
  attemptId?: string;
  commitSigningPolicy?: 'off' | 'prefer' | 'require';
  /** A key id in the host keyring; never a private key or credential. */
  signingKey?: string;
}

export type CodingCommitSigningStatus =
  | 'unsigned'
  | 'signed'
  | 'preferred-unsigned';

export interface CodingWorkspacePublicationResult {
  commitSha: string;
  signingStatus?: CodingCommitSigningStatus;
  signingWarning?: string;
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
  TZ: 'UTC',
  GIT_AUTHOR_NAME: 'NanoCrab Bot',
  GIT_AUTHOR_EMAIL: 'nanocrab@localhost',
  GIT_COMMITTER_NAME: 'NanoCrab Bot',
  GIT_COMMITTER_EMAIL: 'nanocrab@localhost',
};

const HARDENED_GIT_CONFIG = [
  ['credential.helper', ''],
  ['credential.interactive', 'never'],
  ['core.hooksPath', '/dev/null'],
  ['commit.gpgSign', 'false'],
  ['tag.gpgSign', 'false'],
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

  if (
    args.length === 3 &&
    args[0] === 'push' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      args[1]!,
    )
  ) {
    validateCodingRepoSlug(
      args[1]!.slice('https://github.com/'.length, -'.git'.length),
    );
    const branch = args[2].startsWith(':') ? args[2].slice(1) : args[2];
    validateCodingBranch(branch);
    return;
  }

  if (
    args.length === 4 &&
    args[0] === 'push' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      args[1]!,
    ) &&
    args[3] === '--force-with-lease'
  ) {
    validateCodingRepoSlug(
      args[1]!.slice('https://github.com/'.length, -'.git'.length),
    );
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

function hardenedGitEnvironment(worktree?: string): NodeJS.ProcessEnv {
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
  if (worktree) env.GIT_WORK_TREE = worktree;
  HARDENED_GIT_CONFIG.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

function credentialedGitEnvironment(
  helperPath: string,
  token: string,
  worktree?: string,
): NodeJS.ProcessEnv {
  return {
    ...hardenedGitEnvironment(worktree),
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
    jobId?: string;
    attemptId?: string;
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
      env: credentialedGitEnvironment(helper.path, options.token, options.cwd),
      jobId: options.jobId,
      attemptId: options.attemptId,
    });
    return {
      stdout: redact(result.stdout, options.token),
      stderr: redact(result.stderr, options.token),
      exitCode: result.exitCode,
    };
  } catch (error) {
    if (error instanceof HostGitTimeoutError) throw error;
    if (error instanceof HostGitCancelledError) throw error;
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
  stdin?: string,
): Promise<Awaited<ReturnType<GitTransport>>> {
  let result: Awaited<ReturnType<GitTransport>>;
  try {
    result = await git(args, {
      cwd,
      env: hardenedGitEnvironment(cwd),
      timeoutMs: GIT_TIMEOUT_MS,
      stdin,
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

async function openStableFileIfExists(filePath: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(
      filePath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw new Error('Git metadata validation failed', {
      // Filesystem failures may expose paths outside the approved workspace.
      // eslint-disable-next-line preserve-caught-error
      cause: new Error('Git metadata is not trusted'),
    });
  } finally {
    await handle?.close();
  }
}

async function walkGitMetadata(dir: StableDirectoryHandle): Promise<void> {
  for (const entry of await fs.promises.readdir(dir.path, {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink()) {
      throw new Error('Git metadata must not contain symlinks');
    }
    if (entry.isDirectory()) {
      const child = await openStableDirectoryAt(
        dir,
        entry.name,
        'Git metadata entry',
      );
      try {
        await walkGitMetadata(child);
      } finally {
        await child.close();
      }
    } else if (!entry.isFile()) {
      throw new Error('Git metadata contains an unsupported entry');
    }
  }
}

async function assertTrustedGitMetadata(workspace: string): Promise<void> {
  if (!path.isAbsolute(workspace) || path.normalize(workspace) !== workspace) {
    throw new Error('Git workspace is not canonical');
  }

  const workspaceDir = await openStableDirectory(workspace, 'Git workspace');
  try {
    const gitDir = await openStableDirectoryAt(
      workspaceDir,
      '.git',
      'Git metadata root',
    );
    try {
      for (const relativeForbidden of [
        'commondir',
        path.join('objects', 'info', 'alternates'),
      ]) {
        const forbidden = path.join(gitDir.path, relativeForbidden);
        if (await openStableFileIfExists(forbidden)) {
          throw new Error('Git metadata contains an external indirection');
        }
      }

      await walkGitMetadata(gitDir);
    } finally {
      await gitDir.close();
    }
  } finally {
    await workspaceDir.close();
  }
}

function trustedGithubRepoUrl(repo: string): string {
  validateCodingRepoSlug(repo);
  return `https://github.com/${repo}.git`;
}

function assertSafeGitPath(value: string, workspace: string): string {
  if (
    !value ||
    path.isAbsolute(value) ||
    value.includes('\0') ||
    value.split(/[\\/]/).includes('..')
  ) {
    throw new Error('Git staging returned an unsafe path');
  }
  const candidate = path.resolve(workspace, value);
  const relative = path.relative(workspace, candidate);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Git staging path escapes the workspace');
  }
  return candidate;
}

interface FilterFreeWorkspaceState {
  indexRecords: string;
  changedFiles: string[];
  untrackedFiles: string[];
}

async function collectFilterFreeWorkspaceState(
  input: Pick<CodingWorkspacePublicationInput, 'workspace' | 'assertOwnership'>,
  deps: Pick<CodingWorkspaceDeps, 'git'> & {
    lstat?(value: string): Promise<fs.Stats>;
    readlink?(value: string): Promise<string>;
  },
  writeObjects: boolean,
): Promise<FilterFreeWorkspaceState> {
  input.assertOwnership();
  const trackedList = await runLocalGit(
    deps.git,
    ['ls-files', '--stage', '--cached', '-z'],
    input.workspace,
    'Git tracked-file inventory',
  );
  input.assertOwnership();
  const untrackedList = await runLocalGit(
    deps.git,
    ['ls-files', '--others', '--exclude-standard', '-z'],
    input.workspace,
    'Git untracked-file inventory',
  );
  const entries = new Map<
    string,
    { mode: string; objectId: string; stage: string } | null
  >();
  for (const rawEntry of trackedList.stdout.split('\0').filter(Boolean)) {
    const tracked = rawEntry.match(
      /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t([\s\S]+)$/,
    );
    if (!tracked) throw new Error('Git tracked-file inventory was malformed');
    const [, mode, objectId, stage, filePath] = tracked;
    if (!entries.has(filePath!) || stage === '0') {
      entries.set(filePath!, {
        mode: mode!,
        objectId: objectId!,
        stage: stage!,
      });
    }
  }
  const untrackedFiles = untrackedList.stdout.split('\0').filter(Boolean);
  for (const filePath of untrackedFiles) entries.set(filePath, null);

  const indexRecords: string[] = [];
  const changedFiles: string[] = [];
  const lstat = deps.lstat ?? fs.promises.lstat;
  const readlink = deps.readlink ?? fs.promises.readlink;
  for (const [filePath, tracked] of entries) {
    const candidate = assertSafeGitPath(filePath, input.workspace);
    if (tracked) {
      indexRecords.push(
        `0 ${'0'.repeat(tracked.objectId.length)}\t${filePath}\0`,
      );
    }
    let stats: fs.Stats;
    try {
      stats = await lstat(candidate);
    } catch (error) {
      if (isMissing(error)) {
        if (tracked) changedFiles.push(filePath);
        continue;
      }
      throw new Error('Unable to inspect Git staging path', {
        // Filesystem errors may contain host paths outside the approved output.
        // eslint-disable-next-line preserve-caught-error
        cause: new Error('Git staging path inspection failed'),
      });
    }

    if (stats.isDirectory() && tracked?.mode === '160000') {
      indexRecords.push(`160000 commit ${tracked.objectId}\t${filePath}\0`);
      if (tracked.stage !== '0') changedFiles.push(filePath);
      continue;
    }

    let mode: '100644' | '100755' | '120000';
    let hashArgs: readonly string[];
    let stdin: string | undefined;
    if (stats.isSymbolicLink()) {
      mode = '120000';
      hashArgs = [
        'hash-object',
        ...(writeObjects ? ['-w'] : []),
        '--no-filters',
        '--stdin',
      ];
      try {
        stdin = await readlink(candidate);
      } catch (error) {
        void error;
        throw new Error('Unable to read Git staging symlink', {
          // Filesystem errors may contain host paths outside the approved output.
          // eslint-disable-next-line preserve-caught-error
          cause: new Error('Git staging symlink read failed'),
        });
      }
    } else if (stats.isFile()) {
      mode = stats.mode & 0o111 ? '100755' : '100644';
      hashArgs = [
        'hash-object',
        ...(writeObjects ? ['-w'] : []),
        '--no-filters',
        '--',
        filePath,
      ];
    } else {
      throw new Error(
        'Git staging supports only files, symlinks, and gitlinks',
      );
    }

    input.assertOwnership();
    const hashed = await runLocalGit(
      deps.git,
      hashArgs,
      input.workspace,
      'Git filter-free object staging',
      stdin,
    );
    const objectId = hashed.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/i.test(objectId)) {
      throw new Error('Git object staging returned an invalid object');
    }
    indexRecords.push(`${mode} blob ${objectId}\t${filePath}\0`);
    if (
      tracked &&
      (tracked.stage !== '0' ||
        tracked.mode !== mode ||
        tracked.objectId !== objectId)
    ) {
      changedFiles.push(filePath);
    }
  }

  return {
    indexRecords: indexRecords.join(''),
    changedFiles,
    untrackedFiles,
  };
}

async function stageCodingWorkspaceWithoutFilters(
  input: Pick<CodingWorkspacePublicationInput, 'workspace' | 'assertOwnership'>,
  deps: Pick<CodingWorkspaceDeps, 'git'> & {
    lstat?(value: string): Promise<fs.Stats>;
    readlink?(value: string): Promise<string>;
  },
): Promise<void> {
  const state = await collectFilterFreeWorkspaceState(input, deps, true);
  input.assertOwnership();
  await runLocalGit(
    deps.git,
    ['update-index', '-z', '--index-info'],
    input.workspace,
    'Git filter-free index update',
    state.indexRecords,
  );
}

export async function publishCodingWorkspace(
  input: CodingWorkspacePublicationInput,
  deps: Pick<CodingWorkspaceDeps, 'git' | 'createAskpass'> & {
    validateGitMetadata?(workspace: string): Promise<void>;
  },
): Promise<CodingWorkspacePublicationResult> {
  if (
    !path.isAbsolute(input.workspace) ||
    path.normalize(input.workspace) !== input.workspace
  ) {
    throw new Error('Coding workspace publication path must be canonical');
  }
  validateCodingBranch(input.branch);
  const trustedRemote = trustedGithubRepoUrl(input.repo);
  if (!input.commitMessage.trim()) {
    throw new Error('Coding workspace commit message is required');
  }

  await (deps.validateGitMetadata ?? assertTrustedGitMetadata)(input.workspace);
  input.assertOwnership();
  await stageCodingWorkspaceWithoutFilters(input, deps);
  input.assertOwnership();
  const currentBranch = await runLocalGit(
    deps.git,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    input.workspace,
    'Git branch verification',
  );
  if (currentBranch.stdout.trim() !== input.branch) {
    throw new Error(
      'Git publication branch no longer matches the approved job',
    );
  }
  input.assertOwnership();
  const tree = await runLocalGit(
    deps.git,
    ['write-tree'],
    input.workspace,
    'Git tree creation',
  );
  const treeId = tree.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(treeId)) {
    throw new Error('Git tree creation returned an invalid object');
  }
  input.assertOwnership();
  const parent = await runLocalGit(
    deps.git,
    ['rev-parse', '--verify', 'HEAD'],
    input.workspace,
    'Git parent revision lookup',
  );
  const parentSha = parent.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(parentSha)) {
    throw new Error('Git parent revision lookup returned an invalid commit');
  }
  input.assertOwnership();
  const signingPolicy = input.commitSigningPolicy || 'off';
  const signingKey = input.signingKey?.trim();
  if (signingPolicy === 'require' && !signingKey) {
    throw new Error(
      'Commit signing is required but no host signing key is configured',
    );
  }
  if (signingKey && !/^[A-Za-z0-9_.@:+/-]{1,128}$/.test(signingKey)) {
    throw new Error('Configured commit signing key id is invalid');
  }
  const commitArgs = [
    'commit-tree',
    treeId,
    '-p',
    parentSha,
    ...(signingPolicy === 'off'
      ? ['--no-gpg-sign']
      : [signingKey ? `--gpg-sign=${signingKey}` : '--gpg-sign']),
    '-m',
    input.commitMessage,
  ];
  let signingStatus: CodingCommitSigningStatus =
    signingPolicy === 'off' ? 'unsigned' : 'signed';
  let signingWarning: string | undefined;
  let commit;
  try {
    commit = await runLocalGit(
      deps.git,
      commitArgs,
      input.workspace,
      'Git commit creation',
    );
  } catch (err) {
    if (signingPolicy !== 'prefer') throw err;
    const message = err instanceof Error ? err.message : String(err);
    signingStatus = 'preferred-unsigned';
    signingWarning = message.slice(0, 240);
    commit = await runLocalGit(
      deps.git,
      [
        'commit-tree',
        treeId,
        '-p',
        parentSha,
        '--no-gpg-sign',
        '-m',
        input.commitMessage,
      ],
      input.workspace,
      'Git unsigned fallback commit creation',
    );
  }
  let commitSha = commit.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commitSha)) {
    throw new Error('Git commit creation returned an invalid commit');
  }
  if (signingStatus === 'signed') {
    try {
      await runLocalGit(
        deps.git,
        ['verify-commit', commitSha],
        input.workspace,
        'Git commit signature verification',
      );
    } catch (err) {
      if (signingPolicy === 'require') {
        throw new Error('Required commit signature verification failed', {
          cause: err,
        });
      }
      signingStatus = 'preferred-unsigned';
      signingWarning = 'commit signature verification failed';
      const fallbackCommit = await runLocalGit(
        deps.git,
        [
          'commit-tree',
          treeId,
          '-p',
          parentSha,
          '--no-gpg-sign',
          '-m',
          input.commitMessage,
        ],
        input.workspace,
        'Git unsigned fallback commit creation',
      );
      commitSha = fallbackCommit.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/i.test(commitSha)) {
        throw new Error('Git unsigned fallback returned an invalid commit', {
          cause: err,
        });
      }
    }
  }
  input.assertOwnership();
  await runLocalGit(
    deps.git,
    ['update-ref', `refs/heads/${input.branch}`, commitSha, parentSha],
    input.workspace,
    'Git branch update',
  );
  input.assertOwnership();
  const push = await runApprovedHostGit(
    [
      'push',
      trustedRemote,
      `${input.branch}:refs/heads/${input.branch}`,
      '--force-with-lease',
    ],
    {
      cwd: input.workspace,
      token: input.token,
      git: deps.git,
      createAskpass: deps.createAskpass ?? createTemporaryAskpass,
      jobId: input.jobId,
      attemptId: input.attemptId,
    },
  );
  requireGitSuccess(push, 'Approved Git push');
  return {
    commitSha,
    signingStatus,
    ...(signingWarning ? { signingWarning } : {}),
  };
}

export async function deleteCodingWorkspaceBranch(
  input: {
    workspace: string;
    repo: string;
    branch: string;
    token: string;
    jobId?: string;
    attemptId?: string;
  },
  deps: Pick<CodingWorkspaceDeps, 'git' | 'createAskpass'> & {
    validateGitMetadata?(workspace: string): Promise<void>;
  },
): Promise<void> {
  if (
    !path.isAbsolute(input.workspace) ||
    path.normalize(input.workspace) !== input.workspace
  ) {
    throw new Error('Coding workspace deletion path must be canonical');
  }
  validateCodingBranch(input.branch);
  const trustedRemote = trustedGithubRepoUrl(input.repo);
  await (deps.validateGitMetadata ?? assertTrustedGitMetadata)(input.workspace);
  const result = await runApprovedHostGit(
    ['push', trustedRemote, `:${input.branch}`],
    {
      cwd: input.workspace,
      token: input.token,
      git: deps.git,
      createAskpass: deps.createAskpass ?? createTemporaryAskpass,
      jobId: input.jobId,
      attemptId: input.attemptId,
    },
  );
  requireGitSuccess(result, 'Approved Git branch deletion');
}

export async function collectCodingWorkspaceEvidence(
  workspace: string,
  deps: Pick<CodingWorkspaceDeps, 'git'> & {
    lstat?(value: string): Promise<fs.Stats>;
    readlink?(value: string): Promise<string>;
    validateGitMetadata?(workspace: string): Promise<void>;
  },
): Promise<CodingWorkspaceEvidence> {
  if (!path.isAbsolute(workspace) || path.normalize(workspace) !== workspace) {
    throw new Error('Coding workspace evidence path must be canonical');
  }
  await (deps.validateGitMetadata ?? assertTrustedGitMetadata)(workspace);
  const state = await collectFilterFreeWorkspaceState(
    { workspace, assertOwnership: () => undefined },
    deps,
    false,
  );
  const staged = await runLocalGit(
    deps.git,
    [
      'diff',
      '--cached',
      '--no-ext-diff',
      '--no-textconv',
      '--name-only',
      'HEAD',
    ],
    workspace,
    'Git staged-file evidence collection',
  );
  const changedFiles = [
    ...new Set([
      ...state.changedFiles,
      ...staged.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ]),
  ];
  const changedCount = changedFiles.length + state.untrackedFiles.length;
  return {
    diffStat: `${changedCount} ${changedCount === 1 ? 'file' : 'files'} changed (filter-free evidence)`,
    changedFiles,
    untrackedFiles: state.untrackedFiles,
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
      jobId: input.jobId,
      attemptId: input.attemptId,
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
      jobId: input.jobId,
      attemptId: input.attemptId,
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
