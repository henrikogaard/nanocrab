import { createRequire } from 'node:module';

import { readEnvFile } from './env.js';
import {
  DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
  isDevinSandboxAuthHandoffAvailable,
  CURSOR_ISOLATION_DETAIL,
} from './agent-runtime-registry.js';
import type { AgentCliId, AgentRuntimeHealth } from './types.js';

const require = createRequire(import.meta.url);

export interface CodingRunnerInfrastructure {
  runtimeBin: string;
  image: string;
}

export type ContainerImageInspector = (
  runtimeBin: string,
  image: string,
) => boolean;

type HostRuntimeProbe = (cli: AgentCliId) => Promise<AgentRuntimeHealth>;

type CursorIsolationProbe = () => boolean;

export function getCodingRunnerInfrastructure(
  env: Record<string, string | undefined> = process.env,
): CodingRunnerInfrastructure {
  return {
    runtimeBin: env.CONTAINER_RUNTIME_BIN || 'docker',
    image: env.CONTAINER_IMAGE || 'nanocrab-agent:latest',
  };
}

function inspectContainerImage(runtimeBin: string, image: string): boolean {
  try {
    const { execFileSync } = require('node:child_process') as {
      execFileSync: (
        command: string,
        args: string[],
        options: { stdio: string; timeout: number },
      ) => unknown;
    };
    execFileSync(runtimeBin, ['image', 'inspect', image], {
      stdio: 'pipe',
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

export function isCodingContainerImageAvailable(
  options: {
    infrastructure?: CodingRunnerInfrastructure;
    inspect?: ContainerImageInspector;
  } = {},
): boolean {
  const infrastructure =
    options.infrastructure || getCodingRunnerInfrastructure();
  return (options.inspect || inspectContainerImage)(
    infrastructure.runtimeBin,
    infrastructure.image,
  );
}

export function isCredentialConfigured(key: string): boolean {
  return Boolean(process.env[key] || readEnvFile([key])[key]);
}

async function probeHostRuntime(cli: AgentCliId): Promise<AgentRuntimeHealth> {
  const { probeAgentRuntime } = await import('./agent-runtime-registry.js');
  return probeAgentRuntime(cli);
}

export async function probeCodingRunnerReadiness(
  cli: AgentCliId,
  options: {
    probeHostRuntime?: HostRuntimeProbe;
    containerImageAvailable?: () => boolean;
    credentialAvailable?: (key: string) => boolean;
    infrastructure?: CodingRunnerInfrastructure;
    inspectContainerImage?: ContainerImageInspector;
    cursorIsolationAvailable?: CursorIsolationProbe;
  } = {},
): Promise<AgentRuntimeHealth> {
  if (cli === 'cursor') {
    const health = await (options.probeHostRuntime || probeHostRuntime)(cli);
    if (health.status !== 'healthy') return health;
    const isolated =
      options.cursorIsolationAvailable?.() ??
      process.env.NANOCRAB_CURSOR_ISOLATION_VERIFIED === '1';
    if (!isolated) {
      return {
        ...health,
        status: 'unsupported',
        detail: CURSOR_ISOLATION_DETAIL,
      };
    }
    return health;
  }
  if (cli === 'devin') {
    if (!isDevinSandboxAuthHandoffAvailable()) {
      return {
        cli: 'devin',
        executable: 'devin',
        status: 'error',
        version: null,
        checkedAt: new Date().toISOString(),
        detail: DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
      };
    }
    const health = await (options.probeHostRuntime || probeHostRuntime)(cli);
    if (health.status === 'healthy' && !isDevinSandboxAuthHandoffAvailable()) {
      return {
        ...health,
        status: 'error',
        detail: DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
      };
    }
    return health;
  }
  if (cli !== 'pi') {
    return (options.probeHostRuntime || probeHostRuntime)(cli);
  }

  const checkedAt = new Date().toISOString();
  const infrastructure =
    options.infrastructure || getCodingRunnerInfrastructure();
  const hasImage =
    options.containerImageAvailable?.() ??
    isCodingContainerImageAvailable({
      infrastructure,
      inspect: options.inspectContainerImage,
    });
  if (!hasImage) {
    return {
      cli: 'pi',
      executable: infrastructure.image,
      status: 'missing',
      version: null,
      checkedAt,
      detail: `Coding container image ${infrastructure.image} is unavailable through ${infrastructure.runtimeBin}`,
    };
  }

  const hasCredential =
    options.credentialAvailable?.('OPENROUTER_API_KEY') ??
    isCredentialConfigured('OPENROUTER_API_KEY');
  if (!hasCredential) {
    return {
      cli: 'pi',
      executable: infrastructure.image,
      status: 'missing',
      version: null,
      checkedAt,
      detail:
        'Pi coding runner requires the OPENROUTER_API_KEY credential-proxy route',
    };
  }

  return {
    cli: 'pi',
    executable: infrastructure.image,
    status: 'healthy',
    version: null,
    checkedAt,
    detail:
      'Pi is runnable in the coding container through the OpenRouter credential route',
  };
}

export async function probeAllCodingRunnerReadiness(): Promise<
  AgentRuntimeHealth[]
> {
  const clis: AgentCliId[] = [
    'claude',
    'codex',
    'opencode',
    'devin',
    'pi',
    'mistral',
    'cursor',
  ];
  return Promise.all(clis.map((cli) => probeCodingRunnerReadiness(cli)));
}
