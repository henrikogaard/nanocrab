import { getAgentProfile, getAgentProfileByHandle } from '../agent-profiles.js';
import {
  getApproval,
  reviewApproval,
  type ApprovalRequest,
} from '../approvals.js';
import { logAuditEvent } from '../audit-log.js';
import {
  getPipeline,
  getDecision,
  getStageAssignmentsForIssue,
  insertDecision,
  setDecisionStatus,
  setStageAssignment,
  updateDecisionApprovalId,
  updateDecisionDispatchResult,
  updateDecisionStatus,
} from './store.js';
import {
  dispatchCandidate,
  resumeStage,
  type DispatchCandidateResult,
} from './dispatcher.js';
import { buildStageDispatchKey, resolveStageAssignment } from './pipelines.js';
import {
  StageConflictError,
  updateProjectItemStage,
  type GitHubProjectClient,
} from './github-projects.js';
import type { StageDispatchCandidate } from './sync.js';
import type {
  ControlPlaneDecision,
  ControlPlaneDecisionAction,
  ControlPlaneDecisionStatus,
} from './types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function decisionId(): string {
  return `decision_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isDecisionActorAuthorized(actor: string): boolean {
  return actor === 'owner' || actor === 'admin';
}

function actionToStatus(
  action: ControlPlaneDecisionAction,
): ControlPlaneDecisionStatus {
  if (action === 'approve') return 'approved';
  if (action === 'reject') return 'rejected';
  if (action === 'revise') return 'revised';
  return 'reassigned';
}

export class DecisionResolutionError extends Error {
  decision: ControlPlaneDecision;
  constructor(message: string, decision: ControlPlaneDecision) {
    super(message);
    this.decision = decision;
  }
}

export class DecisionStaleError extends Error {
  decision: ControlPlaneDecision;
  constructor(message: string, decision: ControlPlaneDecision) {
    super(message);
    this.decision = decision;
  }
}

export interface ResolveDecisionInput {
  action: ControlPlaneDecisionAction;
  actor: string;
  note?: string;
  agentHandle?: string;
  source?: string;
}

export interface ProposeStageTransitionInput {
  candidate: StageDispatchCandidate;
  runId: string;
  summary?: string;
  evidence?: Record<string, unknown>;
  decidedFrom?: string;
  correlationId?: string;
}

function buildStageDispatchCandidate(
  pipeline: NonNullable<ReturnType<typeof getPipeline>>,
  decision: ControlPlaneDecision,
  stageId: string,
  agentProfileId: string,
  observedOptionId: string,
  observedFieldUpdatedAt: string,
): StageDispatchCandidate {
  return {
    dispatchKey: buildStageDispatchKey({
      pipelineId: pipeline.pipeline.id,
      projectItemId: decision.projectItemId,
      issueNodeId: decision.issueNodeId,
      stageId,
      agentProfileId,
      githubFieldUpdatedAt: observedFieldUpdatedAt,
    }),
    pipelineId: pipeline.pipeline.id,
    projectItemId: decision.projectItemId,
    issueNodeId: decision.issueNodeId,
    repository: decision.repository,
    issueNumber: decision.issueNumber,
    stageId,
    agentProfileId,
    observedOptionId,
    observedFieldUpdatedAt,
  };
}

function resolveStageAgent(
  pipeline: NonNullable<ReturnType<typeof getPipeline>>,
  issueNodeId: string,
  stageId: string,
): string {
  const assignments = getStageAssignmentsForIssue(
    pipeline.pipeline.id,
    issueNodeId,
  );
  return resolveStageAssignment(pipeline, stageId, issueNodeId, assignments);
}

function applyDispatchResult(
  decision: ControlPlaneDecision,
  result: DispatchCandidateResult,
): ControlPlaneDecision {
  if (result.status === 'dispatched') {
    return updateDecisionDispatchResult(decision.id, {
      actualRuntime: result.actualRuntime || null,
      dispatchStatus: 'dispatched',
      dispatchError: null,
      dispatchJobId: result.job?.id || null,
      runId: result.job?.id || null,
    });
  }
  if (result.status === 'awaiting_fallback_approval') {
    return updateDecisionDispatchResult(decision.id, {
      dispatchStatus: 'awaiting_fallback_approval',
      dispatchError: 'fallback approval required before dispatch',
      dispatchDecisionId: result.decision?.id || null,
    });
  }
  return updateDecisionDispatchResult(decision.id, {
    dispatchStatus: 'dispatch_failed',
    dispatchError: result.error || `dispatch failed (${result.status})`,
  });
}

function requireDecision(
  decisionId: string,
  action: ControlPlaneDecisionAction,
  input: ResolveDecisionInput,
): ControlPlaneDecision {
  const decision = getDecision(decisionId);
  if (!decision) throw new Error(`decision ${decisionId} was not found`);

  if (!isDecisionActorAuthorized(input.actor)) {
    throw new DecisionResolutionError(
      `actor ${input.actor} is not authorized to resolve decisions`,
      decision,
    );
  }

  const targetStatus = actionToStatus(action);
  if (decision.status !== 'pending') {
    if (
      action === 'approve' &&
      decision.status === 'approved' &&
      decision.dispatchStatus === 'dispatch_failed'
    ) {
      return decision;
    }
    if (
      decision.status === targetStatus &&
      decision.decidedBy === input.actor &&
      decision.decisionNote === (input.note || null)
    ) {
      return decision;
    }
    throw new DecisionResolutionError(
      `decision ${decisionId} is already ${decision.status}`,
      decision,
    );
  }

  return decision;
}

function writeTerminalStatus(
  decisionId: string,
  action: ControlPlaneDecisionAction,
  input: ResolveDecisionInput,
): number {
  return updateDecisionStatus(decisionId, actionToStatus(action), {
    decidedBy: input.actor,
    decidedFrom: input.source || null,
    decisionNote: input.note || null,
    decidedAt: nowIso(),
  });
}

export function proposeStageTransition(
  input: ProposeStageTransitionInput,
): ControlPlaneDecision {
  const { candidate, runId } = input;
  const pipeline = getPipeline(candidate.pipelineId);
  if (!pipeline)
    throw new Error(`pipeline ${candidate.pipelineId} was not found`);

  const currentStageIndex = pipeline.stages.findIndex(
    (s) => s.id === candidate.stageId,
  );
  if (currentStageIndex === -1) {
    throw new Error(`stage ${candidate.stageId} was not found`);
  }
  const nextStage = pipeline.stages[currentStageIndex + 1];

  let proposedAgentProfileId: string | null = null;
  let proposedRuntime: import('../types.js').AgentRuntimeSelection | null =
    null;
  if (nextStage) {
    proposedAgentProfileId = resolveStageAgent(
      pipeline,
      candidate.issueNodeId,
      nextStage.id,
    );
    const profile = getAgentProfile(proposedAgentProfileId);
    if (profile) {
      proposedRuntime = profile.primaryRuntime;
    }
  }

  const id = input.correlationId || decisionId();
  const summary =
    input.summary ||
    `Complete ${candidate.stageId} for issue #${candidate.issueNumber}; move to ${nextStage?.stageKind || 'done'}.`;
  const evidence = {
    runId,
    priorStageId: candidate.stageId,
    priorAgentProfileId: candidate.agentProfileId,
    ...input.evidence,
  };

  const decision: ControlPlaneDecision = {
    id,
    kind: 'stage_transition',
    status: 'pending',
    pipelineId: candidate.pipelineId,
    projectItemId: candidate.projectItemId,
    issueNodeId: candidate.issueNodeId,
    repository: candidate.repository,
    issueNumber: candidate.issueNumber,
    stageId: candidate.stageId,
    runId,
    proposedStageId: nextStage ? nextStage.id : null,
    proposedAgentProfileId,
    proposedRuntime,
    expectedGithubOptionId: candidate.observedOptionId,
    expectedGithubFieldUpdatedAt: candidate.observedFieldUpdatedAt,
    actualGithubOptionId: null,
    actualGithubFieldUpdatedAt: null,
    summary,
    evidence,
    decidedBy: null,
    decidedFrom: input.decidedFrom || null,
    decisionNote: null,
    createdAt: nowIso(),
    decidedAt: null,
    actualRuntime: null,
    dispatchStatus: null,
    dispatchError: null,
    dispatchJobId: null,
    dispatchDecisionId: null,
    approvalId: null,
    correlationId: id,
  };

  insertDecision(decision);
  logAuditEvent({
    actor: 'control-plane',
    actionType: 'control_plane.decision.proposed',
    resource: `${candidate.repository}#${candidate.issueNumber}`,
    decision: 'pending',
    correlationId: id,
    context: {
      decisionId: decision.id,
      stageId: candidate.stageId,
      proposedStageId: nextStage?.id,
      proposedAgentProfileId,
      candidate,
    },
  });
  return decision;
}

export async function resolveDecision(
  decisionId: string,
  input: ResolveDecisionInput,
  client?: GitHubProjectClient,
): Promise<ControlPlaneDecision> {
  let decision = requireDecision(decisionId, input.action, input);

  const { action, actor, note, agentHandle, source } = input;

  if (action === 'reject') {
    const changed = writeTerminalStatus(decisionId, action, input);
    if (changed === 0) {
      decision = getDecision(decisionId)!;
      if (decision.status !== 'rejected') {
        throw new DecisionResolutionError(
          `decision ${decisionId} is already ${decision.status}`,
          decision,
        );
      }
    } else {
      decision = getDecision(decisionId)!;
    }
    if (decision.kind === 'runtime_fallback' && decision.approvalId) {
      const approval = getApproval(decision.approvalId);
      if (approval && approval.status === 'pending') {
        reviewApproval(decision.approvalId, 'denied', actor, note);
      }
    }
    logAuditEvent({
      actor,
      actionType: 'control_plane.decision.resolved',
      resource: `${decision.repository}#${decision.issueNumber}`,
      decision: 'denied',
      correlationId: decision.correlationId || decisionId,
      context: { decisionId, action, actor, note, source },
    });
    return decision;
  }

  if (action === 'revise') {
    const changed = writeTerminalStatus(decisionId, action, input);
    if (changed === 0) {
      decision = getDecision(decisionId)!;
      if (decision.status !== 'revised') {
        throw new DecisionResolutionError(
          `decision ${decisionId} is already ${decision.status}`,
          decision,
        );
      }
    } else {
      decision = getDecision(decisionId)!;
    }

    const pipeline = getPipeline(decision.pipelineId)!;
    const agentProfileId = resolveStageAgent(
      pipeline,
      decision.issueNodeId,
      decision.stageId,
    );
    const candidate = buildStageDispatchCandidate(
      pipeline,
      decision,
      decision.stageId,
      agentProfileId,
      decision.expectedGithubOptionId,
      decision.expectedGithubFieldUpdatedAt,
    );
    const result = await resumeStage({ candidate, decisionId, feedback: note });
    decision = applyDispatchResult(decision, result);

    logAuditEvent({
      actor,
      actionType: 'control_plane.decision.resolved',
      resource: `${decision.repository}#${decision.issueNumber}`,
      decision: 'pending',
      correlationId: decision.correlationId || decisionId,
      context: { decisionId, action, actor, note, source },
    });
    return decision;
  }

  if (action === 'reassign') {
    if (!agentHandle) {
      throw new DecisionResolutionError(
        'reassign action requires agentHandle',
        decision,
      );
    }
    const newProfile = getAgentProfileByHandle(agentHandle);
    if (!newProfile) {
      throw new DecisionResolutionError(
        `agent handle ${agentHandle} was not found`,
        decision,
      );
    }

    setStageAssignment({
      id: `assignment_${decisionId}`,
      pipelineId: decision.pipelineId,
      issueNodeId: decision.issueNodeId,
      stageId: decision.stageId,
      agentProfileId: newProfile.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const changed = writeTerminalStatus(decisionId, action, input);
    if (changed === 0) {
      decision = getDecision(decisionId)!;
      if (decision.status !== 'reassigned') {
        throw new DecisionResolutionError(
          `decision ${decisionId} is already ${decision.status}`,
          decision,
        );
      }
    } else {
      decision = getDecision(decisionId)!;
    }

    const pipeline = getPipeline(decision.pipelineId)!;
    const agentProfileId = resolveStageAgent(
      pipeline,
      decision.issueNodeId,
      decision.stageId,
    );
    const candidate = buildStageDispatchCandidate(
      pipeline,
      decision,
      decision.stageId,
      agentProfileId,
      decision.expectedGithubOptionId,
      decision.expectedGithubFieldUpdatedAt,
    );
    const result = await dispatchCandidate(candidate, { decisionId });
    decision = applyDispatchResult(decision, result);

    logAuditEvent({
      actor,
      actionType: 'control_plane.decision.resolved',
      resource: `${decision.repository}#${decision.issueNumber}`,
      decision: 'approved',
      correlationId: decision.correlationId || decisionId,
      context: { decisionId, action, actor, agentHandle, note, source },
    });
    return decision;
  }

  // action === 'approve'
  if (decision.status === 'pending') {
    const changed = writeTerminalStatus(decisionId, action, input);
    if (changed === 0) {
      decision = getDecision(decisionId)!;
      if (
        !(
          decision.status === 'approved' &&
          decision.dispatchStatus === 'dispatch_failed'
        )
      ) {
        throw new DecisionResolutionError(
          `decision ${decisionId} is already ${decision.status}`,
          decision,
        );
      }
    } else {
      decision = getDecision(decisionId)!;
    }
  }

  if (decision.kind === 'runtime_fallback') {
    if (decision.approvalId) {
      const approval = getApproval(decision.approvalId);
      if (approval && approval.status === 'pending') {
        reviewApproval(decision.approvalId, 'approved', actor, note);
      }
    }

    if (!decision.proposedRuntime) {
      throw new DecisionResolutionError(
        'runtime fallback decision has no proposed runtime',
        decision,
      );
    }

    const pipeline = getPipeline(decision.pipelineId)!;
    const agentProfileId =
      decision.proposedAgentProfileId ||
      resolveStageAgent(pipeline, decision.issueNodeId, decision.stageId);
    const candidate = buildStageDispatchCandidate(
      pipeline,
      decision,
      decision.stageId,
      agentProfileId,
      decision.expectedGithubOptionId,
      decision.expectedGithubFieldUpdatedAt,
    );
    const result = await dispatchCandidate(candidate, {
      decisionId,
      forcedRuntime: decision.proposedRuntime,
    });
    decision = applyDispatchResult(decision, result);

    logAuditEvent({
      actor,
      actionType: 'control_plane.decision.resolved',
      resource: `${decision.repository}#${decision.issueNumber}`,
      decision: 'approved',
      correlationId: decision.correlationId || decisionId,
      context: { decisionId, action, actor, note, source },
    });
    return decision;
  }

  // stage_transition approve
  const pipeline = getPipeline(decision.pipelineId)!;

  if (!decision.proposedStageId) {
    logAuditEvent({
      actor,
      actionType: 'control_plane.decision.resolved',
      resource: `${decision.repository}#${decision.issueNumber}`,
      decision: 'approved',
      correlationId: decision.correlationId || decisionId,
      context: { decisionId, action, actor, note, source, terminal: true },
    });
    return decision;
  }

  const proposedStageId = decision.proposedStageId;

  const nextStage = pipeline.stages.find((s) => s.id === proposedStageId);
  if (!nextStage) {
    throw new DecisionResolutionError(
      `proposed stage ${proposedStageId} was not found`,
      decision,
    );
  }

  const githubAlreadyMoved =
    decision.actualGithubOptionId && decision.actualGithubFieldUpdatedAt;

  if (!githubAlreadyMoved) {
    if (!client) {
      throw new DecisionResolutionError(
        'GitHub client is required to approve a stage transition',
        decision,
      );
    }

    try {
      const result = await updateProjectItemStage(client, {
        projectId: pipeline.pipeline.githubProjectId,
        itemId: decision.projectItemId,
        fieldId: pipeline.pipeline.workflowFieldId,
        optionId: nextStage.githubFieldOptionId,
        expectedOptionId: decision.expectedGithubOptionId,
        expectedFieldUpdatedAt: decision.expectedGithubFieldUpdatedAt,
      });
      decision = updateDecisionDispatchResult(decision.id, {
        actualGithubOptionId: result.workflowOptionId,
        actualGithubFieldUpdatedAt: result.fieldUpdatedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof StageConflictError) {
        setDecisionStatus(decisionId, 'stale', {
          decidedBy: actor,
          decisionNote: message,
        });
        const stale = getDecision(decisionId)!;
        throw new DecisionStaleError(
          `decision ${decisionId} is stale: ${message}`,
          stale,
        );
      }
      decision = updateDecisionDispatchResult(decision.id, {
        dispatchStatus: 'dispatch_failed',
        dispatchError: message,
      });
      return decision;
    }
  }

  const agentProfileId = resolveStageAgent(
    pipeline,
    decision.issueNodeId,
    proposedStageId,
  );
  const candidate = buildStageDispatchCandidate(
    pipeline,
    decision,
    proposedStageId,
    agentProfileId,
    decision.actualGithubOptionId!,
    decision.actualGithubFieldUpdatedAt!,
  );
  const result = await dispatchCandidate(candidate, { decisionId });
  decision = applyDispatchResult(decision, result);

  logAuditEvent({
    actor,
    actionType: 'control_plane.decision.resolved',
    resource: `${decision.repository}#${decision.issueNumber}`,
    decision: 'approved',
    correlationId: decision.correlationId || decisionId,
    context: { decisionId, action, actor, note, source },
  });
  return decision;
}
