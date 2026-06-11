import { Router, Request, Response } from 'express';

import {
  archiveRunbook,
  createRunbook,
  getRunbook,
  listRunbooks,
  updateRunbookStep,
} from '../../runbooks.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    runbooks: listRunbooks({
      includeArchived: req.query.includeArchived === 'true',
    }),
  });
});

router.get('/:id', (req: Request, res: Response) => {
  const runbook = getRunbook(req.params.id as string);
  if (!runbook) {
    res.status(404).json({ error: 'Runbook not found' });
    return;
  }
  res.json(runbook);
});

router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const runbook = createRunbook({
      title: req.body.title,
      mission: req.body.mission,
      owner: req.body.owner || req.user?.username,
      groupFolder: req.body.groupFolder,
      dueAt: req.body.dueAt,
      links: Array.isArray(req.body.links) ? req.body.links : undefined,
      steps: Array.isArray(req.body.steps) ? req.body.steps : [],
    });
    auditLog(req, 'runbook_created', runbook.id);
    res.json({ ok: true, runbook });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post(
  '/:id/steps/:stepId',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const runbook = updateRunbookStep(
        req.params.id as string,
        req.params.stepId as string,
        {
          status: req.body.status,
          notes: req.body.notes,
          owner: req.body.owner,
          dueAt: req.body.dueAt,
        },
      );
      auditLog(
        req,
        'runbook_step_updated',
        `${runbook.id}:${req.params.stepId}`,
      );
      res.json({ ok: true, runbook });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/:id/archive',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const runbook = archiveRunbook(req.params.id as string);
      auditLog(req, 'runbook_archived', runbook.id);
      res.json({ ok: true, runbook });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
