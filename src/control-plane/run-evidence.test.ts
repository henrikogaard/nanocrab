import { describe, it, expect } from 'vitest';
import {
  validateStageCompletion,
  validateCleanupPreconditions,
  type StageRunEvidence,
} from './run-evidence.js';

describe('run evidence', () => {
  const baseImplementEvidence: StageRunEvidence = {
    stageKind: 'implement',
    worktree: '/data/coding-workspaces/job_1',
    branch: 'feature/109-slice',
    commitSha: 'abc123',
    pushed: true,
    prUrl: 'https://github.com/owner/repo/pull/5',
    checks: [{ name: 'focused', status: 'passed' }],
    artifacts: [{ kind: 'diff', pathOrUrl: '/data/coding-workspaces/job_1' }],
  };

  it('accepts complete implement evidence', () => {
    expect(() => validateStageCompletion(baseImplementEvidence)).not.toThrow();
  });

  it('refuses implement transition without a pushed branch and PR', () => {
    expect(() =>
      validateStageCompletion({
        ...baseImplementEvidence,
        pushed: false,
        prUrl: null,
      }),
    ).toThrow(/pushed branch and open PR/i);
  });

  it('refuses implement transition with a failed required check', () => {
    expect(() =>
      validateStageCompletion({
        ...baseImplementEvidence,
        checks: [{ name: 'focused', status: 'failed' }],
      }),
    ).toThrow(/failed required checks/i);
  });

  it('refuses implement transition without a commit', () => {
    expect(() =>
      validateStageCompletion({
        ...baseImplementEvidence,
        commitSha: null,
      }),
    ).toThrow(/requires a commit/i);
  });

  it('refuses review transition without a different worktree and profile', () => {
    const prior: StageRunEvidence = {
      ...baseImplementEvidence,
      stageKind: 'implement',
      agentProfileId: 'agent_1',
    };
    expect(() =>
      validateStageCompletion(
        {
          ...baseImplementEvidence,
          stageKind: 'review',
          worktree: prior.worktree,
          agentProfileId: prior.agentProfileId,
          artifacts: [{ kind: 'review', pathOrUrl: '/review.md' }],
        },
        prior,
      ),
    ).toThrow(/different worktree/i);
  });

  it('refuses review transition without a review artifact', () => {
    const prior: StageRunEvidence = {
      ...baseImplementEvidence,
      stageKind: 'implement',
      agentProfileId: 'agent_1',
    };
    expect(() =>
      validateStageCompletion(
        {
          ...baseImplementEvidence,
          stageKind: 'review',
          worktree: '/data/coding-workspaces/job_2',
          agentProfileId: 'agent_2',
          artifacts: [],
        },
        prior,
      ),
    ).toThrow(/review artifact/i);
  });

  it('accepts review evidence with a different worktree, profile, and review artifact', () => {
    const prior: StageRunEvidence = {
      ...baseImplementEvidence,
      stageKind: 'implement',
      agentProfileId: 'agent_1',
    };
    expect(() =>
      validateStageCompletion(
        {
          ...baseImplementEvidence,
          stageKind: 'review',
          worktree: '/data/coding-workspaces/job_2',
          agentProfileId: 'agent_2',
          artifacts: [{ kind: 'review_report', pathOrUrl: '/review.md' }],
        },
        prior,
      ),
    ).not.toThrow();
  });

  it('accepts planning evidence with only worktree and branch', () => {
    expect(() =>
      validateStageCompletion({
        stageKind: 'planning',
        worktree: '/data/coding-workspaces/job_plan',
        branch: 'plan/109',
        commitSha: null,
        pushed: false,
        prUrl: null,
        checks: [],
        artifacts: [],
      }),
    ).not.toThrow();
  });

  it('blocks cleanup while a run is active', () => {
    const result = validateCleanupPreconditions({
      runActive: true,
      decisionPending: false,
      pushed: true,
      prUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/run is active/i);
  });

  it('blocks cleanup while a decision is pending', () => {
    const result = validateCleanupPreconditions({
      runActive: false,
      decisionPending: true,
      pushed: true,
      prUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/decision is pending/i);
  });

  it('blocks cleanup when the branch is not pushed', () => {
    const result = validateCleanupPreconditions({
      runActive: false,
      decisionPending: false,
      pushed: false,
      prUrl: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/branch is not pushed/i);
  });

  it('blocks cleanup when a PR remains open', () => {
    const result = validateCleanupPreconditions({
      runActive: false,
      decisionPending: false,
      pushed: true,
      prUrl: 'https://github.com/owner/repo/pull/5',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/PR remains open/i);
  });

  it('allows cleanup when all preconditions are met', () => {
    const result = validateCleanupPreconditions({
      runActive: false,
      decisionPending: false,
      pushed: true,
      prUrl: null,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});
