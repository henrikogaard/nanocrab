import { execFile } from 'child_process';
import { promisify } from 'util';

import type { AgentProvider } from './agent-provider.js';
import { DEVIN_CLI_MODEL_ALIASES } from './config.js';
import type {
  AgentCliId,
  AgentRuntimeHealth,
  AgentRuntimeSelection,
} from './types.js';

const execFileAsync = promisify(execFile);

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
    codingRunnerSupported: false,
    detail:
      'Devin CLI is discoverable for runtime health but is not a selectable agent provider or coding runner. It requires interactive `devin auth login` and does not accept DEVIN_API_KEY/WINDSURF_API_KEY for non-interactive runs, so it cannot be used in unattended coding jobs.',
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
  options?: { execFile?: typeof execFileAsync },
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
