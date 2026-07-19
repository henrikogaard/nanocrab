import { randomUUID } from 'crypto';

import type { CodingTimerTransport, SpawnedCodingProcess } from './types.js';

export interface ProcessLease {
  jobId: string;
  attemptId: string;
  leaseToken: string;
  process: SpawnedCodingProcess;
}

export interface ProcessRegistry {
  register(input: {
    jobId: string;
    attemptId: string;
    process: SpawnedCodingProcess;
  }): ProcessLease;
  owns(lease: ProcessLease): boolean;
  get(jobId: string, attemptId: string): ProcessLease | null;
  compareAndDelete(lease: ProcessLease): boolean;
  terminate(lease: ProcessLease, terminal: 'timed_out' | 'cancelled'): boolean;
  terminateAll(jobId: string, terminal: 'timed_out' | 'cancelled'): boolean;
}

interface LeaseRecord {
  lease: ProcessLease;
  terminating: boolean;
  escalationTimer?: unknown;
}

const defaultTimers: CodingTimerTransport = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

function leaseKey(jobId: string, attemptId: string): string {
  return `${jobId}\0${attemptId}`;
}

export function createProcessRegistry(options?: {
  randomToken?: () => string;
  signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
  timers?: CodingTimerTransport;
  graceMs?: number;
}): ProcessRegistry {
  const records = new Map<string, LeaseRecord>();
  const randomToken = options?.randomToken ?? randomUUID;
  const signalGroup =
    options?.signalGroup ??
    ((pid: number, signal: NodeJS.Signals) => {
      process.kill(pid, signal);
    });
  const timers = options?.timers ?? defaultTimers;
  const graceMs = options?.graceMs ?? 5_000;

  function owns(lease: ProcessLease): boolean {
    const current = records.get(leaseKey(lease.jobId, lease.attemptId));
    return current?.lease.leaseToken === lease.leaseToken;
  }

  function compareAndDelete(lease: ProcessLease): boolean {
    if (!owns(lease)) return false;
    const key = leaseKey(lease.jobId, lease.attemptId);
    const record = records.get(key)!;
    if (record.escalationTimer !== undefined) {
      timers.clearTimeout(record.escalationTimer);
    }
    records.delete(key);
    return true;
  }

  function signal(lease: ProcessLease, signalName: NodeJS.Signals): void {
    const signalProcess = () => {
      try {
        lease.process.kill(signalName);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
    };
    if (lease.process.pid && lease.process.pid > 0) {
      try {
        signalGroup(-lease.process.pid, signalName);
        return;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        signalProcess();
        return;
      }
    }
    signalProcess();
  }

  return {
    register(input) {
      const key = leaseKey(input.jobId, input.attemptId);
      if (records.has(key)) {
        throw new Error(
          `Process lease already registered for ${input.jobId}/${input.attemptId}`,
        );
      }
      const lease: ProcessLease = {
        ...input,
        leaseToken: randomToken(),
      };
      records.set(key, { lease, terminating: false });
      return lease;
    },

    owns,

    get(jobId, attemptId) {
      return records.get(leaseKey(jobId, attemptId))?.lease ?? null;
    },

    compareAndDelete,

    terminate(lease, _terminal) {
      if (!owns(lease)) return false;
      const record = records.get(leaseKey(lease.jobId, lease.attemptId))!;
      if (record.terminating) return false;

      record.terminating = true;
      const ownedLease = record.lease;
      signal(ownedLease, 'SIGTERM');
      record.escalationTimer = timers.setTimeout(() => {
        if (!owns(ownedLease)) return;
        signal(ownedLease, 'SIGKILL');
        compareAndDelete(ownedLease);
      }, graceMs);
      return true;
    },

    terminateAll(jobId, terminal) {
      let any = false;
      for (const record of records.values()) {
        if (record.lease.jobId === jobId) {
          any = this.terminate(record.lease, terminal) || any;
        }
      }
      return any;
    },
  };
}

export const codingProcessRegistry: ProcessRegistry = createProcessRegistry();
