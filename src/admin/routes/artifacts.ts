import { Router, Request, Response } from 'express';

import {
  buildArtifactVaultFromReports,
  listArtifactVault,
  pruneArtifactVault,
  searchArtifactVault,
} from '../../artifact-vault.js';
import { listReportJobs } from '../../report-jobs.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/vault', (req: Request, res: Response) => {
  res.json(
    searchArtifactVault({
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
      format:
        typeof req.query.format === 'string' ? req.query.format : undefined,
      source:
        typeof req.query.source === 'string' ? req.query.source : undefined,
    }),
  );
});

router.get('/vault/summary', (_req: Request, res: Response) => {
  const records = listArtifactVault();
  const totalSizeBytes = records.reduce(
    (sum, record) => sum + record.sizeBytes,
    0,
  );
  res.json({
    total: records.length,
    totalSizeBytes,
    kinds: Array.from(new Set(records.map((record) => record.kind))).sort(),
    formats: Array.from(new Set(records.map((record) => record.format))).sort(),
  });
});

router.post(
  '/vault/reindex',
  requireRole('admin'),
  (_req: Request, res: Response) => {
    const result = buildArtifactVaultFromReports({ reports: listReportJobs() });
    res.json({ ok: true, ...result });
  },
);

router.post(
  '/vault/prune',
  requireRole('admin'),
  (req: Request, res: Response) => {
    const result = pruneArtifactVault();
    auditLog(req, 'artifact_vault_pruned', 'artifact-vault');
    res.json({ ok: true, ...result });
  },
);

export default router;
