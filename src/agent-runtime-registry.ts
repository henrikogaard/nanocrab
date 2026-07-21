import { execFile } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'util';

import type { AgentProvider } from './agent-provider.js';
import { DEVIN_CLI_MODEL_ALIASES, DEVIN_CREDENTIAL_PATH } from './config.js';
import {
  buildDevinChildEnvironment,
  DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
} from './coding-runners/devin-host.js';
import {
  buildDevinSandboxAuthProbe,
  getDevinCredentialDataHome,
  validateDevinCredentialHandoff,
  type DevinCredentialHandoffResult,
} from './coding-runners/devin-auth.js';

export { DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL } from './coding-runners/devin-host.js';
import type {
  AgentCliId,
  AgentRuntimeHealth,
  AgentRuntimeSelection,
} from './types.js';

const execFileAsync = promisify(execFile);
const DEVIN_PROBE_TIMEOUT_MS = 10_000;
const DEVIN_REQUIRED_CAPABILITIES = [
  '--prompt-file',
  '--model',
  '--permission-mode',
  '--sandbox',
  '--agent-config',
  '--respect-workspace-trust',
  '-p',
] as const;

export interface VerifiedDevinRuntimeContext {
  readonly executable: string;
  readonly nodeExecutable: string;
  readonly sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
  readonly trustedRuntimeReadRoots: readonly string[];
  readonly trustedRuntimeReadFiles?: readonly string[];
}

export interface DevinSandboxAuthHandoffEnvironment {
  platform?: NodeJS.Platform;
  credentialPath?: string | null;
  sandboxPath?: string;
  validate?: (credentialPath: string) => DevinCredentialHandoffResult;
  sandboxAccessible?: (sandboxExecutable: string) => boolean;
}

function defaultSandboxAccessible(sandboxExecutable: string): boolean {
  try {
    fs.accessSync(sandboxExecutable, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return true only when a canonical, service-user-owned, mode-0600 credential
 * file is configured and the platform sandbox executable is available. This
 * function never reads the credential file contents.
 */
export function isDevinSandboxAuthHandoffAvailable(
  deps: DevinSandboxAuthHandoffEnvironment = {},
): boolean {
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux' && platform !== 'darwin') {
    return false;
  }

  const credentialPath = deps.credentialPath ?? DEVIN_CREDENTIAL_PATH;
  if (!credentialPath) {
    return false;
  }

  const sandboxExecutable =
    deps.sandboxPath ??
    (platform === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec');

  const validation = (deps.validate ?? validateDevinCredentialHandoff)(
    credentialPath,
  );
  if (!validation.ok) {
    return false;
  }

  if (
    !(deps.sandboxAccessible ?? defaultSandboxAccessible)(sandboxExecutable)
  ) {
    return false;
  }

  return true;
}

interface VerifiedDevinState {
  readonly aliases: ReadonlySet<string>;
  readonly context: VerifiedDevinRuntimeContext;
}

let verifiedDevinState: VerifiedDevinState | null = null;

export interface DevinProbeDependencies {
  execFile: (
    executable: string,
    args: readonly string[],
    options: { env: NodeJS.ProcessEnv; timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  realpath(value: string): Promise<string>;
  stat(value: string): Promise<fs.Stats>;
  lstat(value: string): Promise<fs.Stats>;
  getuid(): number;
  platform: NodeJS.Platform;
  commandAvailable(
    command: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec',
  ): Promise<boolean>;
  env: NodeJS.ProcessEnv;
  credentialPath: string | null;
  resolveExecutable(
    command: 'devin',
    searchDirectories: readonly string[],
  ): Promise<string | null>;
  executableSearchDirectories: readonly string[];
  nodeExecutable: string;
  trustedRuntimeRootCandidates: readonly string[];
  trustedRuntimeReadFileCandidates?: readonly string[];
}

export function getVerifiedDevinAliases(): ReadonlySet<string> {
  return new Set(verifiedDevinState?.aliases ?? []);
}

export function getVerifiedDevinRuntimeContext(): VerifiedDevinRuntimeContext | null {
  if (!verifiedDevinState) return null;
  return {
    ...verifiedDevinState.context,
    trustedRuntimeReadRoots: [
      ...verifiedDevinState.context.trustedRuntimeReadRoots,
    ],
    trustedRuntimeReadFiles: verifiedDevinState.context.trustedRuntimeReadFiles
      ? [...verifiedDevinState.context.trustedRuntimeReadFiles]
      : [],
  };
}

export function inferLegacyRunnerCli(provider: AgentProvider): AgentCliId {
  if (provider === 'claude' || provider === 'codex' || provider === 'pi') {
    return provider;
  }
  if (provider === 'mistral') return 'mistral';
  return 'opencode';
}

export function resolveDevinCliModelAlias(
  runtime: AgentRuntimeSelection,
  aliases: Readonly<Record<string, string>> = DEVIN_CLI_MODEL_ALIASES,
  advertisedAliases?: ReadonlySet<string>,
): string {
  const key = `${runtime.provider}/${runtime.model}`;
  const alias = aliases[key];
  if (!alias) {
    throw new Error(`no configured Devin CLI model alias for ${key}`);
  }
  if (advertisedAliases && !advertisedAliases.has(alias)) {
    throw new Error(`Devin CLI model alias ${alias} is not advertised`);
  }
  return alias;
}

const COMPATIBLE_CODING_PROVIDERS: Readonly<
  Partial<Record<AgentCliId, ReadonlySet<AgentProvider>>>
> = Object.freeze({
  claude: new Set<AgentProvider>(['claude']),
  codex: new Set<AgentProvider>(['codex']),
  opencode: new Set<AgentProvider>([
    'opencode',
    'openrouter',
    'ollama',
    'openai-compatible',
  ]),
  pi: new Set<AgentProvider>(['pi']),
  mistral: new Set<AgentProvider>(['mistral']),
});

export function validateCodingRuntimeSelection(
  runtime: AgentRuntimeSelection,
  options?: {
    aliases?: Readonly<Record<string, string>>;
    advertisedDevinAliases?: ReadonlySet<string>;
  },
): void {
  if (runtime.cli === 'devin') {
    resolveDevinCliModelAlias(
      runtime,
      options?.aliases,
      options?.advertisedDevinAliases,
    );
    return;
  }

  if (!COMPATIBLE_CODING_PROVIDERS[runtime.cli]?.has(runtime.provider)) {
    throw new Error(
      `coding runtime CLI ${runtime.cli} is not compatible with provider ${runtime.provider}`,
    );
  }
}

export interface AgentRuntimeDefinition {
  readonly cli: AgentCliId;
  readonly executable: string;
  readonly versionArgs: readonly string[];
  readonly codingRunnerSupported: boolean;
  readonly detail?: string;
}

const RUNTIMES: Record<AgentCliId, AgentRuntimeDefinition> = {
  claude: Object.freeze({
    cli: 'claude',
    executable: 'claude',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  }),
  codex: Object.freeze({
    cli: 'codex',
    executable: 'codex',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  }),
  pi: Object.freeze({
    cli: 'pi',
    executable: 'pi',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  }),
  opencode: {
    cli: 'opencode',
    executable: 'opencode',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  },
  devin: Object.freeze({
    cli: 'devin',
    executable: 'devin',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  }),
  mistral: Object.freeze({
    cli: 'mistral',
    executable: 'vibe',
    versionArgs: Object.freeze(['--version']),
    codingRunnerSupported: true,
  }),
};
Object.freeze(RUNTIMES.opencode);
Object.freeze(RUNTIMES);

function copyDefinition(
  definition: AgentRuntimeDefinition,
): AgentRuntimeDefinition {
  return {
    ...definition,
    versionArgs: [...definition.versionArgs],
  };
}

export function listAgentRuntimeDefinitions(): AgentRuntimeDefinition[] {
  return Object.values(RUNTIMES).map(copyDefinition);
}

export function getAgentRuntimeDefinition(
  cli: AgentCliId,
): AgentRuntimeDefinition | undefined {
  const definition = RUNTIMES[cli];
  return definition ? copyDefinition(definition) : undefined;
}

export function isAgentCliId(value: string): value is AgentCliId {
  return Object.prototype.hasOwnProperty.call(RUNTIMES, value);
}

export async function probeAgentRuntime(
  cli: AgentCliId,
  options?: {
    execFile?: typeof execFileAsync;
    devinDependencies?: DevinProbeDependencies;
  },
): Promise<AgentRuntimeHealth> {
  const definition = RUNTIMES[cli];
  if (!definition) {
    return {
      cli,
      executable: cli,
      status: 'error',
      version: null,
      checkedAt: new Date().toISOString(),
      detail: `Unknown CLI id: ${cli}`,
    };
  }

  if (cli === 'devin') {
    if (!isDevinSandboxAuthHandoffAvailable()) {
      clearVerifiedDevinState();
      return devinHealth(
        'error',
        DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
        new Date().toISOString(),
      );
    }
    return probeDevinRuntime(
      options?.devinDependencies ?? defaultDevinProbeDependencies(),
    );
  }

  const runner = options?.execFile ?? execFileAsync;
  const checkedAt = new Date().toISOString();

  try {
    const { stdout } = await runner(
      definition.executable,
      [...definition.versionArgs],
      {
        timeout: 10000,
      },
    );
    const version = parseVersion(stdout.trim());

    if (!definition.codingRunnerSupported) {
      return {
        cli: definition.cli,
        executable: definition.executable,
        status: 'unsupported',
        version,
        checkedAt,
        detail:
          definition.detail ||
          `${definition.cli} is installed but not supported by the current coding-job runner`,
      };
    }

    return {
      cli: definition.cli,
      executable: definition.executable,
      status: 'healthy',
      version,
      checkedAt,
      detail: `version ${version || 'unknown'}`,
    };
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };

    if (error.code === 'ENOENT') {
      return {
        cli: definition.cli,
        executable: definition.executable,
        status: 'missing',
        version: null,
        checkedAt,
        detail: `executable ${definition.executable} not found`,
      };
    }

    if (error.code === 'EACCES') {
      return {
        cli: definition.cli,
        executable: definition.executable,
        status: 'error',
        version: null,
        checkedAt,
        detail: `permission denied for ${definition.executable}`,
      };
    }

    return {
      cli: definition.cli,
      executable: definition.executable,
      status: 'error',
      version: null,
      checkedAt,
      detail: error.message || String(err),
    };
  }
}

function devinHealth(
  status: AgentRuntimeHealth['status'],
  detail: string,
  checkedAt: string,
  version: string | null = null,
): AgentRuntimeHealth {
  return {
    cli: 'devin',
    executable: 'devin',
    status,
    version,
    checkedAt,
    detail,
  };
}

function clearVerifiedDevinState(): void {
  verifiedDevinState = null;
}

function parseAdvertisedDevinModelExamples(help: string): Set<string> {
  const lines = help.split(/\r?\n/);
  const modelOptionStart = lines.findIndex((line) =>
    /^\s*--model(?:\s|[=<]|$)/.test(line),
  );
  if (modelOptionStart < 0) return new Set();

  const modelBlock: string[] = [];
  for (let index = modelOptionStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > modelOptionStart && /^\s*-{1,2}[a-z0-9]/i.test(line)) {
      break;
    }
    modelBlock.push(line);
  }

  const aliases = new Set<string>();
  for (const line of modelBlock) {
    if (!/examples?\s*:/i.test(line)) continue;
    const examples = line
      .replace(/^.*?examples?\s*:/i, '')
      .replace(/[()]/g, ' ');
    for (const token of examples.split(/[\s,|]+/)) {
      const alias = token.trim();
      if (/^[a-z0-9][a-z0-9._-]*$/i.test(alias)) aliases.add(alias);
    }
  }
  return aliases;
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

async function verifyDevinRuntimeContext(
  deps: DevinProbeDependencies,
  sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec',
): Promise<VerifiedDevinRuntimeContext | null> {
  if (
    deps.executableSearchDirectories.length === 0 ||
    deps.executableSearchDirectories.some(
      (directory) => !path.isAbsolute(directory),
    )
  ) {
    return null;
  }
  const resolvedDevin = await deps.resolveExecutable(
    'devin',
    deps.executableSearchDirectories,
  );
  if (!resolvedDevin || !path.isAbsolute(resolvedDevin)) return null;

  const canonicalDevin = await deps.realpath(resolvedDevin);
  const canonicalNode = await deps.realpath(deps.nodeExecutable);
  const canonicalSandbox = await deps.realpath(sandboxExecutable);
  if (
    canonicalDevin !== resolvedDevin ||
    canonicalNode !== deps.nodeExecutable ||
    canonicalSandbox !== sandboxExecutable
  ) {
    return null;
  }

  const canonicalRoots: string[] = [];
  for (const candidate of deps.trustedRuntimeRootCandidates) {
    if (
      !path.isAbsolute(candidate) ||
      path.parse(candidate).root === candidate
    ) {
      return null;
    }
    try {
      const canonical = await deps.realpath(candidate);
      const stats = await deps.stat(canonical);
      if (canonical !== candidate || !stats.isDirectory()) continue;
      if (!canonicalRoots.includes(canonical)) canonicalRoots.push(canonical);
    } catch {
      // Candidates are platform-specific; only verified existing roots survive.
    }
  }

  const executables = [canonicalDevin, canonicalNode, canonicalSandbox];
  const trustedRoots = canonicalRoots.filter(
    (root) =>
      !canonicalRoots.some(
        (other) => other !== root && isAtOrBelow(root, other),
      ),
  );
  for (const executable of executables) {
    const stats = await deps.stat(executable);
    if (
      !stats.isFile() ||
      (stats.mode & 0o111) === 0 ||
      !trustedRoots.some((root) => isAtOrBelow(executable, root))
    ) {
      return null;
    }
  }

  const trustedRuntimeReadFiles: string[] = [];
  for (const candidate of deps.trustedRuntimeReadFileCandidates ?? []) {
    if (
      !path.isAbsolute(candidate) ||
      path.parse(candidate).root === candidate
    ) {
      return null;
    }
    try {
      const canonical = await deps.realpath(candidate);
      const stats = await deps.stat(canonical);
      if (canonical !== candidate || !stats.isFile()) continue;
      if (!trustedRuntimeReadFiles.includes(canonical)) {
        trustedRuntimeReadFiles.push(canonical);
      }
    } catch {
      // Platform-specific files are optional when absent on the host.
    }
  }

  return {
    executable: canonicalDevin,
    nodeExecutable: canonicalNode,
    sandboxExecutable,
    trustedRuntimeReadRoots: trustedRoots,
    trustedRuntimeReadFiles,
  };
}

function helpAdvertisesCapability(help: string, capability: string): boolean {
  const escaped = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|[=<]|$)`, 'm').test(help);
}

export async function probeDevinRuntime(
  deps: DevinProbeDependencies,
): Promise<AgentRuntimeHealth> {
  const checkedAt = new Date().toISOString();
  if (deps.credentialPath === null) {
    clearVerifiedDevinState();
    return devinHealth(
      'error',
      'Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user',
      checkedAt,
    );
  }

  const fail = (detail: string, version: string | null = null) => {
    clearVerifiedDevinState();
    return devinHealth('error', detail, checkedAt, version);
  };
  const credentialPath = deps.credentialPath;
  if (!path.isAbsolute(credentialPath)) {
    return fail(
      'Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user',
    );
  }
  let credentialDataHome: string;
  try {
    credentialDataHome = getDevinCredentialDataHome(credentialPath);
  } catch {
    return fail('DEVIN_CREDENTIAL_PATH must end with devin/credentials.toml');
  }
  if (deps.platform !== 'linux' && deps.platform !== 'darwin') {
    return fail('Devin host runner requires Linux or macOS sandbox support');
  }

  try {
    const initialLinkStats = await deps.lstat(credentialPath);
    if (initialLinkStats.isSymbolicLink()) {
      return fail(
        'DEVIN_CREDENTIAL_PATH must be a canonical service-user-owned regular file with mode 0600',
      );
    }
    const canonicalPath = await deps.realpath(credentialPath);
    const fileStats = await deps.stat(credentialPath);
    const finalLinkStats = await deps.lstat(credentialPath);
    if (
      canonicalPath !== credentialPath ||
      finalLinkStats.isSymbolicLink() ||
      !initialLinkStats.isFile() ||
      !finalLinkStats.isFile() ||
      initialLinkStats.dev !== fileStats.dev ||
      initialLinkStats.ino !== fileStats.ino ||
      finalLinkStats.dev !== fileStats.dev ||
      finalLinkStats.ino !== fileStats.ino ||
      !fileStats.isFile() ||
      fileStats.uid !== deps.getuid() ||
      (fileStats.mode & 0o777) !== 0o600
    ) {
      return fail(
        'DEVIN_CREDENTIAL_PATH must be a canonical service-user-owned regular file with mode 0600',
      );
    }
  } catch {
    return fail(
      'DEVIN_CREDENTIAL_PATH must be a canonical service-user-owned regular file with mode 0600',
    );
  }

  const sandboxExecutable =
    deps.platform === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec';
  let sandboxAvailable = false;
  try {
    sandboxAvailable = await deps.commandAvailable(sandboxExecutable);
  } catch {
    sandboxAvailable = false;
  }
  if (!sandboxAvailable) {
    return fail(
      `Required sandbox executable ${sandboxExecutable} is unavailable`,
    );
  }

  const baseEnv = buildDevinChildEnvironment(deps.env);
  const options = { env: baseEnv, timeout: DEVIN_PROBE_TIMEOUT_MS };
  let runtimeContext: VerifiedDevinRuntimeContext | null;
  try {
    runtimeContext = await verifyDevinRuntimeContext(deps, sandboxExecutable);
  } catch {
    runtimeContext = null;
  }
  if (!runtimeContext) {
    return fail(
      'Devin Node and sandbox executables must be canonical executable files inside trusted runtime roots',
    );
  }

  let version: string | null = null;
  try {
    const versionResult = await deps.execFile(
      runtimeContext.executable,
      ['--version'],
      options,
    );
    version = parseVersion(versionResult.stdout);
    const helpResult = await deps.execFile(
      runtimeContext.executable,
      ['--help'],
      options,
    );
    if (
      DEVIN_REQUIRED_CAPABILITIES.some(
        (capability) =>
          !helpAdvertisesCapability(helpResult.stdout, capability),
      )
    ) {
      return fail(
        'Installed Devin CLI lacks required host-runner capabilities',
        version,
      );
    }

    const advertised = parseAdvertisedDevinModelExamples(helpResult.stdout);
    const configuredAliases = new Set(Object.values(DEVIN_CLI_MODEL_ALIASES));
    if ([...configuredAliases].some((alias) => !advertised.has(alias))) {
      return fail(
        'Installed Devin CLI does not advertise every configured model alias',
        version,
      );
    }

    const authProbe = buildDevinSandboxAuthProbe({
      platform: deps.platform,
      sandboxExecutable,
      devinExecutable: runtimeContext.executable,
      credentialPath,
      trustedRuntimeReadRoots: runtimeContext.trustedRuntimeReadRoots,
    });
    const authEnvironment = buildDevinChildEnvironment(deps.env);
    authEnvironment.XDG_DATA_HOME = credentialDataHome;
    await deps.execFile(authProbe.executable, authProbe.args, {
      env: authEnvironment,
      timeout: DEVIN_PROBE_TIMEOUT_MS,
    });

    verifiedDevinState = Object.freeze({
      aliases: new Set(configuredAliases),
      context: Object.freeze({
        ...runtimeContext,
        trustedRuntimeReadRoots: Object.freeze([
          ...runtimeContext.trustedRuntimeReadRoots,
        ]),
        trustedRuntimeReadFiles: Object.freeze([
          ...(runtimeContext.trustedRuntimeReadFiles ?? []),
        ]),
      }),
    });
    return devinHealth(
      'healthy',
      'Devin host runner is ready',
      checkedAt,
      version,
    );
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    clearVerifiedDevinState();
    if (code === 'ENOENT') {
      return devinHealth('missing', 'executable devin not found', checkedAt);
    }
    return devinHealth(
      'error',
      'Unable to verify Devin host runner readiness',
      checkedAt,
      version,
    );
  }
}

function defaultDevinProbeDependencies(): DevinProbeDependencies {
  const childEnvironment = buildDevinChildEnvironment(process.env);
  return {
    execFile: async (executable, args, options) => {
      const result = await execFileAsync(executable, [...args], options);
      return {
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
      };
    },
    realpath: (value) => fs.promises.realpath(value),
    stat: (value) => fs.promises.stat(value),
    lstat: (value) => fs.promises.lstat(value),
    getuid: () => process.getuid?.() ?? -1,
    platform: process.platform,
    commandAvailable: async (command) => {
      try {
        await fs.promises.access(command, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    env: process.env,
    credentialPath: DEVIN_CREDENTIAL_PATH,
    resolveExecutable: async (command, searchDirectories) => {
      for (const directory of searchDirectories) {
        if (!path.isAbsolute(directory)) continue;
        const candidate = path.join(directory, command);
        try {
          const canonical = await fs.promises.realpath(candidate);
          const stats = await fs.promises.stat(canonical);
          await fs.promises.access(canonical, fs.constants.X_OK);
          if (stats.isFile()) return canonical;
        } catch {
          // Continue through the fixed scrubbed search path only.
        }
      }
      return null;
    },
    executableSearchDirectories: [
      ...new Set([
        ...(childEnvironment.PATH ?? '')
          .split(path.delimiter)
          .filter(path.isAbsolute),
        path.dirname(process.execPath),
      ]),
    ],
    nodeExecutable: process.execPath,
    trustedRuntimeRootCandidates: defaultTrustedRuntimeRootCandidates(
      childEnvironment.PATH ?? '',
      process.execPath,
    ),
    trustedRuntimeReadFileCandidates:
      process.platform === 'linux'
        ? [
            '/etc/resolv.conf',
            '/etc/hosts',
            '/etc/ssl/certs/ca-certificates.crt',
          ]
        : [],
  };
}

function defaultTrustedRuntimeRootCandidates(
  searchPath: string,
  nodeExecutable: string,
): string[] {
  const rawCandidates = [
    ...searchPath
      .split(path.delimiter)
      .filter(path.isAbsolute)
      .map((directory) => path.dirname(directory)),
    path.dirname(path.dirname(nodeExecutable)),
    '/usr/bin',
    '/lib',
    '/lib64',
  ];
  return [
    ...new Set(
      rawCandidates.filter(
        (candidate) => path.parse(candidate).root !== candidate,
      ),
    ),
  ];
}

function parseVersion(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/(\d+\.\d+(?:\.\d+)?(?:[-+.\w]+)?)/);
  return match ? match[1] : trimmed;
}

export async function probeAllAgentRuntimes(options?: {
  execFile?: typeof execFileAsync;
}): Promise<AgentRuntimeHealth[]> {
  const results: AgentRuntimeHealth[] = [];
  await Promise.allSettled(
    Object.values(RUNTIMES).map(async (def) => {
      const health = await probeAgentRuntime(def.cli, options);
      results.push(health);
    }),
  );
  return results.sort((a, b) => a.cli.localeCompare(b.cli));
}
