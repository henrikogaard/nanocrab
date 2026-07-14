import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { auditLog } from '../../security.js';
import { STORE_DIR } from '../../../config.js';

const router = Router();

interface WorkflowAction {
  type: 'prompt' | 'message' | 'script';
  value: string;
  targetJid?: string;
}

interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: 'cron' | 'webhook' | 'keyword'; value: string };
  actions: WorkflowAction[];
  createdAt: string;
  lastTriggered?: string;
}

const WORKFLOWS_FILE = path.join(STORE_DIR, 'workflows.json');

function loadWorkflows(): Workflow[] {
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf-8'));
    }
  } catch {
    // intentional
  }
  return [];
}

function saveWorkflows(workflows: Workflow[]): void {
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2), 'utf-8');
}

// List all workflows
router.get('/', (_req: Request, res: Response) => {
  res.json(loadWorkflows());
});

// Create a workflow
router.post('/', (req: Request, res: Response) => {
  const { name, trigger, actions, enabled } = req.body;
  if (!name || !trigger || !actions || !Array.isArray(actions)) {
    res.status(400).json({ error: 'name, trigger, and actions are required' });
    return;
  }
  const workflows = loadWorkflows();
  const workflow: Workflow = {
    id: randomUUID(),
    name,
    enabled: enabled !== false,
    trigger,
    actions,
    createdAt: new Date().toISOString(),
  };
  workflows.push(workflow);
  saveWorkflows(workflows);
  auditLog(req, 'workflow_create', `${name} (${workflow.id})`);
  res.json({ ok: true, workflow });
});

// Update a workflow
router.put('/:id', (req: Request, res: Response) => {
  const workflows = loadWorkflows();
  const id = req.params.id as string;
  const idx = workflows.findIndex((w) => w.id === id);
  if (idx === -1) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  const { name, trigger, actions, enabled } = req.body;
  if (name !== undefined) workflows[idx].name = name;
  if (trigger !== undefined) workflows[idx].trigger = trigger;
  if (actions !== undefined) workflows[idx].actions = actions;
  if (enabled !== undefined) workflows[idx].enabled = enabled;
  saveWorkflows(workflows);
  auditLog(req, 'workflow_update', id);
  res.json({ ok: true, workflow: workflows[idx] });
});

// Delete a workflow
router.delete('/:id', (req: Request, res: Response) => {
  const delId = req.params.id as string;
  const workflows = loadWorkflows();
  const idx = workflows.findIndex((w) => w.id === delId);
  if (idx === -1) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  const removed = workflows.splice(idx, 1)[0];
  saveWorkflows(workflows);
  auditLog(req, 'workflow_delete', `${removed.name} (${delId})`);
  res.json({ ok: true, message: 'Workflow deleted' });
});

// Manually trigger a workflow
router.post('/:id/trigger', (req: Request, res: Response) => {
  const trigId = req.params.id as string;
  const workflows = loadWorkflows();
  const workflow = workflows.find((w) => w.id === trigId);
  if (!workflow) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  workflow.lastTriggered = new Date().toISOString();
  saveWorkflows(workflows);
  auditLog(req, 'workflow_trigger', `${workflow.name} (${workflow.id})`);
  // In a full implementation, this would actually execute the workflow actions.
  // For now, it just marks it as triggered and logs the event.
  res.json({
    ok: true,
    message: `Workflow "${workflow.name}" triggered`,
    workflow,
  });
});

export default router;
