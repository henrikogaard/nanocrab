/**
 * Step: codex-auth — prepare Codex OAuth for agent containers.
 *
 * Imports an existing host Codex login from ~/.codex/auth.json into
 * data/codex/, which is mounted as /home/node/.codex in containers.
 */
import { ensureCodexOAuth, getCodexAuthStatus } from '../src/codex-auth.js';
import { isValidAgentModel, writeAgentProviderConfig } from '../src/agent-provider.js';
import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

export async function run(args: string[]): Promise<void> {
  const setDefault = args.includes('--set-default');
  const modelArg = args.find((a) => a.startsWith('--model='));
  const model = modelArg?.split('=').slice(1).join('=') || 'gpt-5.4';
  if (!isValidAgentModel('codex', model)) {
    throw new Error('model is not valid for codex');
  }

  logger.info({ setDefault, model }, 'Preparing Codex OAuth');

  const before = getCodexAuthStatus();
  const after = ensureCodexOAuth();

  if (setDefault && after.configured) {
    writeAgentProviderConfig('codex', model);
  }

  emitStatus('CODEX_AUTH', {
    STATUS: after.configured ? 'success' : 'failed',
    CONFIGURED: after.configured,
    IMPORTED: after.imported,
    HAD_PERSISTED_AUTH: before.hasPersistedAuth,
    HAS_HOST_AUTH: after.hasHostAuth,
    PERSISTED_DIR: after.persistedDir,
    HOST_DIR: after.hostDir,
    DEFAULT_PROVIDER: setDefault && after.configured ? 'codex' : undefined,
    DEFAULT_MODEL: setDefault && after.configured ? model : undefined,
    NEXT_STEP: after.configured
      ? 'Restart running agent containers/sessions to use Codex.'
      : `Run CODEX_HOME=${after.persistedDir} codex login --device-auth, then rerun this step.`,
  });
}
