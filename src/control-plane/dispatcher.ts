import crypto from 'crypto';

import { getAgentProfile } from '../agent-profiles.js';
import { isCodingCapableProvider } from '../agent-provider.js';
import { isAgentCliId, probeAgentRuntime } from '../agent-runtime-registry.js';
import type { AgentRuntimeHealth } from '../types.js';
import { startCodingJob, type CodingJob } from '../coding-jobs.js';
import { createApproval } from '../approvals.js';
import { logAuditEvent } from '../audit-log.js';
import type { AgentRuntimeSelection } from '../types.js';
import {
  getPipeline,
  insertDecision,
  getDecision as getDecisionRecord,
  updateDecisionApprovalId,
  updateDecisionDispatchResult as _updateDecisionDispatchResult,
} from './store.js';
import type { StageDispatchCandidate } from './sync.js';
import type { ControlPlaneDecision, PipelineStageKind } from './types.js';

export const runtime = {
  probe: probeAgentRuntime,
};

export interface DispatchCandidateOptions {
  decisionId?: string;
  forcedRuntime?: AgentRuntimeSelection;
  feedback?: string;
}

export interface DispatchCandidateResult {
  status:
    | 'dispatched'
    | 'awaiting_fallback_approval'
    | 'dispatch_failed'
    | 'error';
  job?: CodingJob;
  decision?: ControlPlaneDecision;
  actualRuntime?: AgentRuntimeSelection;
  error?: string;
}

export interface RequestRuntimeFallbackOptions {
  primaryHealth?: AgentRuntimeHealth;
  primaryRuntime?: AgentRuntimeSelection;
  reason?: string;
}

export interface ResumeStageInput {
  candidate: StageDispatchCandidate;
  decisionId?: string;
  feedback?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function decisionId(): string {
  return `decision_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function buildStagePrompt(
  stageKind: PipelineStageKind,
  issueNumber: number,
  issueTitle?: string,
  feedback?: string,
): string {
  const title = issueTitle ? `: ${issueTitle}` : '';
  let prompt = '';
  if (stageKind === 'planning') {
    prompt = `Produce a structured implementation plan for issue #${issueNumber}${title}. Do not implement; focus on architecture, files, and tests.`;
  } else if (stageKind === 'implement') {
    prompt = `Implement the approved plan for issue #${issueNumber}${title}. Add focused tests and verification.`;
  } else if (stageKind === 'review') {
    prompt = `Review the implementation for issue #${issueNumber}${title}. Read the diff, tests, and PR state, then provide findings and a recommended outcome.`;
  }
  if (feedback) {
    prompt = `Owner feedback: ${feedback}\n\n${prompt}`;
  }
  return prompt;
}

function isRuntimeAvailable(
  runtime: AgentRuntimeSelection,
  health: AgentRuntimeHealth,
): boolean {
  return (
    health.status === 'healthy' &&
    isCodingCapableProvider(runtime.provider, runtime.model)
  );
}

function validateCandidate(candidate: StageDispatchCandidate): {
  pipeline: NonNullable<ReturnType<typeof getPipeline>>;
  stage: { id: string; stageKind: PipelineStageKind };
} {
  const pipeline = getPipeline(candidate.pipelineId);
  if (!pipeline)
    throw new Error(`pipeline ${candidate.pipelineId} was not found`);
  if (!pipeline.pipeline.enabled)
    throw new Error(`pipeline ${candidate.pipelineId} is disabled`);
  const stage = pipeline.stages.find((s) => s.id === candidate.stageId);
  if (!stage) throw new Error(`stage ${candidate.stageId} was not found`);
  if (!pipeline.pipeline.repositoryScopes.includes(candidate.repository)) {
    throw new Error(
      'candidate repository is outside the pipeline repository scope',
    );
  }
  return { pipeline, stage };
}

export function requestRuntimeFallback(
  candidate: StageDispatchCandidate,
  fallbackRuntime: AgentRuntimeSelection,
  options: RequestRuntimeFallbackOptions = {},
): ControlPlaneDecision {
  const { pipeline: _pipeline, stage } = validateCandidate(candidate);
  const profile = getAgentProfile(candidate.agentProfileId);
  if (!profile)
    throw new Error(`agent profile ${candidate.agentProfileId} was not found`);

  if (!isAgentCliId(fallbackRuntime.cli)) {
    throw new Error(`fallback CLI ${fallbackRuntime.cli} is not supported`);
  }

  const id = decisionId();
  const summary = `Primary CLI ${options.primaryRuntime?.cli || 'unknown'} is unavailable for ${stage.stageKind}; fallback ${fallbackRuntime.cli} / ${fallbackRuntime.provider} / ${fallbackRuntime.model} is proposed.`;
  const decision: ControlPlaneDecision = {
    id,
    kind: 'runtime_fallback',
    status: 'pending',
    pipelineId: candidate.pipelineId,
    projectItemId: candidate.projectItemId,
    issueNodeId: candidate.issueNodeId,
    repository: candidate.repository,
    issueNumber: candidate.issueNumber,
    stageId: candidate.stageId,
    runId: null,
    proposedStageId: null,
    proposedAgentProfileId: candidate.agentProfileId,
    proposedRuntime: fallbackRuntime,
    expectedGithubOptionId: candidate.observedOptionId,
    expectedGithubFieldUpdatedAt: candidate.observedFieldUpdatedAt,
    actualGithubOptionId: null,
    actualGithubFieldUpdatedAt: null,
    summary,
    evidence: {
      primaryRuntime: options.primaryRuntime ?? null,
      primaryHealth: options.primaryHealth ?? null,
      fallbackRuntime,
      reason: options.reason || 'primary CLI unavailable',
    },
    decidedBy: null,
    decidedFrom: null,
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

  const approval = createApproval({
    kind: 'provider-fallback',
    title: `Fallback runtime for issue #${candidate.issueNumber} in ${stage.stageKind}`,
    summary,
    risk: 'high',
    requester: 'control-plane',
    targetType: 'control-plane-decision',
    targetId: decision.id,
    policyDecisionId: decision.id,
    correlationId: id,
    source: 'control-plane',
    payload: {
      decisionId: decision.id,
      candidate,
      primaryRuntime: options.primaryRuntime,
      fallbackRuntime,
    },
  });
  updateDecisionApprovalId(decision.id, approval.id);

  logAuditEvent({
    actor: 'control-plane',
    actionType: 'control_plane.decision.fallback.created',
    resource: `${candidate.repository}#${candidate.issueNumber}`,
    decision: 'requires_approval',
    correlationId: id,
    context: {
      decisionId: decision.id,
      stageId: candidate.stageId,
      primaryRuntime: options.primaryRuntime,
      fallbackRuntime,
      candidate,
    },
  });

  return getDecisionRecord(id)!;
}

export async function dispatchCandidate(
  candidate: StageDispatchCandidate,
  options: DispatchCandidateOptions = {},
): Promise<DispatchCandidateResult> {
  const { pipeline: _pipeline, stage } = validateCandidate(candidate);

  if (options.decisionId) {
    const existing = getDecisionRecord(options.decisionId);
    if (
      existing &&
      existing.status === 'approved' &&
      existing.dispatchStatus === 'dispatched' &&
      existing.dispatchJobId
    ) {
      const job = (await import('../coding-jobs.js')).getCodingJob(
        existing.dispatchJobId,
      );
      if (job) {
        return {
          status: 'dispatched',
          job,
          actualRuntime:
            job.actualRuntime || existing.actualRuntime || undefined,
        };
      }
    }
  }

  const profile = getAgentProfile(candidate.agentProfileId);
  if (!profile) {
    throw new Error(`agent profile ${candidate.agentProfileId} was not found`);
  }
  if (!profile.enabled) {
    throw new Error(`agent profile ${candidate.agentProfileId} is disabled`);
  }

  let selectedRuntime: AgentRuntimeSelection;
  if (options.forcedRuntime) {
    selectedRuntime = options.forcedRuntime;
  } else {
    const primary = profile.primaryRuntime;
    if (!primary) {
      return {
        status: 'error',
        error: `agent profile ${profile.handle} has no primary runtime`,
      };
    }
    const primaryHealth = await runtime.probe(primary.cli);
    if (isRuntimeAvailable(primary, primaryHealth)) {
      selectedRuntime = primary;
    } else {
      for (const fallback of profile.fallbackRuntimes) {
        const health = await runtime.probe(fallback.cli);
        if (isRuntimeAvailable(fallback, health)) {
          const decision = requestRuntimeFallback(candidate, fallback, {
            primaryHealth,
            primaryRuntime: primary,
            reason: `primary CLI ${primary.cli} is ${primaryHealth.status}`,
          });
          return { status: 'awaiting_fallback_approval', decision };
        }
      }
      return {
        status: 'error',
        error: `primary CLI ${primary.cli} is ${primaryHealth.status} and no healthy fallback is available`,
      };
    }
  }

  const prompt = buildStagePrompt(
    stage.stageKind,
    candidate.issueNumber,
    undefined,
    options.feedback,
  );

  try {
    const job = await startCodingJob({
      repo: candidate.repository,
      issueNumber: candidate.issueNumber,
      requestedBy: 'control-plane',
      agentProfileId: candidate.agentProfileId,
      pipelineId: candidate.pipelineId,
      stageId: candidate.stageId,
      stageKind: stage.stageKind,
      decisionId: options.decisionId,
      actualRuntime: selectedRuntime,
      createPr: stage.stageKind === 'implement',
      prompt,
    });
    return { status: 'dispatched', job, actualRuntime: selectedRuntime };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { status: 'dispatch_failed', error };
  }
}

export async function resumeStage(
  input: ResumeStageInput,
): Promise<DispatchCandidateResult> {
  return dispatchCandidate(input.candidate, {
    decisionId: input.decisionId,
    feedback: input.feedback,
  });
}
