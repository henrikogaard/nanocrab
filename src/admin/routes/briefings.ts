import { Router, type Request, type Response } from 'express';

import {
  createBriefingSchedule,
  loadBriefingStore,
} from '../../briefing-jobs.js';
import { auditLog } from '../security.js';

const router = Router();

function sendError(res: Response, err: unknown) {
  const message =
    err instanceof Error ? err.message : 'Briefing request failed';
  const status = /required|approval|cadence|localTime|providerProfileId/i.test(
    message,
  )
    ? 400
    : 500;
  res.status(status).json({ error: message });
}

router.get('/', (_req: Request, res: Response) => {
  res.json(loadBriefingStore().briefings);
});

router.post('/', (req: Request, res: Response) => {
  try {
    const briefing = createBriefingSchedule(req.body || {});
    auditLog(
      req,
      'briefing_schedule_create',
      `${briefing.title} (${briefing.id})`,
    );
    res.json({ ok: true, briefing });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
