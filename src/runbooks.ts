import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export type RunbookStatus =
  | 'draft'
  | 'active'
  | 'blocked'
  | 'completed'
  | 'archived';

export type RunbookStepStatus =
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'done'
  | 'skipped';

export interface RunbookStep {
  id: string;
  title: string;
  status: RunbookStepStatus;
  owner?: string;
  notes?: string;
  dueAt?: string;
  updatedAt: string;
}

export interface Runbook {
  id: string;
  title: string;
  mission: string;
  status: RunbookStatus;
  owner: string;
  groupFolder?: string;
  dueAt?: string;
  links: Array<{ label: string; url: string }>;
  steps: RunbookStep[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateRunbookInput {
  title: string;
  mission?: string;
  owner?: string;
  groupFolder?: string;
  dueAt?: string;
  links?: Array<{ label?: string; url?: string }>;
  steps: Array<string | { title?: string; owner?: string; dueAt?: string }>;
}

export interface UpdateRunbookStepInput {
  status?: RunbookStepStatus;
  notes?: string;
  owner?: string;
  dueAt?: string | null;
}

const RUNBOOKS_PATH = path.join(STORE_DIR, 'runbooks.json');
const STEP_STATUSES: RunbookStepStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'skipped',
];

function readRunbooks(): Runbook[] {
  try {
    return JSON.parse(fs.readFileSync(RUNBOOKS_PATH, 'utf-8')) as Runbook[];
  } catch {
    return [];
  }
}

function writeRunbooks(runbooks: Runbook[]): void {
  fs.mkdirSync(path.dirname(RUNBOOKS_PATH), { recursive: true });
  fs.writeFileSync(RUNBOOKS_PATH, `${JSON.stringify(runbooks, null, 2)}\n`);
}

function upsertRunbook(runbook: Runbook): void {
  const runbooks = readRunbooks();
  const idx = runbooks.findIndex((item) => item.id === runbook.id);
  if (idx >= 0) runbooks[idx] = runbook;
  else runbooks.push(runbook);
  writeRunbooks(runbooks);
}

function validateIsoDate(value: string | undefined, label: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} is invalid`);
}

function normalizeLinks(
  links: CreateRunbookInput['links'] = [],
): Runbook['links'] {
  return links
    .map((link) => ({
      label: link.label?.trim() || link.url?.trim() || '',
      url: link.url?.trim() || '',
    }))
    .filter((link) => link.url);
}

function deriveRunbookStatus(steps: RunbookStep[]): RunbookStatus {
  if (steps.length > 0 && steps.every((step) => step.status === 'done')) {
    return 'completed';
  }
  if (steps.some((step) => step.status === 'blocked')) return 'blocked';
  if (steps.some((step) => step.status === 'in_progress')) return 'active';
  return 'active';
}

function summarizeRunbook(runbook: Runbook): Runbook {
  const status = deriveRunbookStatus(runbook.steps);
  const now = new Date().toISOString();
  runbook.status = status;
  runbook.updatedAt = now;
  if (status === 'completed' && !runbook.completedAt) {
    runbook.completedAt = now;
  }
  if (status !== 'completed') delete runbook.completedAt;
  return runbook;
}

export function listRunbooks(
  options: { includeArchived?: boolean } = {},
): Runbook[] {
  return readRunbooks()
    .filter(
      (runbook) => options.includeArchived || runbook.status !== 'archived',
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getRunbook(id: string): Runbook | undefined {
  return readRunbooks().find((runbook) => runbook.id === id);
}

export function createRunbook(input: CreateRunbookInput): Runbook {
  const title = input.title?.trim();
  if (!title) throw new Error('runbook title is required');
  if (!input.steps?.length)
    throw new Error('at least one runbook step is required');
  validateIsoDate(input.dueAt, 'runbook due date');

  const now = new Date().toISOString();
  const steps = input.steps.map((step, index): RunbookStep => {
    const normalized =
      typeof step === 'string'
        ? { title: step }
        : {
            title: step.title,
            owner: step.owner,
            dueAt: step.dueAt,
          };
    const stepTitle = normalized.title?.trim();
    if (!stepTitle) throw new Error(`step ${index + 1} title is required`);
    validateIsoDate(normalized.dueAt, `step ${index + 1} due date`);
    return {
      id: `step-${index + 1}-${crypto.randomBytes(3).toString('hex')}`,
      title: stepTitle,
      status: 'todo',
      owner: normalized.owner?.trim() || input.owner?.trim() || undefined,
      dueAt: normalized.dueAt,
      updatedAt: now,
    };
  });

  const runbook = summarizeRunbook({
    id: `runbook-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    title,
    mission: input.mission?.trim() || title,
    status: 'active',
    owner: input.owner?.trim() || 'dashboard',
    groupFolder: input.groupFolder?.trim() || undefined,
    dueAt: input.dueAt,
    links: normalizeLinks(input.links),
    steps,
    createdAt: now,
    updatedAt: now,
  });
  upsertRunbook(runbook);
  return runbook;
}

export function updateRunbookStep(
  runbookId: string,
  stepId: string,
  input: UpdateRunbookStepInput,
): Runbook {
  const runbook = getRunbook(runbookId);
  if (!runbook) throw new Error(`Runbook not found: ${runbookId}`);
  if (runbook.status === 'archived') {
    throw new Error('archived runbooks cannot be updated');
  }
  const step = runbook.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Runbook step not found: ${stepId}`);
  if (input.status && !STEP_STATUSES.includes(input.status)) {
    throw new Error(`invalid runbook step status: ${input.status}`);
  }
  if (input.dueAt) validateIsoDate(input.dueAt, 'step due date');

  if (input.status) step.status = input.status;
  if (input.notes !== undefined) step.notes = input.notes.trim() || undefined;
  if (input.owner !== undefined) step.owner = input.owner.trim() || undefined;
  if (input.dueAt !== undefined) step.dueAt = input.dueAt || undefined;
  step.updatedAt = new Date().toISOString();

  const updated = summarizeRunbook(runbook);
  upsertRunbook(updated);
  return updated;
}

export function archiveRunbook(id: string): Runbook {
  const runbook = getRunbook(id);
  if (!runbook) throw new Error(`Runbook not found: ${id}`);
  runbook.status = 'archived';
  runbook.updatedAt = new Date().toISOString();
  upsertRunbook(runbook);
  return runbook;
}

export function runbookProgress(runbook: Runbook): {
  total: number;
  done: number;
  blocked: number;
  percent: number;
} {
  const total = runbook.steps.length;
  const done = runbook.steps.filter((step) => step.status === 'done').length;
  const blocked = runbook.steps.filter(
    (step) => step.status === 'blocked',
  ).length;
  return {
    total,
    done,
    blocked,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
