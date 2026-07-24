import { Router, Request, Response } from 'express';

import {
  buildTamperEvidentExport,
  verifyTamperEvidentExport,
} from '../../audit-export.js';
import { listAuditEvents, replayAuditCorrelation } from '../../audit-log.js';
import { buildProofMatrix } from '../../security-proof-matrix.js';
import { evaluatePolicy } from '../../policy-engine.js';
import { logAuditEvent } from '../../audit-log.js';
import { requireRole } from '../middleware.js';

const router = Router();

function queryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

router.use(requireRole('admin'));

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
  // RFC 6266: encode filename safely (date string is ASCII-safe, but be explicit)
  const filename = 'nanocrab-audit-' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="' + filename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
  );
  res.json({ exportedAt: new Date().toISOString(), events });
});

router.get('/export/tamper-evident', (req: Request, res: Response) => {
  const filters = {
    actor: queryString(req.query.actor),
    actorId: queryString(req.query.actorId),
    actionType: queryString(req.query.actionType),
    resource: queryString(req.query.resource),
    decision: queryString(req.query.decision),
    correlationId: queryString(req.query.correlationId),
    from: queryString(req.query.from),
    to: queryString(req.query.to),
    limit: Math.min(parseInt(req.query.limit as string) || 1000, 5000),
  };
  // Fix #3: accept signing key via header instead of query parameter to avoid
  // exposure in server access logs, browser history, and proxy logs.
  const signingKey =
    typeof req.headers['x-signing-key'] === 'string' &&
    req.headers['x-signing-key'].trim()
      ? req.headers['x-signing-key'].trim()
      : undefined;
  const exportData = buildTamperEvidentExport(filters, signingKey);
  logAuditEvent({
    actor: req.user?.username || 'dashboard',
    actionType: 'audit.export.tamper_evident',
    resource: 'audit-log',
    decision: 'allowed',
    context: {
      count: exportData.count,
      keyId: exportData.keyId,
      chainHead: exportData.chainHead,
    },
  });
  res.setHeader('Content-Type', 'application/json');
  // RFC 6266 filename encoding
  const filename = 'nanocrab-audit-chain-' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="' + filename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename),
  );
  res.json(exportData);
});

router.post('/export/verify', (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    res.status(400).json({ error: 'JSON body required' });
    return;
  }
  const signingKey =
    typeof req.body.signingKey === 'string' && req.body.signingKey.trim()
      ? req.body.signingKey.trim()
      : undefined;
  try {
    const report = verifyTamperEvidentExport(req.body.export, signingKey);
    logAuditEvent({
      actor: req.user?.username || 'dashboard',
      actionType: 'audit.export.verify',
      resource: 'audit-log',
      decision: report.valid ? 'allowed' : 'denied',
      context: {
        valid: report.valid,
        signatureValid: report.signatureValid,
        chainValid: report.chainValid,
        count: report.count,
        mutatedEventIndices: report.mutatedEventIndices,
        brokenLinkIndices: report.brokenLinkIndices,
      },
    });
    res.json(report);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/proof-matrix', (_req: Request, res: Response) => {
  res.json(buildProofMatrix());
});

router.get('/replay/:correlationId', (req: Request, res: Response) => {
  res.json(replayAuditCorrelation(req.params.correlationId as string));
});

router.post('/simulate', (req: Request, res: Response) => {
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
});

export default router;
