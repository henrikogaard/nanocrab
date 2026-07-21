import { Router, Request, Response } from 'express';

import {
  createResearchJob,
  getNotebookLmReadiness,
  getResearchJob,
  listResearchJobs,
  loadNotebookLmConfig,
  NOTEBOOKLM_CAPABILITIES,
  requestNotebookLmOperation,
  saveNotebookLmConfig,
  type NotebookLmCapability,
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
  const config = loadNotebookLmConfig();
  res.json({ ...config, readiness: getNotebookLmReadiness(config) });
});

router.get('/notebooklm/readiness', (_req: Request, res: Response) => {
  const config = loadNotebookLmConfig();
  res.json(getNotebookLmReadiness(config));
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
      serverName:
        typeof req.body.serverName === 'string'
          ? req.body.serverName
          : undefined,
      credentialProxyRoute:
        typeof req.body.credentialProxyRoute === 'string'
          ? req.body.credentialProxyRoute
          : undefined,
    });
    auditLog(
      req,
      'notebooklm_config_updated',
      config.enabled ? 'enabled' : 'disabled',
    );
    res.json({ ok: true, config, readiness: getNotebookLmReadiness(config) });
  },
);

router.post(
  '/notebooklm/operations',
  requireRole('owner'),
  (req: Request, res: Response) => {
    const operation = req.body.operation as NotebookLmCapability;
    if (!NOTEBOOKLM_CAPABILITIES.includes(operation)) {
      res.status(400).json({ error: 'Unsupported NotebookLM operation' });
      return;
    }
    const result = requestNotebookLmOperation({
      operation,
      approved: req.body.approved === true,
      researchJobId:
        typeof req.body.researchJobId === 'string'
          ? req.body.researchJobId
          : undefined,
    });
    auditLog(
      req,
      'notebooklm_operation_requested',
      JSON.stringify({
        operation: result.operation,
        status: result.status,
        researchJobId: result.researchJobId,
        executed: result.executed,
      }),
    );
    res.status(result.status === 'requires_approval' ? 202 : 409).json({
      ok: false,
      operation: result,
      readiness: getNotebookLmReadiness(),
    });
  },
);

export default router;
