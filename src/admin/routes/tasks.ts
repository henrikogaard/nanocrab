import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getTaskRunLogs,
} from '../../db.js';
import { isAgentProvider } from '../../agent-provider.js';
import { ProviderPurpose, PROVIDER_PURPOSES } from '../../provider-router.js';
import { createOperationSchedule } from '../../operation-schedules.js';
import { listRoutineBlueprints } from '../../routine-blueprints.js';
import { markTaskManualRun } from '../../task-scheduler.js';

const router = Router();
const DELIVERY_MODES = new Set(['chat', 'dashboard', 'file', 'webhook']);

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed =
    typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeContextMode(
  value: unknown,
): 'group' | 'isolated' | 'session' {
  return value === 'group' || value === 'session' ? value : 'isolated';
}

function normalizeDeliveryMode(
  value: unknown,
): 'chat' | 'dashboard' | 'file' | 'webhook' | null {
  const normalized = cleanString(value);
  return normalized && DELIVERY_MODES.has(normalized)
    ? (normalized as 'chat' | 'dashboard' | 'file' | 'webhook')
    : null;
}

function normalizeStringArrayJson(value: unknown): string | null {
  let source = value;
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      source = JSON.parse(value);
    } catch {
      return null;
    }
  } else if (typeof value === 'string' && value.trim()) {
    source = value.split(',');
  }

  if (!Array.isArray(source)) return null;
  const items = source
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item));
  return items.length ? JSON.stringify([...new Set(items)]) : null;
}

function normalizeObjectJson(value: unknown): string | null {
  let source = value;
  if (typeof value === 'string' && value.trim()) {
    try {
      source = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null;
  }
  return JSON.stringify(source);
}

function routineMetadataFromBody(body: Record<string, unknown>) {
  return {
    ...(body.title !== undefined && { title: cleanString(body.title) }),
    ...(body.description !== undefined && {
      description: cleanString(body.description),
    }),
    ...((body.routineType !== undefined || body.routine_type !== undefined) && {
      routine_type: cleanString(body.routineType ?? body.routine_type),
    }),
    ...((body.contextMode !== undefined || body.context_mode !== undefined) && {
      context_mode: normalizeContextMode(body.contextMode ?? body.context_mode),
    }),
    ...((body.deliveryMode !== undefined ||
      body.delivery_mode !== undefined) && {
      delivery_mode: normalizeDeliveryMode(
        body.deliveryMode ?? body.delivery_mode,
      ),
    }),
    ...((body.deliveryTarget !== undefined ||
      body.delivery_target !== undefined) && {
      delivery_target: cleanString(body.deliveryTarget ?? body.delivery_target),
    }),
    ...((body.skills !== undefined || body.skills_json !== undefined) && {
      skills_json: normalizeStringArrayJson(body.skills ?? body.skills_json),
    }),
    ...((body.maxRuntimeMs !== undefined ||
      body.max_runtime_ms !== undefined) && {
      max_runtime_ms: cleanPositiveInt(
        body.maxRuntimeMs ?? body.max_runtime_ms,
      ),
    }),
    ...((body.maxActiveRuns !== undefined ||
      body.max_active_runs !== undefined) && {
      max_active_runs: cleanPositiveInt(
        body.maxActiveRuns ?? body.max_active_runs,
      ),
    }),
    ...((body.heartbeatPolicy !== undefined ||
      body.heartbeat_policy_json !== undefined) && {
      heartbeat_policy_json: normalizeObjectJson(
        body.heartbeatPolicy ?? body.heartbeat_policy_json,
      ),
    }),
    ...((body.silentMarker !== undefined ||
      body.silent_marker !== undefined) && {
      silent_marker: cleanString(body.silentMarker ?? body.silent_marker),
    }),
    ...((body.sessionKey !== undefined || body.session_key !== undefined) && {
      session_key: cleanString(body.sessionKey ?? body.session_key),
    }),
    ...((body.contextTaskIds !== undefined ||
      body.context_task_ids_json !== undefined) && {
      context_task_ids_json: normalizeStringArrayJson(
        body.contextTaskIds ?? body.context_task_ids_json,
      ),
    }),
  };
}

router.get('/', (_req: Request, res: Response) => {
  res.json(getAllTasks());
});

router.get('/blueprints', (_req: Request, res: Response) => {
  res.json(listRoutineBlueprints());
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
    context_mode: normalizeContextMode(contextMode),
    ...routineMetadataFromBody(req.body),
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

router.post('/:id/run-now', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const task = getTaskById(id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const nextRun = new Date().toISOString();
  markTaskManualRun(id);
  updateTask(id, { status: 'active', next_run: nextRun });
  res.json({
    ok: true,
    task: {
      id,
      status: 'active',
      next_run: nextRun,
    },
  });
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
    contextMode,
    context_mode,
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
    ...((contextMode !== undefined || context_mode !== undefined) && {
      context_mode: normalizeContextMode(contextMode ?? context_mode),
    }),
    ...routineMetadataFromBody(req.body),
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
  res.json(getTaskRunLogs(id, limit));
});

export default router;
