import { Router, Request, Response } from 'express';
import {
  getAllRegisteredGroups,
  getNonWebRegisteredGroups,
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
import { getState } from '../state.js';
import { getChannelHealth } from '../../channel-health.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  const groups = getNonWebRegisteredGroups();
  const chats = getAllChats();
  const chatMap = new Map(chats.map((c) => [c.jid, c]));
  let channelHealth = new Map<string, ReturnType<typeof getChannelHealth>>();
  try {
    channelHealth = new Map(
      getState().channels.map((channel) => [
        channel.name.toLowerCase(),
        getChannelHealth(channel),
      ]),
    );
  } catch {
    // Admin state may be unavailable in isolated route tests.
  }

  const result = Object.entries(groups).map(([jid, group]) => {
    const chat = chatMap.get(jid);
    const channel =
      chat?.channel ||
      (jid.startsWith('tg:')
        ? 'telegram'
        : jid.startsWith('sig:')
          ? 'signal'
          : jid.startsWith('wa:')
            ? 'whatsapp'
            : null);
    return {
      jid,
      ...group,
      lastActivity: chat?.last_message_time || null,
      channel,
      channelHealth: channel ? channelHealth.get(channel) || null : null,
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
  if (existing.kind === 'web') {
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
  if (
    updates.containerConfig?.channelScope &&
    !['all', 'registered', 'allowed'].includes(
      updates.containerConfig.channelScope,
    )
  ) {
    res.status(400).json({
      error: 'channelScope must be one of: all, registered, allowed',
    });
    return;
  }
  if (
    updates.containerConfig?.allowedGroupFolders !== undefined &&
    !Array.isArray(updates.containerConfig.allowedGroupFolders)
  ) {
    res.status(400).json({ error: 'allowedGroupFolders must be an array' });
    return;
  }

  const enabled =
    updates.enabled === undefined
      ? existing.enabled !== false
      : !!updates.enabled;
  const isPrimary =
    updates.isPrimary === undefined
      ? existing.isPrimary === true
      : !!updates.isPrimary;

  if (isPrimary && !enabled) {
    res.status(400).json({ error: 'Primary bot must be enabled' });
    return;
  }
  if (isPrimary && !existing.isMain) {
    res.status(400).json({ error: 'Primary bot must be a main bot agent' });
    return;
  }

  const updated = {
    ...existing,
    trigger: updates.trigger ?? existing.trigger,
    requiresTrigger: updates.requiresTrigger ?? existing.requiresTrigger,
    containerConfig: updates.containerConfig ?? existing.containerConfig,
    enabled: enabled ? undefined : false,
    isPrimary: isPrimary ? true : undefined,
  };

  if (isPrimary) {
    for (const [otherJid, group] of Object.entries(groups)) {
      if (otherJid === jid || !group.isPrimary) continue;
      const otherUpdated = { ...group, isPrimary: undefined };
      setRegisteredGroup(otherJid, otherUpdated);
      try {
        getState().updateRegisteredGroup?.(otherJid, otherUpdated);
      } catch {
        // Admin state may be unavailable in isolated route tests.
      }
    }
  }

  setRegisteredGroup(jid, updated);
  try {
    getState().updateRegisteredGroup?.(jid, updated);
  } catch {
    // Admin state may be unavailable in isolated route tests.
  }
  res.json({ ok: true, group: updated });
});

export default router;
