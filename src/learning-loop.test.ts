import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  deriveLearningFromRun,
  listLearningProposals,
  getLearningProposal,
  updateLearningConfig,
  getLearningConfig,
} from './learning-loop.js';
import { STORE_DIR } from './config.js';

const LEARNING_PROPOSALS_PATH = path.join(STORE_DIR, 'learning-proposals.json');
const LEARNING_CONFIG_PATH = path.join(STORE_DIR, 'learning-config.json');
const CODING_JOBS_PATH = path.join(STORE_DIR, 'coding-jobs.json');

function cleanLearningState() {
  try {
    fs.unlinkSync(LEARNING_PROPOSALS_PATH);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(LEARNING_CONFIG_PATH);
  } catch {
    /* ignore */
  }
}

function createTestJob(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'code-test-123',
    repo: 'test/repo',
    type: 'prompt',
    prompt: 'Fix the login bug',
    issueNumber: null,
    issueTitle: null,
    provider: 'claude',
    model: 'claude-sonnet-4-20250514',
    status: 'completed',
    branch: 'nanocrab/fix-login-bug',
    workspace: '/tmp/test',
    createPr: false,
    dryRun: false,
    prUrl: null,
    commitSha: null,
    changedFiles: ['src/login.ts'],
    diffSummary: 'src/login.ts | 5 +++--',
    testSummary: 'All tests passed',
    ciStatus: 'unknown',
    lastCiError: null,
    transitionedAt: { completed: new Date().toISOString() },
    transitionHistory: [],
    failureReason: null,
    approvalHistory: [],
    output: 'Fixed the login validation logic',
    requestedBy: 'test-user',
    agentProfileId: null,
    sourceSubscriptionId: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function writeTestJobs(jobs: Record<string, unknown>[]): void {
  fs.mkdirSync(path.dirname(CODING_JOBS_PATH), { recursive: true });
  fs.writeFileSync(CODING_JOBS_PATH, `${JSON.stringify(jobs, null, 2)}\n`);
}

describe('learning-loop', () => {
  beforeEach(() => {
    cleanLearningState();
    writeTestJobs([createTestJob()]);
  });

  afterEach(() => {
    cleanLearningState();
  });

  describe('deriveLearningFromRun', () => {
    it('derives a learning proposal from an eligible completed run', () => {
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).not.toBeNull();
      expect(proposal!.type).toBe('memory');
      expect(proposal!.sourceRunId).toBe('code-test-123');
      expect(proposal!.status).toBe('pending');
      expect(proposal!.extractedLesson).toContain('Task:');
      expect(proposal!.extractedLesson).toContain('Changes:');
    });

    it('returns null for a failed run when excludeFailed is true', () => {
      writeTestJobs([
        createTestJob({ status: 'failed', failureReason: 'timeout' }),
      ]);
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).toBeNull();
    });

    it('returns null for a cancelled run when excludeCancelled is true', () => {
      writeTestJobs([createTestJob({ status: 'cancelled' })]);
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).toBeNull();
    });

    it('returns null when run output contains secret-bearing content', () => {
      writeTestJobs([createTestJob({ output: 'API key: sk-12345' })]);
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).toBeNull();
    });

    it('returns null when learning loop is disabled', () => {
      updateLearningConfig({ enabled: false });
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).toBeNull();
    });

    it('returns null for a non-existent job', () => {
      const proposal = deriveLearningFromRun('non-existent', 'test-user');
      expect(proposal).toBeNull();
    });
  });

  describe('listLearningProposals', () => {
    it('lists all proposals by default', () => {
      deriveLearningFromRun('code-test-123', 'test-user');
      const proposals = listLearningProposals();
      expect(proposals.length).toBe(1);
    });

    it('filters by sourceRunId', () => {
      deriveLearningFromRun('code-test-123', 'test-user');
      expect(
        listLearningProposals({ sourceRunId: 'code-test-123' }).length,
      ).toBe(1);
      expect(listLearningProposals({ sourceRunId: 'other' }).length).toBe(0);
    });

    it('respects limit', () => {
      deriveLearningFromRun('code-test-123', 'test-user');
      expect(listLearningProposals({ limit: 1 }).length).toBe(1);
    });
  });

  describe('getLearningProposal', () => {
    it('returns a proposal by id', () => {
      const proposal = deriveLearningFromRun('code-test-123', 'test-user');
      expect(proposal).not.toBeNull();
      const fetched = getLearningProposal(proposal!.id);
      expect(fetched).not.toBeUndefined();
      expect(fetched!.id).toBe(proposal!.id);
    });

    it('returns undefined for non-existent id', () => {
      expect(getLearningProposal('non-existent')).toBeUndefined();
    });
  });

  describe('config', () => {
    it('returns default config when no config file exists', () => {
      const config = getLearningConfig();
      expect(config.enabled).toBe(true);
      expect(config.minConfidence).toBe(0.6);
    });

    it('persists config updates', () => {
      updateLearningConfig({ enabled: false, minConfidence: 0.8 });
      const config = getLearningConfig();
      expect(config.enabled).toBe(false);
      expect(config.minConfidence).toBe(0.8);
    });
  });
});
