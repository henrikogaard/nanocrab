import { Router, Request, Response } from 'express';

import {
  createLightweightTask,
  listLightweightTasks,
  getLightweightTask,
  cancelLightweightTask,
  type CreateLightweightTaskInput,
} from '../../lightweight-tasks.js';
import { loadCodingRepos } from '../../coding-jobs.js';
import { runLightweightTaskQueue } from '../../lightweight-task-runner.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

const router = Router();

// List all lightweight tasks
router.get('/', (_req: Request, res: Response) => {
  const tasks = listLightweightTasks();
  res.json(tasks);
});

// Create a lightweight task
router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<CreateLightweightTaskInput>;
  if (!body.repo || typeof body.repo !== 'string') {
    res.status(400).json({ error: 'repo is required' });
    return;
  }
  if (!body.prompt || typeof body.prompt !== 'string' || !body.prompt.trim()) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  // Verify repo is registered
  const repos = loadCodingRepos();
  const repo = repos.find(
    (r) => r.fullName.toLowerCase() === body.repo!.toLowerCase(),
  );
  if (!repo?.enabled) {
    res.status(400).json({
      error: `Repo ${body.repo} is not registered or not enabled for coding`,
    });
    return;
  }

  try {
    const task = createLightweightTask({
      repo: body.repo,
      prompt: body.prompt,
      provider: body.provider,
      model: body.model,
      requestedBy: body.requestedBy,
    });
    auditLog(req, 'lightweight_task_created', task.id);
    res.json({ ok: true, task });
    // Kick off the queue asynchronously — don't block the HTTP response
    runLightweightTaskQueue().catch((err) => {
      logger.error({ err }, 'Lightweight task queue run failed');
    });
  } catch (err) {
    logger.error({ err, repo: body.repo }, 'Failed to create lightweight task');
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not create task',
    });
  }
});

// Get task detail
router.get('/:id', (req: Request, res: Response) => {
  const task = getLightweightTask(String(req.params.id));
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// Cancel a task
router.post('/:id/cancel', (req: Request, res: Response) => {
  try {
    const task = cancelLightweightTask(String(req.params.id));
    auditLog(req, 'lightweight_task_cancelled', task.id);
    res.json({ ok: true, task });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Could not cancel task',
    });
  }
});

export default router;
