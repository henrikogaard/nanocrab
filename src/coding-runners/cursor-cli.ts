import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TRUSTED_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';

export interface CursorCliInvocationInput {
  executable?: string;
  model: string;
  prompt: string;
  workspace?: string;
}

export interface CursorCliInvocation {
  executable: string;
  args: string[];
}

export interface CursorSandboxLaunchInput {
  platform: NodeJS.Platform;
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  workspace: string;
  executable: string;
  args: readonly string[];
  temporaryDirectory: string;
}

export function resolveCursorExecutable(command = 'agent'): string {
  if (command !== 'agent' && command !== 'cursor-agent') {
    throw new Error('Unsupported Cursor executable');
  }
  try {
    const resolved = execFileSync('which', [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    if (!path.isAbsolute(resolved)) {
      throw new Error('Cursor executable path is not absolute');
    }
    return resolved;
  } catch (error) {
    throw new Error(`Cursor executable ${command} was not found`, {
      cause: error,
    });
  }
}

/**
 * Build the only Cursor invocation NanoCrab supports. The prompt is passed as
 * one argv value and never through a shell, while --print makes the adapter
 * safe for host-managed, non-interactive coding jobs.
 */
export function buildCursorCliInvocation(
  input: CursorCliInvocationInput,
): CursorCliInvocation {
  if (!input.model.trim()) throw new Error('Cursor model is required');
  if (!input.prompt.trim()) throw new Error('Cursor prompt is required');
  if (input.workspace) validateCursorWorkspace(input.workspace);

  return {
    executable: input.executable || 'agent',
    args: [
      '--print',
      '--output-format',
      'text',
      '--model',
      input.model.trim(),
      '--force',
      input.prompt,
    ],
  };
}

/**
 * The Cursor CLI has no documented credential-proxy/base-URL mode. Keep the
 * API key in the host child environment and refuse to launch without an
 * explicit key; it is never serialized into a workspace or container env
 * file. The caller must still provide a verified OS isolation boundary.
 */
export function buildCursorChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const apiKey = source.CURSOR_API_KEY?.trim();
  if (!apiKey) throw new Error('CURSOR_API_KEY is not configured');

  const environment: NodeJS.ProcessEnv = {
    PATH: TRUSTED_PATH,
    CURSOR_API_KEY: apiKey,
    TERM: 'dumb',
    NO_COLOR: '1',
  };
  for (const key of ['HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  return environment;
}

/**
 * Cursor must run in a fresh host-managed coding worktree. Reject root,
 * relative, normalized-away, and metadata paths before constructing a launch.
 * Canonical filesystem checks are performed by the host runner immediately
 * before spawning to close symlink races.
 */
export function validateCursorWorkspace(workspace: string): void {
  if (
    !path.isAbsolute(workspace) ||
    path.resolve(workspace) !== workspace ||
    path.normalize(workspace) !== workspace ||
    workspace === path.parse(workspace).root
  ) {
    throw new Error('Cursor workspace must be an explicit canonical directory');
  }
  if (path.basename(workspace) === '.git') {
    throw new Error('Cursor workspace cannot be Git metadata');
  }
}

function sandboxPath(value: string): string {
  return `(literal ${JSON.stringify(value)}) (subpath ${JSON.stringify(value)})`;
}

function sandboxDirectories(values: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const value of values) {
    let current = value;
    while (current !== path.parse(current).root) {
      directories.add(current);
      current = path.dirname(current);
    }
  }
  return [...directories]
    .sort((left, right) => left.length - right.length)
    .flatMap((directory) => ['--dir', directory]);
}

/** Build a deny-by-default OS sandbox around the Cursor process. */
export function buildCursorSandboxedLaunch(input: CursorSandboxLaunchInput): {
  executable: string;
  args: string[];
} {
  validateCursorWorkspace(input.workspace);
  if (!path.isAbsolute(input.executable)) {
    throw new Error('Cursor executable must be an absolute verified path');
  }
  if (!path.isAbsolute(input.temporaryDirectory)) {
    throw new Error('Cursor temporary directory must be absolute');
  }
  const gitDir = path.join(input.workspace, '.git');
  if (
    input.platform === 'linux' &&
    input.sandboxExecutable === '/usr/bin/bwrap'
  ) {
    const runtimeRoots = [
      '/usr',
      '/usr/local',
      '/bin',
      '/lib',
      '/lib64',
      '/etc',
      path.dirname(input.executable),
    ];
    return {
      executable: input.sandboxExecutable,
      args: [
        '--die-with-parent',
        '--new-session',
        '--unshare-pid',
        '--tmpfs',
        '/',
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        ...sandboxDirectories([
          ...runtimeRoots,
          input.workspace,
          input.temporaryDirectory,
        ]),
        ...runtimeRoots.flatMap((root) => ['--ro-bind', root, root]),
        '--bind',
        input.workspace,
        input.workspace,
        '--ro-bind',
        gitDir,
        gitDir,
        '--chdir',
        input.workspace,
        '--',
        input.executable,
        ...input.args,
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
      '/usr',
      '/private/etc',
      '/dev',
      input.workspace,
      input.temporaryDirectory,
      path.dirname(input.executable),
    ];
    const profile = [
      '(version 1)',
      '(deny default)',
      '(allow process-exec)',
      '(allow process-fork)',
      '(allow network-outbound)',
      `(allow file-read* ${readableRoots.map(sandboxPath).join(' ')})`,
      `(allow file-write* (subpath ${JSON.stringify(input.workspace)}) (subpath ${JSON.stringify(input.temporaryDirectory)}))`,
      `(deny file-write* ${sandboxPath(gitDir)})`,
      '(allow file-write-data (literal "/dev/null"))',
    ].join(' ');
    return {
      executable: input.sandboxExecutable,
      args: ['-p', profile, '--', input.executable, ...input.args],
    };
  }
  throw new Error('Cursor OS sandbox is unsupported on this platform');
}
