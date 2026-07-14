import { Router, Request, Response } from 'express';

import {
  approveLearningProposal,
  getLearningConfig,
  getLearningProposal,
  listLearningProposals,
  rejectLearningProposal,
  updateLearningConfig,
  type LearningLoopConfig,
} from '../../learning-loop.js';
import { auditLog } from '../security.js';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function userActor(req: Request): string {
  return req.user?.username || 'admin';
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value as string);
}

router.get('/', (_req: Request, res: Response) => {
  try {
    res.json(listLearningProposals());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  try {
    res.json(getLearningConfig());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/config', (req: Request, res: Response) => {
  try {
    const config = updateLearningConfig(
      req.body as Partial<LearningLoopConfig>,
    );
    auditLog(req, 'learning_config_updated', JSON.stringify(config));
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const proposal = getLearningProposal(routeParam(req, 'id'));
    if (!proposal) {
      res.status(404).json({ error: 'Learning proposal not found' });
      return;
    }
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/:id/approve', (req: Request, res: Response) => {
  try {
    const proposal = approveLearningProposal(
      routeParam(req, 'id'),
      userActor(req),
    );
    auditLog(req, 'learning_proposal_approved', proposal.id);
    res.json(proposal);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.put('/:id/reject', (req: Request, res: Response) => {
  try {
    const note = typeof req.body?.note === 'string' ? req.body.note : undefined;
    const proposal = rejectLearningProposal(
      routeParam(req, 'id'),
      userActor(req),
      note,
    );
    auditLog(req, 'learning_proposal_rejected', proposal.id);
    res.json(proposal);
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

export default router;
