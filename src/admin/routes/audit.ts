import { Router, Request, Response } from 'express';

import { listAuditEvents, replayAuditCorrelation } from '../../audit-log.js';
import { evaluatePolicy } from '../../policy-engine.js';
import { logAuditEvent } from '../../audit-log.js';
import { requireRole } from '../middleware.js';

const router = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

router.get('/', (req: Request, res: Response) => {
  res.json(
    listAuditEvents({
      actor: queryString(req.query.actor),
      actorId: queryString(req.query.actorId),
      actionType: queryString(req.query.actionType),
      resource: queryString(req.query.resource),
      decision: queryString(req.query.decision),
      correlationId: queryString(req.query.correlationId),
      from: queryString(req.query.from),
      to: queryString(req.query.to),
      limit: Math.min(parseInt(req.query.limit as string) || 100, 1000),
    }),
  );
});

router.get('/export', (req: Request, res: Response) => {
  const events = listAuditEvents({
    actor: queryString(req.query.actor),
    actorId: queryString(req.query.actorId),
    actionType: queryString(req.query.actionType),
    resource: queryString(req.query.resource),
    decision: queryString(req.query.decision),
    correlationId: queryString(req.query.correlationId),
    from: queryString(req.query.from),
    to: queryString(req.query.to),
    limit: Math.min(parseInt(req.query.limit as string) || 1000, 1000),
  });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nanocrab-audit-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json({ exportedAt: new Date().toISOString(), events });
});

router.get('/replay/:correlationId', (req: Request, res: Response) => {
  res.json(replayAuditCorrelation(req.params.correlationId as string));
});

router.post(
  '/simulate',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const decision = evaluatePolicy({
        actor:
          typeof req.body.actor === 'string' && req.body.actor.trim()
            ? req.body.actor.trim()
            : req.user?.username || 'dashboard',
        actorId: typeof req.body.actorId === 'string' ? req.body.actorId : null,
        actionType:
          typeof req.body.actionType === 'string' && req.body.actionType.trim()
            ? req.body.actionType.trim()
            : 'tool.action',
        resource:
          typeof req.body.resource === 'string' && req.body.resource.trim()
            ? req.body.resource.trim()
            : 'simulated-resource',
        dryRun: req.body.dryRun === true,
        context:
          req.body.context && typeof req.body.context === 'object'
            ? req.body.context
            : {},
      });
      logAuditEvent({
        actor: req.user?.username || 'dashboard',
        actionType: 'policy.simulate',
        resource: decision.resource,
        decision: decision.decision,
        correlationId:
          typeof req.body.correlationId === 'string'
            ? req.body.correlationId
            : null,
        context: decision,
      });
      res.json({ ok: true, decision });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

export default router;
