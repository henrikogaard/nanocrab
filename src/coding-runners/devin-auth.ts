import fs from 'node:fs';
import path from 'node:path';

export interface DevinCredentialHandoffSuccess {
  ok: true;
  dataHome: string;
}

export interface DevinSandboxAuthProbeLaunch {
  executable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  args: string[];
}

export interface DevinCredentialHandoffFailure {
  ok: false;
  reason: string;
}

export type DevinCredentialHandoffResult =
  | DevinCredentialHandoffSuccess
  | DevinCredentialHandoffFailure;

export interface DevinCredentialHandoffDependencies {
  lstat(value: string): fs.Stats;
  realpath(value: string): string;
  getuid(): number;
}

const defaultDevinCredentialHandoffDependencies: DevinCredentialHandoffDependencies =
  {
    lstat: (value) => fs.lstatSync(value),
    realpath: (value) => fs.realpathSync(value),
    getuid: () => process.getuid?.() ?? -1,
  };

function isCanonicalPath(value: string): boolean {
  return (
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    path.normalize(value) === value &&
    value !== path.parse(value).root
  );
}

/**
 * Return the XDG_DATA_HOME directory that should be set when launching the
 * Devin CLI so it can locate its own credential at
 * `<dataHome>/devin/credentials.toml`. Requiring that exact layout prevents
 * validating one file while the CLI reads a different credential file from
 * the mounted `devin/` directory.
 */
export function getDevinCredentialDataHome(credentialPath: string): string {
  if (!isCanonicalPath(credentialPath)) {
    throw new Error('Credential path must be canonical');
  }
  const normalized = path.normalize(credentialPath);
  if (
    path.basename(normalized) !== 'credentials.toml' ||
    path.basename(path.dirname(normalized)) !== 'devin'
  ) {
    throw new Error('Credential path must end with devin/credentials.toml');
  }
  return path.dirname(path.dirname(normalized));
}

function sandboxDirectoryArgs(values: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const value of values) {
    let current = path.dirname(value);
    while (current !== path.parse(current).root) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return [...directories]
    .sort((left, right) => left.length - right.length)
    .flatMap((directory) => ['--dir', directory]);
}

/** Build the actual sandboxed `devin auth status` readiness probe. */
export function buildDevinSandboxAuthProbe(input: {
  platform: NodeJS.Platform;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  devinExecutable: string;
  credentialPath: string;
  trustedRuntimeReadRoots: readonly string[];
}): DevinSandboxAuthProbeLaunch {
  const dataHome = getDevinCredentialDataHome(input.credentialPath);
  const credentialDirectory = path.dirname(input.credentialPath);

  if (
    input.platform === 'linux' &&
    input.sandboxExecutable === '/usr/bin/bwrap'
  ) {
    const mountRoots = [...input.trustedRuntimeReadRoots, credentialDirectory];
    return {
      executable: input.sandboxExecutable,
      args: [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--unshare-net',
        '--tmpfs',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        ...sandboxDirectoryArgs(mountRoots),
        ...input.trustedRuntimeReadRoots.flatMap((root) => [
          '--ro-bind',
          root,
          root,
        ]),
        '--ro-bind',
        credentialDirectory,
        credentialDirectory,
        '--chdir',
        dataHome,
        '--',
        input.devinExecutable,
        'auth',
        'status',
      ],
    };
  }

  if (
    input.platform === 'darwin' &&
    input.sandboxExecutable === '/usr/bin/sandbox-exec'
  ) {
    const readableRoots = [
      '/System',
      '/Library',
      '/usr/lib',
      '/usr/share',
      '/private/etc',
      '/dev',
      ...input.trustedRuntimeReadRoots,
      credentialDirectory,
    ];
    const profile = [
      '(version 1)',
      '(deny default)',
      '(allow process-exec)',
      '(allow process-fork)',
      '(deny network*)',
      `(allow file-read* ${readableRoots
        .map(
          (root) =>
            `(literal ${JSON.stringify(root)}) (subpath ${JSON.stringify(root)})`,
        )
        .join(' ')})`,
      `(deny file-write* (literal ${JSON.stringify(credentialDirectory)}) (subpath ${JSON.stringify(credentialDirectory)}))`,
      '(allow file-write-data (literal "/dev/null"))',
    ].join(' ');
    return {
      executable: input.sandboxExecutable,
      args: ['-p', profile, '--', input.devinExecutable, 'auth', 'status'],
    };
  }

  throw new Error('Devin sandbox authentication probe is unsupported');
}

/**
 * Synchronously validate that a Devin credential handoff path is safe to use.
 *
 * NanoCrab must never read, copy, or serialize the credential file contents.
 * This function only inspects path shape and filesystem metadata.
 */
export function validateDevinCredentialHandoff(
  credentialPath: string | null | undefined,
  deps: DevinCredentialHandoffDependencies = defaultDevinCredentialHandoffDependencies,
): DevinCredentialHandoffResult {
  if (!credentialPath) {
    return { ok: false, reason: 'DEVIN_CREDENTIAL_PATH is not configured' };
  }
  if (!isCanonicalPath(credentialPath)) {
    return {
      ok: false,
      reason:
        'DEVIN_CREDENTIAL_PATH must be an absolute, canonical path with no .. or symlink components',
    };
  }

  try {
    const initial = deps.lstat(credentialPath);
    if (initial.isSymbolicLink() || !initial.isFile()) {
      return {
        ok: false,
        reason:
          'DEVIN_CREDENTIAL_PATH must be a regular file, not a symlink or directory',
      };
    }

    const canonical = deps.realpath(credentialPath);
    if (canonical !== credentialPath) {
      return {
        ok: false,
        reason: 'DEVIN_CREDENTIAL_PATH resolves to a different canonical path',
      };
    }

    const final = deps.lstat(credentialPath);
    if (
      final.isSymbolicLink() ||
      !final.isFile() ||
      final.uid !== deps.getuid() ||
      (final.mode & 0o777) !== 0o600 ||
      initial.dev !== final.dev ||
      initial.ino !== final.ino
    ) {
      return {
        ok: false,
        reason:
          'DEVIN_CREDENTIAL_PATH must be a regular file owned by the service user with mode 0600',
      };
    }

    return { ok: true, dataHome: getDevinCredentialDataHome(credentialPath) };
  } catch (error) {
    const reason =
      error && typeof error === 'object' && 'message' in error
        ? (error as Error).message
        : String(error);
    return {
      ok: false,
      reason: `Credential handoff validation failed: ${reason}`,
    };
  }
}
