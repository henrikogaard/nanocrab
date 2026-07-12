import type { PipelineStageKind } from './types.js';

export type StageCheckStatus = 'passed' | 'failed' | 'skipped';

export interface StageCheck {
  name: string;
  status: StageCheckStatus;
  detail?: string;
}

export interface StageArtifact {
  kind: string;
  pathOrUrl: string;
}

export interface StageRunEvidence {
  stageKind: PipelineStageKind;
  worktree: string;
  branch: string;
  commitSha: string | null;
  pushed: boolean;
  prUrl: string | null;
  checks: StageCheck[];
  artifacts: StageArtifact[];
  runId?: string | null;
  agentProfileId?: string | null;
  decisionId?: string | null;
}

export interface CleanupPrecondition {
  ok: boolean;
  reason?: string;
}

export interface CleanupPreconditionContext {
  runActive?: boolean;
  decisionPending?: boolean;
  pushed?: boolean;
  prUrl?: string | null;
}

export function validateStageCompletion(
  evidence: StageRunEvidence,
  priorEvidence?: StageRunEvidence,
): void {
  if (!evidence.worktree || typeof evidence.worktree !== 'string') {
    throw new Error('Stage worktree is required');
  }
  if (!evidence.branch || typeof evidence.branch !== 'string') {
    throw new Error('Stage branch is required');
  }

  if (evidence.stageKind === 'implement') {
    if (!evidence.commitSha) {
      throw new Error('Implement stage requires a commit');
    }
    if (!evidence.pushed || !evidence.prUrl) {
      throw new Error('Implement stage requires a pushed branch and open PR');
    }
    const failed = evidence.checks.filter((c) => c.status === 'failed');
    if (failed.length > 0) {
      throw new Error(
        `Implement stage has failed required checks: ${failed.map((c) => c.name).join(', ')}`,
      );
    }
  }

  if (evidence.stageKind === 'review') {
    if (!priorEvidence) {
      throw new Error('Review stage requires prior stage evidence');
    }
    if (evidence.worktree === priorEvidence.worktree) {
      throw new Error(
        'Review stage must use a different worktree than the prior stage',
      );
    }
    if (
      evidence.agentProfileId &&
      priorEvidence.agentProfileId &&
      evidence.agentProfileId === priorEvidence.agentProfileId
    ) {
      throw new Error(
        'Review stage must use a different agent profile than the prior stage',
      );
    }
    const reviewArtifact = evidence.artifacts.find(
      (a) => a.kind === 'review' || a.kind === 'review_report',
    );
    if (!reviewArtifact) {
      throw new Error('Review stage requires a review artifact');
    }
  }
}

export function validateCleanupPreconditions(
  context: CleanupPreconditionContext,
): CleanupPrecondition {
  if (context.runActive) {
    return {
      ok: false,
      reason: 'Cleanup is blocked while a run is active',
    };
  }
  if (context.decisionPending) {
    return {
      ok: false,
      reason: 'Cleanup is blocked while a decision is pending',
    };
  }
  if (context.pushed === false) {
    return {
      ok: false,
      reason: 'Cleanup is blocked because the branch is not pushed',
    };
  }
  if (context.prUrl) {
    return {
      ok: false,
      reason: 'Cleanup is blocked because a PR remains open',
    };
  }
  return { ok: true };
}
