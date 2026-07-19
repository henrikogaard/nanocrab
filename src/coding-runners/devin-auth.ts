import fs from 'node:fs';
import path from 'node:path';

export interface DevinCredentialHandoffSuccess {
  ok: true;
  dataHome: string;
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
 * `<dataHome>/devin/credentials.toml`.
 *
 * If the configured credential path is directly inside a `devin/` directory,
 * the data home is the parent of that directory. Otherwise the data home is
 * the parent directory of the configured file, allowing operators to point at
 * a non-standard credential location.
 */
export function getDevinCredentialDataHome(credentialPath: string): string {
  if (!isCanonicalPath(credentialPath)) {
    throw new Error('Credential path must be canonical');
  }
  const normalized = path.normalize(credentialPath);
  const parts = normalized.split(path.sep);
  if (parts.length >= 2 && parts[parts.length - 2] === 'devin') {
    return path.dirname(path.dirname(normalized));
  }
  return path.dirname(normalized);
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
    return { ok: false, reason: `Credential handoff validation failed: ${reason}` };
  }
}
