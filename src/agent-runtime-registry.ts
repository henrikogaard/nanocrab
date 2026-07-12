import { execFile } from 'child_process';
import { promisify } from 'util';

import type {
  AgentCliId,
  AgentRuntimeHealth,
} from './types.js';

const execFileAsync = promisify(execFile);

export interface AgentRuntimeDefinition {
  cli: AgentCliId;
  executable: string;
  versionArgs: string[];
}

const RUNTIMES: Record<AgentCliId, AgentRuntimeDefinition> = {
  claude: { cli: 'claude', executable: 'claude', versionArgs: ['--version'] },
  codex: { cli: 'codex', executable: 'codex', versionArgs: ['--version'] },
  pi: { cli: 'pi', executable: 'pi', versionArgs: ['--version'] },
  opencode: {
    cli: 'opencode',
    executable: 'opencode',
    versionArgs: ['--version'],
  },
  devin: { cli: 'devin', executable: 'devin', versionArgs: ['--version'] },
  mistral: {
    cli: 'mistral',
    executable: 'vibe',
    versionArgs: ['--version'],
  },
};

export function listAgentRuntimeDefinitions(): AgentRuntimeDefinition[] {
  return Object.values(RUNTIMES);
}

export function getAgentRuntimeDefinition(
  cli: AgentCliId,
): AgentRuntimeDefinition | undefined {
  return RUNTIMES[cli];
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
    const { stdout } = await runner(definition.executable, definition.versionArgs, {
      timeout: 10000,
    });
    const version = parseVersion(stdout.trim());

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

export async function probeAllAgentRuntimes(
  options?: { execFile?: typeof execFileAsync },
): Promise<AgentRuntimeHealth[]> {
  const results: AgentRuntimeHealth[] = [];
  await Promise.allSettled(
    Object.values(RUNTIMES).map(async (def) => {
      const health = await probeAgentRuntime(def.cli, options);
      results.push(health);
    }),
  );
  return results.sort((a, b) => a.cli.localeCompare(b.cli));
}
