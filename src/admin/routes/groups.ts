import { Router, Request, Response } from 'express';
import {
  getAllRegisteredGroups,
  setRegisteredGroup,
  getAllChats,
} from '../../db.js';
import { ensureCodexOAuth } from '../../codex-auth.js';
import {
  AGENT_PROVIDERS,
  getAgentProviderConfig,
  isAgentProvider,
  isValidAgentModel,
} from '../../agent-provider.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const groups = getAllRegisteredGroups();
  const chats = getAllChats();
  const chatMap = new Map(chats.map((c) => [c.jid, c]));

  const result = Object.entries(groups).map(([jid, group]) => {
    const chat = chatMap.get(jid);
    return {
      jid,
      ...group,
      lastActivity: chat?.last_message_time || null,
      channel: chat?.channel || null,
    };
  });

  res.json(result);
});

router.put('/:jid', (req: Request, res: Response) => {
  const jid = req.params.jid as string;
  const updates = req.body;

  const groups = getAllRegisteredGroups();
  const existing = groups[jid];
  if (!existing) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }
  if (updates.containerConfig?.provider === 'codex') {
    const codexAuth = ensureCodexOAuth();
    if (!codexAuth.configured) {
      res.status(400).json({
        error: `Codex OAuth is not configured. Run codex login --device-auth with CODEX_HOME=${codexAuth.persistedDir}, or authenticate on the host and switch again to import it.`,
        auth: { codex: codexAuth },
      });
      return;
    }
  }
  if (
    updates.containerConfig?.provider &&
    !isAgentProvider(updates.containerConfig.provider)
  ) {
    res.status(400).json({
      error: `provider must be one of: ${AGENT_PROVIDERS.join(', ')}`,
    });
    return;
  }
  if (updates.containerConfig?.model) {
    const provider =
      updates.containerConfig.provider ||
      existing.containerConfig?.provider ||
      getAgentProviderConfig().provider;
    if (!isValidAgentModel(provider, updates.containerConfig.model)) {
      res.status(400).json({
        error: `model is not valid for ${provider}`,
      });
      return;
    }
  }

  const updated = {
    ...existing,
    trigger: updates.trigger ?? existing.trigger,
    requiresTrigger: updates.requiresTrigger ?? existing.requiresTrigger,
    containerConfig: updates.containerConfig ?? existing.containerConfig,
  };

  setRegisteredGroup(jid, updated);
  res.json({ ok: true, group: updated });
});

export default router;
