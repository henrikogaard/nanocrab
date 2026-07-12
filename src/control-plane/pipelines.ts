import { getAgentProfile } from '../agent-profiles.js';
import { insertPipeline } from './store.js';
import type {
  PipelineStage,
  PipelineStageKind,
  PipelineWithStages,
  StageAssignment,
} from './types.js';

const STAGE_ORDER: PipelineStageKind[] = ['planning', 'implement', 'review'];
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

function requireOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty GitHub id`);
  }
}

export function validatePipeline(candidate: PipelineWithStages): void {
  const { pipeline, stages } = candidate;
  requireOpaqueId(pipeline.githubProjectId, 'githubProjectId');
  requireOpaqueId(pipeline.workflowFieldId, 'workflowFieldId');
  if (!OWNER_PATTERN.test(pipeline.githubOwner)) {
    throw new Error('githubOwner must be a valid GitHub owner');
  }
  if (
    !Number.isInteger(pipeline.githubProjectNumber) ||
    pipeline.githubProjectNumber <= 0
  ) {
    throw new Error('githubProjectNumber must be a positive integer');
  }
  if (
    pipeline.repositoryScopes.length === 0 ||
    pipeline.repositoryScopes.some((scope) => !REPOSITORY_PATTERN.test(scope))
  ) {
    throw new Error('pipeline must have valid owner/repository scopes');
  }
  if (
    stages.length !== STAGE_ORDER.length ||
    !STAGE_ORDER.every(
      (kind) => stages.filter((stage) => stage.stageKind === kind).length === 1,
    )
  ) {
    throw new Error(
      'pipeline requires exactly one planning, implement, and review stage',
    );
  }
  if (
    !stages.every(
      (stage, position) =>
        stage.stageKind === STAGE_ORDER[position] &&
        stage.position === position,
    )
  ) {
    throw new Error(
      'pipeline stages must use the fixed order planning, implement, review',
    );
  }

  const implement = stages.find((stage) => stage.stageKind === 'implement')!;
  const review = stages.find((stage) => stage.stageKind === 'review')!;
  if (implement.agentProfileId === review.agentProfileId) {
    throw new Error('implement and review agents must differ');
  }

  for (const stage of stages) {
    requireOpaqueId(stage.githubFieldOptionId, 'githubFieldOptionId');
    if (stage.pipelineId !== pipeline.id) {
      throw new Error('pipeline stage must belong to its pipeline');
    }
    const profile = getAgentProfile(stage.agentProfileId);
    if (!profile)
      throw new Error(`agent profile ${stage.agentProfileId} was not found`);
    if (!profile.enabled)
      throw new Error(`agent profile ${stage.agentProfileId} is disabled`);
    if (!profile.stageRoles.includes(stage.stageKind)) {
      throw new Error(
        `agent profile ${stage.agentProfileId} lacks the ${stage.stageKind} role`,
      );
    }
    if (
      pipeline.repositoryScopes.some(
        (repository) => !profile.repositoryScopes.includes(repository),
      )
    ) {
      throw new Error(
        `agent profile ${stage.agentProfileId} does not include the pipeline repository scope`,
      );
    }
  }
}

export function createPipeline(
  candidate: PipelineWithStages,
): PipelineWithStages {
  validatePipeline(candidate);
  return insertPipeline(candidate);
}

export function resolveStageAssignment(
  stage: PipelineStage,
  issueNodeId: string,
  assignments: StageAssignment[],
): string {
  return (
    assignments.find(
      (assignment) =>
        assignment.pipelineId === stage.pipelineId &&
        assignment.stageId === stage.id &&
        assignment.issueNodeId === issueNodeId,
    )?.agentProfileId ?? stage.agentProfileId
  );
}

export function buildStageDispatchKey(input: {
  pipelineId: string;
  projectItemId: string;
  issueNodeId: string;
  stageId: string;
  agentProfileId: string;
  githubFieldUpdatedAt: string;
}): string {
  return [
    input.pipelineId,
    input.projectItemId,
    input.issueNodeId,
    input.stageId,
    input.agentProfileId,
    input.githubFieldUpdatedAt,
  ].join(':');
}
