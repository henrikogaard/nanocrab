import { Router, Request, Response } from 'express';

import {
  ApprovalKind,
  ApprovalStatus,
  createApproval,
  listApprovals,
  reviewApproval,
} from '../../approvals.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  res.json(
    listApprovals({
      status:
        typeof req.query.status === 'string'
          ? (req.query.status as ApprovalStatus)
          : undefined,
      kind:
        typeof req.query.kind === 'string'
          ? (req.query.kind as ApprovalKind)
          : undefined,
      targetType:
        typeof req.query.targetType === 'string'
          ? req.query.targetType
          : undefined,
      targetId:
        typeof req.query.targetId === 'string' ? req.query.targetId : undefined,
      limit: Math.min(parseInt(req.query.limit as string) || 100, 500),
    }),
  );
});

router.post('/', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const approval = createApproval({
      kind: req.body.kind,
      title: req.body.title,
      summary: req.body.summary,
      risk: req.body.risk,
      requester: req.user?.username || 'dashboard',
      targetType: req.body.targetType,
      targetId: req.body.targetId,
      payload:
        req.body.payload && typeof req.body.payload === 'object'
          ? req.body.payload
          : {},
    });
    auditLog(req, 'approval_created', `${approval.kind}/${approval.id}`);
    res.json({ ok: true, approval });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post(
  '/:id/approve',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const approval = reviewApproval(
        req.params.id as string,
        'approved',
        req.user?.username || 'dashboard',
        typeof req.body.note === 'string' ? req.body.note : undefined,
      );
      auditLog(req, 'approval_approved', `${approval.kind}/${approval.id}`);
      res.json({ ok: true, approval });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post(
  '/:id/deny',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const approval = reviewApproval(
        req.params.id as string,
        'denied',
        req.user?.username || 'dashboard',
        typeof req.body.note === 'string' ? req.body.note : undefined,
      );
      auditLog(req, 'approval_denied', `${approval.kind}/${approval.id}`);
      res.json({ ok: true, approval });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
