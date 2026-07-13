import { execFileSync } from 'child_process';

import { probeAgentRuntime } from './agent-runtime-registry.js';
import { CONTAINER_IMAGE } from './config.js';
import { CONTAINER_RUNTIME_BIN } from './container-runtime.js';
import { readEnvFile } from './env.js';
import type { AgentCliId, AgentRuntimeHealth } from './types.js';

export function isCodingContainerImageAvailable(): boolean {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ['image', 'inspect', CONTAINER_IMAGE], {
      stdio: 'pipe',
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

export function isCredentialConfigured(key: string): boolean {
  return Boolean(process.env[key] || readEnvFile([key])[key]);
}

export async function probeCodingRunnerReadiness(
  cli: AgentCliId,
  options: {
    probeHostRuntime?: typeof probeAgentRuntime;
    containerImageAvailable?: () => boolean;
    credentialAvailable?: (key: string) => boolean;
  } = {},
): Promise<AgentRuntimeHealth> {
  if (cli !== 'pi') {
    return (options.probeHostRuntime || probeAgentRuntime)(cli);
  }

  const checkedAt = new Date().toISOString();
  const hasImage =
    options.containerImageAvailable?.() ?? isCodingContainerImageAvailable();
  if (!hasImage) {
    return {
      cli: 'pi',
      executable: CONTAINER_IMAGE,
      status: 'missing',
      version: null,
      checkedAt,
      detail: `Coding container image ${CONTAINER_IMAGE} is unavailable`,
    };
  }

  const hasCredential =
    options.credentialAvailable?.('OPENROUTER_API_KEY') ??
    isCredentialConfigured('OPENROUTER_API_KEY');
  if (!hasCredential) {
    return {
      cli: 'pi',
      executable: CONTAINER_IMAGE,
      status: 'missing',
      version: null,
      checkedAt,
      detail:
        'Pi coding runner requires the OPENROUTER_API_KEY credential-proxy route',
    };
  }

  return {
    cli: 'pi',
    executable: CONTAINER_IMAGE,
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
  ];
  return Promise.all(clis.map((cli) => probeCodingRunnerReadiness(cli)));
}
