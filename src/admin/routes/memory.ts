import { Router, Request, Response } from 'express';

import {
  approveMemory,
  listMemoryReviewQueue,
  listMemoryRecords,
  markMemoryContradicted,
  markMemoryStale,
  rejectMemory,
  MemoryReviewReason,
} from '../../memory-store.js';
import { MemoryStatus } from '../../types.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const sensitivity =
    req.query.sensitivity === 'normal' ||
    req.query.sensitivity === 'sensitive' ||
    req.query.sensitivity === 'secret-note'
      ? req.query.sensitivity
      : undefined;
  const reviewReason =
    typeof req.query.reason === 'string' &&
    [
      'pending',
      'sensitive',
      'secret-note',
      'stale',
      'expired',
      'contradiction',
    ].includes(req.query.reason)
      ? (req.query.reason as MemoryReviewReason)
      : undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
  if (req.query.review === 'true') {
    res.json(
      listMemoryReviewQueue({
        sensitivity,
        reason: reviewReason,
        limit,
      }),
    );
    return;
  }
  const status =
    typeof req.query.status === 'string' &&
    ['pending', 'approved', 'rejected', 'stale', 'contradicted'].includes(
      req.query.status,
    )
      ? (req.query.status as MemoryStatus)
      : undefined;
  res.json(
    listMemoryRecords({
      status,
      scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
      visibility:
        typeof req.query.visibility === 'string'
          ? req.query.visibility
          : undefined,
      sensitivity,
      reviewReason,
      limit,
    }),
  );
});

router.post(
  '/:id/approve',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const memory = approveMemory(req.params.id as string);
      auditLog(req, 'memory_approved', memory.id);
      res.json({ ok: true, memory });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/:id/reject',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const memory = rejectMemory(req.params.id as string);
      auditLog(req, 'memory_rejected', memory.id);
      res.json({ ok: true, memory });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/:id/stale',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const memory = markMemoryStale(req.params.id as string);
      auditLog(req, 'memory_marked_stale', memory.id);
      res.json({ ok: true, memory });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/:id/contradicted',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const memory = markMemoryContradicted(req.params.id as string);
      auditLog(req, 'memory_marked_contradicted', memory.id);
      res.json({ ok: true, memory });
    } catch (err) {
      res.status(404).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
