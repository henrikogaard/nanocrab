import { execFile } from 'child_process';
import { promisify } from 'util';

import type { AgentCliId, AgentRuntimeHealth } from './types.js';

const execFileAsync = promisify(execFile);

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
