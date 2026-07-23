import { Router, Request, Response } from 'express';

import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  cleanupWorkspace,
  cleanupExpiredWorkspaces,
  type CreateWorkspaceInput,
} from '../../workspace-manager.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

const router = Router();

// List all workspaces
router.get('/', (_req: Request, res: Response) => {
  try {
    const workspaces = listWorkspaces();
    res.json(workspaces);
  } catch (err) {
    logger.error({ err }, 'Failed to list workspaces');
    res.status(500).json({ error: 'Could not list workspaces' });
  }
});

// Create a workspace
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as Partial<CreateWorkspaceInput>;
  if (!body.repo || typeof body.repo !== 'string') {
    res.status(400).json({ error: 'repo is required' });
    return;
  }

  try {
    const workspace = await createWorkspace({
      repo: body.repo,
      branch: body.branch,
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      ttlMinutes: body.ttlMinutes,
    });
    auditLog(req, 'workspace_created', workspace.id);
    res.json({ ok: true, workspace });
  } catch (err) {
    logger.error({ err, repo: body.repo }, 'Failed to create workspace');
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not create workspace',
    });
  }
});

// Get workspace detail
router.get('/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const workspace = getWorkspace(id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }
  res.json(workspace);
});

// Cleanup a specific workspace
router.delete('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const workspace = getWorkspace(id);
  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  try {
    const success = await cleanupWorkspace(id);
    if (!success) {
      res.status(500).json({ error: 'Cleanup failed' });
      return;
    }
    auditLog(req, 'workspace_cleaned', id);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, 'Failed to cleanup workspace');
    res.status(500).json({ error: 'Could not cleanup workspace' });
  }
});

// Cleanup all expired workspaces
router.post('/cleanup-expired', async (_req: Request, res: Response) => {
  try {
    const cleaned = await cleanupExpiredWorkspaces();
    res.json({ ok: true, cleaned });
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup expired workspaces');
    res.status(500).json({ error: 'Could not cleanup expired workspaces' });
  }
});

export default router;
