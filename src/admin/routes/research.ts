import { Router, Request, Response } from 'express';

import {
  createResearchJob,
  getResearchJob,
  listResearchJobs,
  loadNotebookLmConfig,
  saveNotebookLmConfig,
} from '../../research-jobs.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/jobs', (_req: Request, res: Response) => {
  res.json(listResearchJobs());
});

router.get('/jobs/:id', (req: Request, res: Response) => {
  const job = getResearchJob(req.params.id as string);
  if (!job) {
    res.status(404).json({ error: 'Research job not found' });
    return;
  }
  res.json(job);
});

router.post('/jobs', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const job = createResearchJob({
      query: req.body.query,
      urls: Array.isArray(req.body.urls)
        ? req.body.urls.map(String).filter(Boolean)
        : [],
      requester: req.user?.username || 'dashboard',
    });
    auditLog(req, 'research_job_created', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/notebooklm', (_req: Request, res: Response) => {
  res.json(loadNotebookLmConfig());
});

router.put(
  '/notebooklm',
  requireRole('owner'),
  (req: Request, res: Response) => {
    const config = saveNotebookLmConfig({
      enabled: req.body.enabled === true,
      projectId:
        typeof req.body.projectId === 'string' ? req.body.projectId : '',
      notes: typeof req.body.notes === 'string' ? req.body.notes : '',
    });
    auditLog(
      req,
      'notebooklm_config_updated',
      config.enabled ? 'enabled' : 'disabled',
    );
    res.json({ ok: true, config });
  },
);

export default router;
