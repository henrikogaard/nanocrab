import { getDatabaseConnection } from '../db.js';
import { getAgentProfile } from '../agent-profiles.js';
import { _insertPipelineUnchecked, getPipeline } from './store.js';
import {
  requireOpaqueId,
  requireTimestamp,
  serializeStageDispatchKey,
} from './types.js';
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

function validateProfileForStage(
  agentProfileId: string,
  stage: PipelineStage,
  repositories: string[],
): void {
  requireOpaqueId(agentProfileId, 'agentProfileId');
  const profile = getAgentProfile(agentProfileId);
  if (!profile)
    throw new Error(`agent profile ${agentProfileId} was not found`);
  if (!profile.enabled)
    throw new Error(`agent profile ${agentProfileId} is disabled`);
  if (!profile.stageRoles.includes(stage.stageKind)) {
    throw new Error(
      `agent profile ${agentProfileId} lacks the ${stage.stageKind} role`,
    );
  }
  if (
    repositories.some(
      (repository) => !profile.repositoryScopes.includes(repository),
    )
  ) {
    throw new Error(
      `agent profile ${agentProfileId} does not include the pipeline repository scope`,
    );
  }
}

export function validatePipeline(candidate: PipelineWithStages): void {
  const { pipeline, stages } = candidate;
  requireOpaqueId(pipeline.id, 'pipelineId');
  requireOpaqueId(pipeline.githubProjectId, 'githubProjectId');
  requireOpaqueId(pipeline.workflowFieldId, 'workflowFieldId');
  if (typeof pipeline.name !== 'string' || pipeline.name.trim().length === 0) {
    throw new Error('pipeline name is required');
  }
  requireTimestamp(pipeline.createdAt, 'createdAt');
  requireTimestamp(pipeline.updatedAt, 'updatedAt');
  requireTimestamp(pipeline.lastSyncedAt, 'lastSyncedAt');
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
    requireOpaqueId(stage.id, 'stageId');
    requireOpaqueId(stage.githubFieldOptionId, 'githubFieldOptionId');
    if (
      typeof stage.githubFieldOptionName !== 'string' ||
      !stage.githubFieldOptionName.trim()
    ) {
      throw new Error('githubFieldOptionName is required');
    }
    if (stage.pipelineId !== pipeline.id) {
      throw new Error('pipeline stage must belong to its pipeline');
    }
    const allowedEvidence = [
      'plan',
      'tests',
      'pushed_branch',
      'open_pr',
      'review',
    ];
    if (
      !Array.isArray(stage.requiredEvidence) ||
      stage.requiredEvidence.some((item) => !allowedEvidence.includes(item))
    ) {
      throw new Error('requiredEvidence contains an unsupported value');
    }
    validateProfileForStage(
      stage.agentProfileId,
      stage,
      pipeline.repositoryScopes,
    );
  }
}

export function createPipeline(
  candidate: PipelineWithStages,
): PipelineWithStages {
  return insertPipeline(candidate);
}

export function insertPipeline(
  candidate: PipelineWithStages,
): PipelineWithStages {
  validatePipeline(candidate);
  return _insertPipelineUnchecked(candidate);
}

export function resolveStageAssignment(
  candidate: PipelineWithStages,
  stageId: string,
  issueNodeId: string,
  assignments: StageAssignment[],
): string {
  validatePipeline(candidate);
  requireOpaqueId(stageId, 'stageId');
  requireOpaqueId(issueNodeId, 'issueNodeId');
  const effective = new Map(
    candidate.stages.map((stage) => {
      const override = assignments.find(
        (assignment) =>
          assignment.pipelineId === stage.pipelineId &&
          assignment.stageId === stage.id &&
          assignment.issueNodeId === issueNodeId,
      );
      const agentProfileId = override?.agentProfileId ?? stage.agentProfileId;
      validateProfileForStage(
        agentProfileId,
        stage,
        candidate.pipeline.repositoryScopes,
      );
      return [stage.id, agentProfileId] as const;
    }),
  );
  const implement = candidate.stages.find(
    (stage) => stage.stageKind === 'implement',
  )!;
  const review = candidate.stages.find(
    (stage) => stage.stageKind === 'review',
  )!;
  if (effective.get(implement.id) === effective.get(review.id)) {
    throw new Error('implement and review agents must differ');
  }
  const resolved = effective.get(stageId);
  if (!resolved) throw new Error(`stage ${stageId} was not found in pipeline`);
  return resolved;
}

export function buildStageDispatchKey(input: {
  pipelineId: string;
  projectItemId: string;
  issueNodeId: string;
  stageId: string;
  agentProfileId: string;
  githubFieldUpdatedAt: string;
}): string {
  requireOpaqueId(input.pipelineId, 'pipelineId');
  requireOpaqueId(input.projectItemId, 'projectItemId');
  requireOpaqueId(input.issueNodeId, 'issueNodeId');
  requireOpaqueId(input.stageId, 'stageId');
  requireOpaqueId(input.agentProfileId, 'agentProfileId');
  requireTimestamp(input.githubFieldUpdatedAt, 'githubFieldUpdatedAt');
  return serializeStageDispatchKey(input);
}

export function updatePipeline(
  id: string,
  patch: Partial<PipelineWithStages> & { stages?: Partial<PipelineStage>[] },
): PipelineWithStages {
  const existing = getPipeline(id);
  if (!existing) throw new Error(`pipeline ${id} was not found`);

  const pipeline = {
    ...existing.pipeline,
    ...patch.pipeline,
    id: existing.pipeline.id,
    createdAt: existing.pipeline.createdAt,
    syncCursor: existing.pipeline.syncCursor,
    lastSyncedAt: existing.pipeline.lastSyncedAt,
    updatedAt: new Date().toISOString(),
  };
  const stages = (patch.stages || existing.stages).map((stage) => {
    const existingStage = stage.id
      ? existing.stages.find((s) => s.id === stage.id)
      : existing.stages.find((s) => s.position === stage.position);
    if (!existingStage) {
      throw new Error(
        `stage ${stage.id || stage.position} was not found for update`,
      );
    }
    return {
      ...existingStage,
      ...stage,
      pipelineId: existing.pipeline.id,
      id: existingStage.id,
    } as PipelineStage;
  });
  const candidate: PipelineWithStages = { pipeline, stages };
  validatePipeline(candidate);

  const database = getDatabaseConnection();
  const update = database.transaction((input: PipelineWithStages) => {
    database
      .prepare(
        `UPDATE control_plane_pipelines
         SET name = ?, github_owner = ?, github_project_number = ?, github_project_id = ?,
             workflow_field_id = ?, repository_scopes_json = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.pipeline.name,
        input.pipeline.githubOwner,
        input.pipeline.githubProjectNumber,
        input.pipeline.githubProjectId,
        input.pipeline.workflowFieldId,
        JSON.stringify(input.pipeline.repositoryScopes),
        input.pipeline.enabled ? 1 : 0,
        input.pipeline.updatedAt,
        input.pipeline.id,
      );
    const updateStage = database.prepare(
      `UPDATE control_plane_stages
       SET github_field_option_id = ?, github_field_option_name = ?, stage_kind = ?,
           agent_profile_id = ?, required_evidence_json = ?, position = ?
       WHERE id = ?`,
    );
    for (const stage of input.stages) {
      updateStage.run(
        stage.githubFieldOptionId,
        stage.githubFieldOptionName,
        stage.stageKind,
        stage.agentProfileId,
        JSON.stringify(stage.requiredEvidence),
        stage.position,
        stage.id,
      );
    }
  });
  update(candidate);
  return getPipeline(id)!;
}
