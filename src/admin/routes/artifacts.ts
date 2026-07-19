import { Router, Request, Response } from 'express';
import path from 'path';

import {
  buildArtifactVaultFromCoworkArtifacts,
  buildArtifactVaultFromReports,
  getArtifactVaultRecord,
  ingestArtifactFromSource,
  listArtifactVault,
  pruneArtifactVault,
  resolveArtifactVaultPath,
  searchArtifactVault,
} from '../../artifact-vault.js';
import { coworkProjectPath } from '../../cowork-projects.js';
import { getCoworkContextItems, getCoworkProjects } from '../../db.js';
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
    const reportResult = buildArtifactVaultFromReports({
      reports: listReportJobs(),
    });
    const coworkArtifacts = getCoworkProjects().flatMap((project) =>
      getCoworkContextItems(project.id)
        .filter((item) => item.included !== 0 && item.type === 'artifact')
        .filter((item) => Boolean(item.path))
        .map((item) => ({
          projectId: project.id,
          projectName: project.name,
          projectSlug: project.slug,
          title: item.title || path.basename(item.path || ''),
          filePath: item.path || '',
          hostPath: path.join(coworkProjectPath(project), item.path || ''),
          artifactId: item.artifact_id || item.id,
          sourceLinks: [
            item.artifact_id
              ? {
                  label: 'Cowork artifact',
                  source: `cowork-artifact:${item.artifact_id}`,
                }
              : null,
            item.provenance
              ? {
                  label: 'Project provenance',
                  source: `cowork-provenance:${item.provenance}`,
                }
              : null,
          ].filter((link): link is { label: string; source: string } =>
            Boolean(link),
          ),
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        })),
    );
    const coworkResult = buildArtifactVaultFromCoworkArtifacts({
      artifacts: coworkArtifacts,
    });
    res.json({
      ok: true,
      added: reportResult.added + coworkResult.added,
      updated: reportResult.updated + coworkResult.updated,
      total: coworkResult.total,
      reports: reportResult,
      cowork: coworkResult,
    });
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

router.post(
  '/vault/ingest',
  requireRole('admin'),
  (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const result = ingestArtifactFromSource({
        title: body.title,
        kind: body.kind,
        format: body.format,
        path: body.path,
        sourceType: body.sourceType,
        sourceId: body.sourceId,
        sourceLinks: Array.isArray(body.sourceLinks) ? body.sourceLinks : [],
        projectId: body.projectId,
        projectSlug: body.projectSlug,
        projectName: body.projectName,
        projectFilePath: body.projectFilePath,
        retentionDays: body.retentionDays,
        tags: body.tags,
      });
      auditLog(req, 'artifact_vault_ingested', result.record.id);
      res.json({ ok: true, ...result });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.get('/vault/:id', (req: Request, res: Response) => {
  try {
    const record = getArtifactVaultRecord(req.params.id as string);
    if (!record) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    res.json(record);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/vault/:id/download', requireRole('admin'), (req: Request, res: Response) => {
  try {
    const record = getArtifactVaultRecord(req.params.id as string);
    if (!record) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }
    const resolved = resolveArtifactVaultPath(record);
    auditLog(req, 'artifact_vault_downloaded', record.id);
    res.download(resolved.path);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
