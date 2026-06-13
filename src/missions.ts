import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { STORE_DIR } from './config.js';

export type MissionStatus = 'pending' | 'running' | 'completed' | 'blocked';
export type MissionStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'blocked'
  | 'skipped';

export interface RunbookStep {
  id: string;
  title: string;
  detail?: string;
  requiresApproval: boolean;
}

export interface Runbook {
  id: string;
  title: string;
  description?: string;
  steps: RunbookStep[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionStep extends RunbookStep {
  status: MissionStepStatus;
  note?: string;
  approvalId?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface Mission {
  id: string;
  title: string;
  owner?: string;
  runbookId?: string;
  status: MissionStatus;
  steps: MissionStep[];
  createdAt: string;
  updatedAt: string;
}

export interface MissionStore {
  runbooks: Runbook[];
  missions: Mission[];
}

export interface MissionStoreOptions {
  storePath?: string;
  now?: () => string;
}

export interface CreateRunbookInput {
  title: string;
  description?: string;
  steps: Array<{
    title: string;
    detail?: string;
    requiresApproval?: boolean;
  }>;
}

export interface CreateMissionInput {
  title: string;
  owner?: string;
  runbookId?: string;
  steps?: Array<{
    title: string;
    detail?: string;
    requiresApproval?: boolean;
  }>;
}

export interface UpdateMissionStepInput {
  status: MissionStepStatus;
  note?: string;
  approvalId?: string;
}

export const DEFAULT_MISSION_STORE = path.join(STORE_DIR, 'missions.json');

function now(options?: MissionStoreOptions) {
  return options?.now?.() || new Date().toISOString();
}

function storePath(options?: MissionStoreOptions) {
  return options?.storePath || DEFAULT_MISSION_STORE;
}

function emptyStore(): MissionStore {
  return { runbooks: [], missions: [] };
}

export function loadMissionStore(
  filePath = DEFAULT_MISSION_STORE,
): MissionStore {
  try {
    if (!fs.existsSync(filePath)) return emptyStore();
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<MissionStore>;
    return {
      runbooks: Array.isArray(raw.runbooks) ? raw.runbooks : [],
      missions: Array.isArray(raw.missions) ? raw.missions : [],
    };
  } catch {
    return emptyStore();
  }
}

export function saveMissionStore(
  store: MissionStore,
  filePath = DEFAULT_MISSION_STORE,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
}

function assertTitle(title: string, field = 'title') {
  if (!title || !title.trim()) throw new Error(`${field} is required`);
}

function normalizeRunbookSteps(
  input: CreateRunbookInput['steps'],
): RunbookStep[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('At least one runbook step is required');
  }
  return input.map((step, index) => {
    assertTitle(step.title, `steps[${index}].title`);
    return {
      id: randomUUID(),
      title: step.title.trim(),
      detail: step.detail?.trim() || undefined,
      requiresApproval: step.requiresApproval === true,
    };
  });
}

function missionStepsFromRunbook(steps: RunbookStep[], timestamp: string) {
  return steps.map((step) => ({
    ...step,
    status: 'pending' as MissionStepStatus,
    updatedAt: timestamp,
  }));
}

export function createRunbook(
  input: CreateRunbookInput,
  options?: MissionStoreOptions,
): Runbook {
  assertTitle(input.title);
  const timestamp = now(options);
  const store = loadMissionStore(storePath(options));
  const runbook: Runbook = {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    steps: normalizeRunbookSteps(input.steps),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.runbooks.push(runbook);
  saveMissionStore(store, storePath(options));
  return runbook;
}

export function createMissionFromRunbook(
  input: CreateMissionInput,
  options?: MissionStoreOptions,
): Mission {
  assertTitle(input.title);
  const timestamp = now(options);
  const store = loadMissionStore(storePath(options));
  const runbook = input.runbookId
    ? store.runbooks.find((candidate) => candidate.id === input.runbookId)
    : undefined;
  const sourceSteps = runbook
    ? runbook.steps
    : normalizeRunbookSteps(input.steps || []);
  const mission: Mission = {
    id: randomUUID(),
    title: input.title.trim(),
    owner: input.owner?.trim() || undefined,
    runbookId: runbook?.id,
    status: 'pending',
    steps: missionStepsFromRunbook(sourceSteps, timestamp),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.missions.push(mission);
  saveMissionStore(store, storePath(options));
  return mission;
}

function summarizeMissionStatus(steps: MissionStep[]): MissionStatus {
  if (steps.some((step) => step.status === 'blocked')) return 'blocked';
  if (steps.every((step) => ['completed', 'skipped'].includes(step.status))) {
    return 'completed';
  }
  if (steps.some((step) => step.status !== 'pending')) return 'running';
  return 'pending';
}

export function updateMissionStep(
  missionId: string,
  stepId: string,
  input: UpdateMissionStepInput,
  options?: MissionStoreOptions,
): Mission {
  const store = loadMissionStore(storePath(options));
  const mission = store.missions.find(
    (candidate) => candidate.id === missionId,
  );
  if (!mission) throw new Error('Mission not found');
  const step = mission.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error('Mission step not found');
  if (
    step.requiresApproval &&
    input.status === 'completed' &&
    !input.approvalId &&
    !step.approvalId
  ) {
    throw new Error('Approval reference is required to complete this step');
  }

  const timestamp = now(options);
  step.status = input.status;
  step.note = input.note?.trim() || step.note;
  step.approvalId = input.approvalId?.trim() || step.approvalId;
  step.updatedAt = timestamp;
  if (input.status === 'running' && !step.startedAt) step.startedAt = timestamp;
  if (input.status === 'completed') step.completedAt = timestamp;
  mission.status = summarizeMissionStatus(mission.steps);
  mission.updatedAt = timestamp;
  saveMissionStore(store, storePath(options));
  return mission;
}
