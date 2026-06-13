import { Router, type Request, type Response } from 'express';
import {
  createMissionFromRunbook,
  createRunbook,
  loadMissionStore,
  updateMissionStep,
} from '../../missions.js';
import { auditLog } from '../security.js';

const router = Router();

function sendError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : 'Mission request failed';
  const status = /not found/i.test(message)
    ? 404
    : /required|approval|at least/i.test(message)
      ? 400
      : 500;
  res.status(status).json({ error: message });
}

router.get('/', (_req: Request, res: Response) => {
  res.json(loadMissionStore().missions);
});

router.get('/runbooks', (_req: Request, res: Response) => {
  res.json(loadMissionStore().runbooks);
});

router.post('/runbooks', (req: Request, res: Response) => {
  try {
    const runbook = createRunbook(req.body || {});
    auditLog(req, 'runbook_create', `${runbook.title} (${runbook.id})`);
    res.json({ ok: true, runbook });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const mission = createMissionFromRunbook(req.body || {});
    auditLog(req, 'mission_create', `${mission.title} (${mission.id})`);
    res.json({ ok: true, mission });
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:missionId/steps/:stepId', (req: Request, res: Response) => {
  try {
    const mission = updateMissionStep(
      req.params.missionId as string,
      req.params.stepId as string,
      req.body || {},
    );
    auditLog(
      req,
      'mission_step_update',
      `${mission.id}:${req.params.stepId}:${req.body?.status || 'unknown'}`,
    );
    res.json({ ok: true, mission });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
