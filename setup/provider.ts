/**
 * Step: provider — choose the default agent engine for a new setup.
 */
import { ensureCodexOAuth } from '../src/codex-auth.js';
import {
  AGENT_PROVIDERS,
  DEFAULT_AGENT_MODELS,
  isAgentProvider,
  isValidAgentModel,
  writeAgentProviderConfig,
} from '../src/agent-provider.js';
import { logger } from '../src/logger.js';
import { SetupStepResult } from '../src/setup-state.js';
import { emitStatus } from './status.js';

function argValue(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

export async function run(args: string[]): Promise<SetupStepResult> {
  const provider = argValue(args, 'provider') || args[0] || 'claude';
  if (!isAgentProvider(provider)) {
    throw new Error(`provider must be one of: ${AGENT_PROVIDERS.join(', ')}`);
  }

  const model = argValue(args, 'model') || DEFAULT_AGENT_MODELS[provider];
  const baseUrl = argValue(args, 'base-url');
  if (!isValidAgentModel(provider, model)) {
    throw new Error(`model is not valid for ${provider}`);
  }

  logger.info({ provider, model }, 'Configuring default provider');

  let codexAuth;
  if (provider === 'codex') {
    codexAuth = ensureCodexOAuth();
    if (!codexAuth.configured) {
      emitStatus('PROVIDER', {
        STATUS: 'failed',
        PROVIDER: provider,
        MODEL: model,
        CODEX_CONFIGURED: false,
        HOST_CODEX_AUTH: codexAuth.hasHostAuth,
        PERSISTED_DIR: codexAuth.persistedDir,
        NEXT_STEP: `Run CODEX_HOME=${codexAuth.persistedDir} codex login --device-auth, then rerun setup provider codex.`,
      });
      return {
        status: 'failed',
        message: 'Codex OAuth is not configured for containers',
      };
    }
  }

  writeAgentProviderConfig(provider, model, baseUrl);

  emitStatus('PROVIDER', {
    STATUS: 'success',
    PROVIDER: provider,
    MODEL: model,
    BASE_URL: baseUrl,
    CODEX_CONFIGURED: codexAuth?.configured,
    CODEX_IMPORTED: codexAuth?.imported,
  });
  return { status: 'success' };
}
