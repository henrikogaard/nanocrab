import { Router, Request, Response } from 'express';

import {
  approveMemory,
  listMemoryReviewQueue,
  listMemoryRecords,
  markMemoryContradicted,
  markMemoryStale,
  rejectMemory,
} from '../../memory-store.js';
import { MemoryStatus } from '../../types.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

function parseMemoryStatus(value: unknown): MemoryStatus | undefined {
  return typeof value === 'string' &&
    ['pending', 'approved', 'rejected', 'stale', 'contradicted'].includes(value)
    ? (value as MemoryStatus)
    : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

router.get('/', (req: Request, res: Response) => {
  const filters = {
    status: parseMemoryStatus(req.query.status),
    scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
    visibility:
      typeof req.query.visibility === 'string'
        ? req.query.visibility
        : undefined,
    source: typeof req.query.source === 'string' ? req.query.source : undefined,
    confidenceMin: parseNumber(req.query.confidenceMin),
    confidenceMax: parseNumber(req.query.confidenceMax),
    staleBefore:
      typeof req.query.staleBefore === 'string'
        ? req.query.staleBefore
        : undefined,
    contradictionGroup:
      typeof req.query.contradictionGroup === 'string'
        ? req.query.contradictionGroup
        : undefined,
    limit: Math.min(parseInt(req.query.limit as string) || 100, 200),
  };
  if (req.query.review === 'true') {
    res.json(listMemoryReviewQueue(filters));
    return;
  }
  res.json(listMemoryRecords(filters));
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
