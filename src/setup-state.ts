import fs from 'fs';
import path from 'path';

export type SetupStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface SetupStepRecord {
  status: SetupStepStatus;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
}

export interface SetupState {
  version: 2;
  updatedAt: string;
  steps: Record<string, SetupStepRecord>;
}

export interface SetupStepResult {
  status?: string;
  message?: string;
  error?: string;
}

const SUCCESS_STEP_STATUSES = new Set([
  'success',
  'already_configured',
  'already_completed',
]);

function now(): string {
  return new Date().toISOString();
}

export function createInitialSetupState(stepNames: string[]): SetupState {
  return {
    version: 2,
    updatedAt: now(),
    steps: Object.fromEntries(
      stepNames.map((step) => [step, { status: 'pending' as const }]),
    ),
  };
}

function normalizeState(raw: unknown, stepNames: string[]): SetupState {
  const state = createInitialSetupState(stepNames);
  if (!raw || typeof raw !== 'object') return state;

  const maybe = raw as {
    completed?: unknown;
    steps?: Record<string, Partial<SetupStepRecord>>;
  };

  if (Array.isArray(maybe.completed)) {
    for (const step of maybe.completed) {
      if (typeof step === 'string' && state.steps[step]) {
        state.steps[step] = { status: 'completed', completedAt: now() };
      }
    }
  }

  if (maybe.steps && typeof maybe.steps === 'object') {
    for (const step of stepNames) {
      const record = maybe.steps[step];
      if (!record) continue;
      const status = record.status;
      if (
        status === 'pending' ||
        status === 'running' ||
        status === 'completed' ||
        status === 'failed'
      ) {
        state.steps[step] = {
          status,
          startedAt: record.startedAt,
          completedAt: record.completedAt,
          failedAt: record.failedAt,
          error: record.error,
        };
      }
    }
  }

  return state;
}

export function readSetupState(
  statePath: string,
  stepNames: string[],
): SetupState {
  let raw: unknown = {};
  const existed = fs.existsSync(statePath);
  try {
    raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    raw = {};
  }

  const state = normalizeState(raw, stepNames);
  let shouldPersist = existed;
  for (const step of stepNames) {
    if (state.steps[step]?.status === 'running') {
      state.steps[step] = {
        ...state.steps[step],
        status: 'failed',
        failedAt: now(),
        error: 'Setup was interrupted while this step was running',
      };
      shouldPersist = true;
    }
  }
  if (shouldPersist) writeSetupState(statePath, state);
  return state;
}

export function writeSetupState(statePath: string, state: SetupState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  state.updatedAt = now();
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(statePath, 0o600);
}

export function markSetupStep(
  state: SetupState,
  step: string,
  status: SetupStepStatus,
  statePath: string,
  error?: string,
): SetupState {
  const previous = state.steps[step] || { status: 'pending' as const };
  const next: SetupStepRecord = { ...previous, status };

  if (status === 'running') {
    next.startedAt = now();
    delete next.completedAt;
    delete next.failedAt;
    delete next.error;
  } else if (status === 'completed') {
    next.completedAt = now();
    delete next.failedAt;
    delete next.error;
  } else if (status === 'failed') {
    next.failedAt = now();
    next.error = error || next.error || 'Step failed';
  } else {
    delete next.completedAt;
    delete next.failedAt;
    delete next.error;
  }

  state.steps[step] = next;
  writeSetupState(statePath, state);
  return state;
}

export function shouldMarkSetupStepCompleted(result: unknown): boolean {
  if (result == null) return true;
  if (typeof result !== 'object') return true;
  const status = (result as SetupStepResult).status;
  if (!status) return true;
  return SUCCESS_STEP_STATUSES.has(status);
}

export function applySetupStepResult(
  state: SetupState,
  step: string,
  result: unknown,
  statePath: string,
): SetupState {
  if (shouldMarkSetupStepCompleted(result)) {
    return markSetupStep(state, step, 'completed', statePath);
  }

  const structured = result as SetupStepResult;
  const status = structured?.status || 'failed';
  const message = structured?.message || structured?.error || status;
  return markSetupStep(state, step, 'failed', statePath, message);
}

export function getNextSetupStep(
  state: SetupState,
  stepNames: string[],
): string | null {
  for (const step of stepNames) {
    const status = state.steps[step]?.status || 'pending';
    if (status === 'failed') return step;
    if (status !== 'completed') return step;
  }
  return null;
}
