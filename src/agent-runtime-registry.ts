import { execFile } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'util';

import type { AgentProvider } from './agent-provider.js';
import { DEVIN_CLI_MODEL_ALIASES, DEVIN_CREDENTIAL_PATH } from './config.js';
import { buildDevinChildEnvironment } from './coding-runners/devin-host.js';
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
let verifiedDevinAliases: ReadonlySet<string> = new Set();

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
}

export function getVerifiedDevinAliases(): ReadonlySet<string> {
  return new Set(verifiedDevinAliases);
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
  return value in RUNTIMES;
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

function clearVerifiedDevinAliases(): void {
  verifiedDevinAliases = new Set();
}

function parseAdvertisedDevinModelExamples(help: string): Set<string> {
  const aliases = new Set<string>();
  for (const line of help.split(/\r?\n/)) {
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

function helpAdvertisesCapability(help: string, capability: string): boolean {
  const escaped = capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|[=<]|$)`, 'm').test(help);
}

export async function probeDevinRuntime(
  deps: DevinProbeDependencies,
): Promise<AgentRuntimeHealth> {
  const checkedAt = new Date().toISOString();
  if (deps.credentialPath === null) {
    clearVerifiedDevinAliases();
    return devinHealth(
      'error',
      'Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user',
      checkedAt,
    );
  }

  const fail = (detail: string, version: string | null = null) => {
    clearVerifiedDevinAliases();
    return devinHealth('error', detail, checkedAt, version);
  };
  const credentialPath = deps.credentialPath;
  if (!path.isAbsolute(credentialPath)) {
    return fail(
      'Configure an absolute DEVIN_CREDENTIAL_PATH for the NanoCrab service user',
    );
  }
  if (deps.platform !== 'linux' && deps.platform !== 'darwin') {
    return fail('Devin host runner requires Linux or macOS sandbox support');
  }

  try {
    const [canonicalPath, linkStats, fileStats] = await Promise.all([
      deps.realpath(credentialPath),
      deps.lstat(credentialPath),
      deps.stat(credentialPath),
    ]);
    if (
      canonicalPath !== credentialPath ||
      linkStats.isSymbolicLink() ||
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

  const options = {
    env: buildDevinChildEnvironment(deps.env),
    timeout: DEVIN_PROBE_TIMEOUT_MS,
  };
  let version: string | null = null;
  try {
    const versionResult = await deps.execFile('devin', ['--version'], options);
    version = parseVersion(versionResult.stdout);
    const helpResult = await deps.execFile('devin', ['--help'], options);
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

    try {
      await deps.execFile('devin', ['auth', 'status'], options);
    } catch {
      clearVerifiedDevinAliases();
      return devinHealth(
        'unauthenticated',
        'Run devin auth login as the NanoCrab service user',
        checkedAt,
        version,
      );
    }

    verifiedDevinAliases = new Set(configuredAliases);
    return devinHealth(
      'healthy',
      'Devin host runner is ready',
      checkedAt,
      version,
    );
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    clearVerifiedDevinAliases();
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
  };
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
