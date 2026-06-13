import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
} from '../../db.js';
import Database from 'better-sqlite3';
import path from 'path';
import { STORE_DIR } from '../../config.js';
import { isAgentProvider } from '../../agent-provider.js';
import { ProviderPurpose, PROVIDER_PURPOSES } from '../../provider-router.js';
import { createOperationSchedule } from '../../operation-schedules.js';

const router = Router();

function getDb(): Database.Database {
  return new Database(path.join(STORE_DIR, 'messages.db'), { readonly: true });
}

router.get('/', (_req: Request, res: Response) => {
  res.json(getAllTasks());
});

// Create a new task
router.post('/', (req: Request, res: Response) => {
  const {
    groupFolder,
    chatJid,
    prompt,
    scheduleType,
    scheduleValue,
    contextMode,
    script,
    providerProfileId,
    provider_profile_id,
    provider,
    model,
    toolPolicy,
    tool_policy,
  } = req.body;
  if (!groupFolder || !chatJid || !prompt || !scheduleType || !scheduleValue) {
    res.status(400).json({
      error:
        'Missing required fields: groupFolder, chatJid, prompt, scheduleType, scheduleValue',
    });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  createTask({
    id,
    group_folder: groupFolder,
    chat_jid: chatJid,
    prompt,
    script: script || undefined,
    provider_profile_id:
      typeof providerProfileId === 'string' &&
      PROVIDER_PURPOSES.includes(providerProfileId as ProviderPurpose)
        ? providerProfileId
        : typeof provider_profile_id === 'string' &&
            PROVIDER_PURPOSES.includes(provider_profile_id as ProviderPurpose)
          ? provider_profile_id
          : null,
    provider:
      typeof provider === 'string' && isAgentProvider(provider)
        ? provider
        : null,
    model: typeof model === 'string' && model.trim() ? model.trim() : null,
    tool_policy:
      typeof toolPolicy === 'string' && toolPolicy.trim()
        ? toolPolicy.trim()
        : typeof tool_policy === 'string' && tool_policy.trim()
          ? tool_policy.trim()
          : null,
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    context_mode: contextMode || 'isolated',
    next_run: now,
    status: 'active',
    created_at: now,
  });

  res.json({ ok: true, id });
});

router.post('/operation-schedules', (req: Request, res: Response) => {
  const {
    groupFolder,
    chatJid,
    title,
    orders,
    intent,
    scheduleType,
    scheduleValue,
    contextMode,
    deliveryMode,
    deliveryApproved,
    providerProfileId,
    provider_profile_id,
    provider,
    model,
  } = req.body;

  try {
    const result = createOperationSchedule({
      groupFolder,
      chatJid,
      title,
      orders,
      intent: intent === 'orders' ? 'orders' : 'reminder',
      scheduleType,
      scheduleValue,
      contextMode: contextMode === 'isolated' ? 'isolated' : 'group',
      deliveryMode: deliveryMode === 'send' ? 'send' : 'preview',
      deliveryApproved: deliveryApproved === true,
      providerProfileId:
        typeof providerProfileId === 'string' &&
        PROVIDER_PURPOSES.includes(providerProfileId as ProviderPurpose)
          ? providerProfileId
          : typeof provider_profile_id === 'string' &&
              PROVIDER_PURPOSES.includes(provider_profile_id as ProviderPurpose)
            ? provider_profile_id
            : 'default_automation',
      provider:
        typeof provider === 'string' && isAgentProvider(provider)
          ? provider
          : null,
      model: typeof model === 'string' && model.trim() ? model.trim() : null,
    });
    res.json({
      ok: true,
      id: result.task.id,
      task: result.task,
      deliveryMode: result.deliveryMode,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = getTaskById(id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

router.put('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = getTaskById(id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const {
    prompt,
    script,
    schedule_type,
    schedule_value,
    status,
    providerProfileId,
    provider_profile_id,
    provider,
    model,
    toolPolicy,
    tool_policy,
  } = req.body;
  updateTask(id, {
    ...(prompt !== undefined && { prompt }),
    ...(script !== undefined && { script }),
    ...(providerProfileId !== undefined && {
      provider_profile_id:
        typeof providerProfileId === 'string' &&
        PROVIDER_PURPOSES.includes(providerProfileId as ProviderPurpose)
          ? providerProfileId
          : null,
    }),
    ...(provider_profile_id !== undefined && {
      provider_profile_id:
        typeof provider_profile_id === 'string' &&
        PROVIDER_PURPOSES.includes(provider_profile_id as ProviderPurpose)
          ? provider_profile_id
          : null,
    }),
    ...(provider !== undefined && {
      provider:
        typeof provider === 'string' && isAgentProvider(provider)
          ? provider
          : null,
    }),
    ...(model !== undefined && {
      model: typeof model === 'string' && model.trim() ? model.trim() : null,
    }),
    ...(toolPolicy !== undefined && {
      tool_policy:
        typeof toolPolicy === 'string' && toolPolicy.trim()
          ? toolPolicy.trim()
          : null,
    }),
    ...(tool_policy !== undefined && {
      tool_policy:
        typeof tool_policy === 'string' && tool_policy.trim()
          ? tool_policy.trim()
          : null,
    }),
    ...(schedule_type !== undefined && { schedule_type }),
    ...(schedule_value !== undefined && { schedule_value }),
    ...(status !== undefined && { status }),
  });

  res.json({ ok: true });
});

router.delete('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = getTaskById(id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  deleteTask(id);
  res.json({ ok: true });
});

router.put('/:id/pause', (req: Request, res: Response) => {
  updateTask(req.params.id as string, { status: 'paused' });
  res.json({ ok: true });
});

router.put('/:id/resume', (req: Request, res: Response) => {
  updateTask(req.params.id as string, { status: 'active' });
  res.json({ ok: true });
});

router.get('/:id/logs', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const db = getDb();
  try {
    const rows = db
      .prepare(
        'SELECT * FROM task_run_logs WHERE task_id = ? ORDER BY run_at DESC LIMIT ?',
      )
      .all(id, limit);
    res.json(rows);
  } finally {
    db.close();
  }
});

export default router;
