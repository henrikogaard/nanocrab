import { Router, Request, Response } from 'express';

import { listArtifactVault, type ArtifactKind } from '../../artifact-vault.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json({
    artifacts: listArtifactVault({
      query: typeof req.query.query === 'string' ? req.query.query : undefined,
      kind:
        req.query.kind === 'group' || req.query.kind === 'deliverable'
          ? (req.query.kind as ArtifactKind)
          : undefined,
      retentionDays: Math.min(
        parseInt(req.query.retentionDays as string) || 90,
        3650,
      ),
      includeExpired: req.query.includeExpired === 'true',
      limit: Math.min(parseInt(req.query.limit as string) || 100, 1000),
    }),
  });
});

export default router;
