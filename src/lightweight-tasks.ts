import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

export type LightweightTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LightweightTask {
  id: string;
  repo: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  status: LightweightTaskStatus;
  branch: string | null;
  workspace: string | null;
  output: string;
  exitCode: number | null;
  error: string | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface CreateLightweightTaskInput {
  repo: string;
  prompt: string;
  provider?: string;
  model?: string;
  requestedBy?: string;
}

const TASKS_PATH = path.join(STORE_DIR, 'lightweight-tasks.json');
const MAX_ACTIVE_TASKS = 5;

function readTasks(): LightweightTask[] {
  try {
    return JSON.parse(
      fs.readFileSync(TASKS_PATH, 'utf-8'),
    ) as LightweightTask[];
  } catch {
    return [];
  }
}

function writeTasks(tasks: LightweightTask[]): void {
  fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true });
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2) + '\n');
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafeRepo(repo: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('repo must be in owner/name format');
  }
}

export function createLightweightTask(
  input: CreateLightweightTaskInput,
): LightweightTask {
  assertSafeRepo(input.repo);
  if (!input.prompt || !input.prompt.trim()) {
    throw new Error('prompt is required');
  }

  const tasks = readTasks();
  const activeCount = tasks.filter(
    (t) => t.status === 'queued' || t.status === 'running',
  ).length;
  if (activeCount >= MAX_ACTIVE_TASKS) {
    throw new Error(
      `Maximum active tasks (${MAX_ACTIVE_TASKS}) reached. Wait for tasks to complete or cancel one.`,
    );
  }

  const id = `ltask-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = nowIso();

  const task: LightweightTask = {
    id,
    repo: input.repo,
    prompt: input.prompt.trim(),
    provider: input.provider || null,
    model: input.model || null,
    status: 'queued',
    branch: null,
    workspace: null,
    output: '',
    exitCode: null,
    error: null,
    requestedBy: input.requestedBy || 'admin',
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };

  tasks.push(task);
  writeTasks(tasks);

  logger.info({ id, repo: input.repo }, 'Lightweight task created');
  return task;
}

export function listLightweightTasks(): LightweightTask[] {
  return readTasks();
}

export function getLightweightTask(id: string): LightweightTask | undefined {
  return readTasks().find((t) => t.id === id);
}

export function updateLightweightTask(
  id: string,
  patch: Partial<
    Pick<
      LightweightTask,
      | 'status'
      | 'branch'
      | 'workspace'
      | 'output'
      | 'exitCode'
      | 'error'
      | 'startedAt'
      | 'completedAt'
    >
  >,
): LightweightTask {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('Task not found');

  Object.assign(task, patch);
  writeTasks(tasks);
  return task;
}

export function cancelLightweightTask(id: string): LightweightTask {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'queued' && task.status !== 'running') {
    throw new Error(`Task is ${task.status}, cannot cancel`);
  }

  task.status = 'cancelled';
  task.completedAt = nowIso();
  writeTasks(tasks);

  logger.info({ id }, 'Lightweight task cancelled');
  return task;
}

export function appendTaskOutput(id: string, chunk: string): void {
  const tasks = readTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  // Cap output at 100KB
  task.output = (task.output + chunk).slice(-100_000);
  writeTasks(tasks);
}
