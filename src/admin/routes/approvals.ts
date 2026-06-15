import { Router, Request, Response } from 'express';

import {
  ApprovalKind,
  ApprovalStatus,
  createApproval,
  listApprovals,
  reviewApproval,
} from '../../approvals.js';
import { executeWebhookDeliveryApproval } from '../../webhook-delivery.js';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';

const router = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

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
      risk:
        typeof req.query.risk === 'string'
          ? (req.query.risk as 'low' | 'medium' | 'high')
          : undefined,
      requester: queryString(req.query.requester),
      targetType: queryString(req.query.targetType),
      targetId: queryString(req.query.targetId),
      correlationId: queryString(req.query.correlationId),
      createdFrom: queryString(req.query.createdFrom),
      createdTo: queryString(req.query.createdTo),
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
      source: req.body.source,
      correlationId: req.body.correlationId,
      expiresAt: req.body.expiresAt,
      actionPreview: req.body.actionPreview,
      resourceSummary: req.body.resourceSummary,
      policyDecisionId: req.body.policyDecisionId,
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
  async (req: Request, res: Response) => {
    try {
      const approval = reviewApproval(
        req.params.id as string,
        'approved',
        req.user?.username || 'dashboard',
        typeof req.body.note === 'string' ? req.body.note : undefined,
      );
      if (approval.kind === 'webhook-delivery') {
        await executeWebhookDeliveryApproval(approval);
        auditLog(
          req,
          'approval_webhook_delivered',
          `${approval.kind}/${approval.id}`,
        );
      }
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
