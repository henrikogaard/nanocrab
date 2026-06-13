import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import {
  approveReportDelivery,
  approveReportOutline,
  createReportJob,
  getReportJob,
  listReportJobs,
} from '../../report-jobs.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/jobs', (_req: Request, res: Response) => {
  res.json(listReportJobs());
});

router.get('/jobs/:id', (req: Request, res: Response) => {
  const job = getReportJob(req.params.id as string);
  if (!job) {
    res.status(404).json({ error: 'Report job not found' });
    return;
  }
  res.json(job);
});

router.get(
  '/jobs/:id/artifacts/:index/download',
  requireRole('admin'),
  (req: Request, res: Response) => {
    const job = getReportJob(req.params.id as string);
    if (!job) {
      res.status(404).json({ error: 'Report job not found' });
      return;
    }
    const index = Number.parseInt(req.params.index as string, 10);
    const artifact = Number.isInteger(index) ? job.artifacts[index] : undefined;
    if (!artifact) {
      res.status(404).json({ error: 'Report artifact not found' });
      return;
    }
    const deliverablesDir = path.resolve(job.deliverablesDir);
    const artifactPath = path.resolve(artifact.path);
    if (
      artifactPath !== deliverablesDir &&
      !artifactPath.startsWith(`${deliverablesDir}${path.sep}`)
    ) {
      res.status(400).json({
        error: 'Report artifact path is outside deliverables directory',
      });
      return;
    }
    if (!fs.existsSync(artifactPath)) {
      res.status(404).json({ error: 'Report artifact file is missing' });
      return;
    }
    auditLog(req, 'report_artifact_downloaded', job.id);
    res.download(artifactPath);
  },
);

router.post('/jobs', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const job = createReportJob({
      title: req.body.title,
      request: req.body.request,
      requester: req.user?.username || 'dashboard',
      providerProfileId: req.body.providerProfileId,
      sourceScopes: Array.isArray(req.body.sourceScopes)
        ? req.body.sourceScopes
        : undefined,
      outputFormats: Array.isArray(req.body.outputFormats)
        ? req.body.outputFormats
        : undefined,
      deliverablesDir: req.body.deliverablesDir,
      requireOutlineApproval: req.body.requireOutlineApproval,
      requireDeliveryApproval: req.body.requireDeliveryApproval,
    });
    auditLog(req, 'report_job_created', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post(
  '/jobs/:id/approve-outline',
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const job = await approveReportOutline(req.params.id as string);
      auditLog(req, 'report_outline_approved', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/jobs/:id/approve-delivery',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const job = approveReportDelivery(req.params.id as string);
      auditLog(req, 'report_delivery_approved', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
