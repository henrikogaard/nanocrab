import { Router, Request, Response } from 'express';

import {
  getSourceCollection,
  getSourceCollectionByReportJobId,
  getSourceLedger,
  listSourceCollections,
  retrySourceCollection,
  type SourceCollectionStatus,
} from '../../source-collection.js';
import { requireRole } from '../middleware.js';

const router = Router();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function queryParam(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  if (typeof value === 'string') return value;
  return undefined;
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value as string);
}

router.get('/', (req: Request, res: Response) => {
  try {
    const status = queryParam(req, 'status') as
      | SourceCollectionStatus
      | undefined;
    res.json(
      listSourceCollections({
        status,
        reportJobId: queryParam(req, 'reportJobId'),
        limit: req.query.limit
          ? parseInt(queryParam(req, 'limit') || '100', 10)
          : 100,
      }),
    );
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/ledger', (req: Request, res: Response) => {
  try {
    res.json(getSourceLedger(queryParam(req, 'reportJobId')));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = routeParam(req, 'id');
    const collection =
      getSourceCollection(id) || getSourceCollectionByReportJobId(id);
    if (!collection) {
      res.status(404).json({ error: 'Source collection not found' });
      return;
    }
    res.json(collection);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post(
  '/:id/retry',
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const id = routeParam(req, 'id');
      const collection = getSourceCollection(id);
      if (!collection) {
        res.status(404).json({ error: 'Source collection not found' });
        return;
      }
      const actorContext = collection.actorContext || {
        actor: req.user?.username || 'dashboard',
        groupFolder: 'dashboard',
        agentId: req.user?.id,
        isMain: req.user?.role === 'owner',
      };
      const updated = await retrySourceCollection(id, actorContext);
      res.json({ ok: true, collection: updated });
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
    }
  },
);

export default router;
