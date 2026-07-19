import { Router, type Request, type Response } from 'express';

import {
  exportBriefingHistory,
  getBriefingAnalytics,
  listBriefingHistory,
  listDeliveryPreferences,
  removeDeliveryPreference,
  setDeliveryPreference,
  type BriefingHistoryFilters,
  type DeliveryPreferenceMode,
} from '../../briefing-history.js';
import { requireRole } from '../middleware.js';

const router = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isDeliveryMode(value: unknown): value is DeliveryPreferenceMode {
  return (
    value === 'dashboard' ||
    value === 'chat' ||
    value === 'disabled' ||
    value === 'approval-required'
  );
}

router.get('/history', (req: Request, res: Response) => {
  const filters: BriefingHistoryFilters = {
    ...(queryString(req.query.taskId) && { taskId: queryString(req.query.taskId) }),
    ...(queryString(req.query.groupFolder) && {
      groupFolder: queryString(req.query.groupFolder),
    }),
    ...(queryString(req.query.channel) && { channel: queryString(req.query.channel) }),
    ...(queryString(req.query.source) && {
      source: queryString(req.query.source) as BriefingHistoryFilters['source'],
    }),
    ...(queryString(req.query.status) && {
      status: queryString(req.query.status) as BriefingHistoryFilters['status'],
    }),
    ...(queryString(req.query.from) && { from: queryString(req.query.from) }),
    ...(queryString(req.query.to) && { to: queryString(req.query.to) }),
    limit: Math.min(parseInt(req.query.limit as string) || 100, 1000),
  };
  res.json(listBriefingHistory(filters));
});

router.get('/analytics', (_req: Request, res: Response) => {
  res.json(getBriefingAnalytics());
});

router.post('/export', (req: Request, res: Response) => {
  const filters: BriefingHistoryFilters = {
    ...(queryString(req.body?.taskId) && { taskId: queryString(req.body.taskId) }),
    ...(queryString(req.body?.groupFolder) && {
      groupFolder: queryString(req.body.groupFolder),
    }),
    ...(queryString(req.body?.channel) && { channel: queryString(req.body.channel) }),
    ...(queryString(req.body?.source) && {
      source: queryString(req.body.source) as BriefingHistoryFilters['source'],
    }),
    ...(queryString(req.body?.status) && {
      status: queryString(req.body.status) as BriefingHistoryFilters['status'],
    }),
    ...(queryString(req.body?.from) && { from: queryString(req.body.from) }),
    ...(queryString(req.body?.to) && { to: queryString(req.body.to) }),
    limit: Math.min(parseInt(req.body?.limit as string) || 1000, 1000),
  };
  const data = exportBriefingHistory(filters);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nanocrab-briefing-history-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json(data);
});

router.get('/preferences', (req: Request, res: Response) => {
  const group = queryString(req.query.groupFolder);
  const channel = queryString(req.query.channelId);
  if (group && channel) {
    const prefs = listDeliveryPreferences();
    const match = prefs.find(
      (p) => p.groupFolder === group && p.channelId === channel,
    );
    res.json(match ?? null);
    return;
  }
  res.json(listDeliveryPreferences());
});

router.use(requireRole('admin'));

router.post('/preferences', (req: Request, res: Response) => {
  const { groupFolder, channelId, mode } = req.body || {};
  if (
    typeof groupFolder !== 'string' ||
    !groupFolder.trim() ||
    typeof channelId !== 'string' ||
    !channelId.trim() ||
    !isDeliveryMode(mode)
  ) {
    res.status(400).json({
      error:
        'groupFolder, channelId, and mode (dashboard|chat|disabled|approval-required) are required',
    });
    return;
  }
  try {
    const preference = setDeliveryPreference({
      groupFolder: groupFolder.trim(),
      channelId: channelId.trim(),
      mode,
      updatedBy: req.user?.username ?? null,
    });
    res.json({ ok: true, preference });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.delete('/preferences', (req: Request, res: Response) => {
  const { groupFolder, channelId } = req.body || {};
  if (
    typeof groupFolder !== 'string' ||
    !groupFolder.trim() ||
    typeof channelId !== 'string' ||
    !channelId.trim()
  ) {
    res.status(400).json({ error: 'groupFolder and channelId are required' });
    return;
  }
  const removed = removeDeliveryPreference(groupFolder.trim(), channelId.trim());
  res.json({ ok: true, removed });
});

export default router;
