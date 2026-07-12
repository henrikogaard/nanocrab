import { getDatabaseConnection } from '../db.js';
import { getAgentProfile } from '../agent-profiles.js';
import { buildStageDispatchKey, requireOpaqueId } from './pipelines.js';
import type {
  DeliveryPipeline,
  PipelineStage,
  PipelineWithStages,
  ProjectItemSnapshot,
  StageAssignment,
  StageDispatchClaim,
} from './types.js';

interface PipelineRow {
  id: string;
  name: string;
  github_owner: string;
  github_project_number: number;
  github_project_id: string;
  workflow_field_id: string;
  repository_scopes_json: string;
  enabled: number;
  sync_cursor: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StageRow {
  id: string;
  pipeline_id: string;
  github_field_option_id: string;
  github_field_option_name: string;
  stage_kind: PipelineStage['stageKind'];
  agent_profile_id: string;
  required_evidence_json: string;
  position: number;
}

interface AssignmentRow {
  id: string;
  pipeline_id: string;
  issue_node_id: string;
  stage_id: string;
  agent_profile_id: string;
  created_at: string;
  updated_at: string;
}

const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

function requireTimestamp(value: string, field: string): void {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
}

function requirePipeline(id: string): PipelineRow {
  requireOpaqueId(id, 'pipelineId');
  const row = getDatabaseConnection()
    .prepare('SELECT * FROM control_plane_pipelines WHERE id = ?')
    .get(id) as PipelineRow | undefined;
  if (!row) throw new Error(`pipeline ${id} was not found`);
  return row;
}

function requireStage(pipelineId: string, stageId: string): StageRow {
  requireOpaqueId(stageId, 'stageId');
  const row = getDatabaseConnection()
    .prepare(
      'SELECT * FROM control_plane_stages WHERE id = ? AND pipeline_id = ?',
    )
    .get(stageId, pipelineId) as StageRow | undefined;
  if (!row)
    throw new Error(
      `stage ${stageId} does not belong to pipeline ${pipelineId}`,
    );
  return row;
}

function mapAssignment(row: AssignmentRow): StageAssignment {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    issueNodeId: row.issue_node_id,
    stageId: row.stage_id,
    agentProfileId: row.agent_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireDistinctDeliveryAgents(input: StageAssignment): void {
  const database = getDatabaseConnection();
  const stages = database
    .prepare(
      `SELECT * FROM control_plane_stages
       WHERE pipeline_id = ? AND stage_kind IN ('implement', 'review')`,
    )
    .all(input.pipelineId) as StageRow[];
  if (stages.length !== 2) return;
  const effective = new Map(
    stages.map((stage) => {
      if (stage.id === input.stageId)
        return [stage.stage_kind, input.agentProfileId];
      const override = database
        .prepare(
          `SELECT agent_profile_id FROM control_plane_stage_assignments
           WHERE pipeline_id = ? AND issue_node_id = ? AND stage_id = ?`,
        )
        .get(input.pipelineId, input.issueNodeId, stage.id) as
        | { agent_profile_id: string }
        | undefined;
      return [
        stage.stage_kind,
        override?.agent_profile_id ?? stage.agent_profile_id,
      ];
    }),
  );
  if (effective.get('implement') === effective.get('review')) {
    throw new Error('implement and review agents must differ');
  }
}

function mapPipeline(row: PipelineRow): DeliveryPipeline {
  return {
    id: row.id,
    name: row.name,
    githubOwner: row.github_owner,
    githubProjectNumber: row.github_project_number,
    githubProjectId: row.github_project_id,
    workflowFieldId: row.workflow_field_id,
    repositoryScopes: JSON.parse(row.repository_scopes_json) as string[],
    enabled: row.enabled === 1,
    syncCursor: row.sync_cursor,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStage(row: StageRow): PipelineStage {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    githubFieldOptionId: row.github_field_option_id,
    githubFieldOptionName: row.github_field_option_name,
    stageKind: row.stage_kind,
    agentProfileId: row.agent_profile_id,
    requiredEvidence: JSON.parse(
      row.required_evidence_json,
    ) as PipelineStage['requiredEvidence'],
    position: row.position,
  };
}

export function insertPipeline(input: PipelineWithStages): PipelineWithStages {
  const database = getDatabaseConnection();
  const insert = database.transaction((candidate: PipelineWithStages) => {
    const pipeline = candidate.pipeline;
    requireOpaqueId(pipeline.id, 'pipelineId');
    requireOpaqueId(pipeline.githubProjectId, 'githubProjectId');
    requireOpaqueId(pipeline.workflowFieldId, 'workflowFieldId');
    requireTimestamp(pipeline.createdAt, 'createdAt');
    requireTimestamp(pipeline.updatedAt, 'updatedAt');
    if (pipeline.lastSyncedAt !== null)
      requireTimestamp(pipeline.lastSyncedAt, 'lastSyncedAt');
    for (const stage of candidate.stages) {
      requireOpaqueId(stage.id, 'stageId');
      requireOpaqueId(stage.githubFieldOptionId, 'githubFieldOptionId');
      if (stage.pipelineId !== pipeline.id)
        throw new Error('pipeline stage must belong to its pipeline');
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
      )
        throw new Error('requiredEvidence contains an unsupported value');
    }
    database
      .prepare(
        `INSERT INTO control_plane_pipelines (
          id, name, github_owner, github_project_number, github_project_id,
          workflow_field_id, repository_scopes_json, enabled, sync_cursor,
          last_synced_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pipeline.id,
        pipeline.name,
        pipeline.githubOwner,
        pipeline.githubProjectNumber,
        pipeline.githubProjectId,
        pipeline.workflowFieldId,
        JSON.stringify(pipeline.repositoryScopes),
        pipeline.enabled ? 1 : 0,
        pipeline.syncCursor,
        pipeline.lastSyncedAt,
        pipeline.createdAt,
        pipeline.updatedAt,
      );
    const insertStage = database.prepare(
      `INSERT INTO control_plane_stages (
        id, pipeline_id, github_field_option_id, github_field_option_name,
        stage_kind, agent_profile_id, required_evidence_json, position
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const stage of candidate.stages) {
      insertStage.run(
        stage.id,
        stage.pipelineId,
        stage.githubFieldOptionId,
        stage.githubFieldOptionName,
        stage.stageKind,
        stage.agentProfileId,
        JSON.stringify(stage.requiredEvidence),
        stage.position,
      );
    }
  });
  insert(input);
  return getPipeline(input.pipeline.id)!;
}

export function getPipeline(id: string): PipelineWithStages | undefined {
  const database = getDatabaseConnection();
  const row = database
    .prepare('SELECT * FROM control_plane_pipelines WHERE id = ?')
    .get(id) as PipelineRow | undefined;
  if (!row) return undefined;
  const stages = database
    .prepare(
      'SELECT * FROM control_plane_stages WHERE pipeline_id = ? ORDER BY position ASC',
    )
    .all(id) as StageRow[];
  return { pipeline: mapPipeline(row), stages: stages.map(mapStage) };
}

export function setStageAssignment(input: StageAssignment): StageAssignment {
  const database = getDatabaseConnection();
  const save = database.transaction((record: StageAssignment) => {
    requireOpaqueId(record.id, 'assignmentId');
    requireOpaqueId(record.issueNodeId, 'issueNodeId');
    requireOpaqueId(record.agentProfileId, 'agentProfileId');
    requireTimestamp(record.createdAt, 'createdAt');
    requireTimestamp(record.updatedAt, 'updatedAt');
    const pipeline = requirePipeline(record.pipelineId);
    const stage = requireStage(record.pipelineId, record.stageId);
    const profile = getAgentProfile(record.agentProfileId);
    if (!profile)
      throw new Error(`agent profile ${record.agentProfileId} was not found`);
    if (!profile.enabled || !profile.stageRoles.includes(stage.stage_kind))
      throw new Error(
        'assignment agent profile is not enabled and compatible with the stage role',
      );
    const repositories = JSON.parse(
      pipeline.repository_scopes_json,
    ) as string[];
    if (
      repositories.some(
        (repository) => !profile.repositoryScopes.includes(repository),
      )
    )
      throw new Error(
        'assignment agent profile does not include the pipeline repository scope',
      );
    requireDistinctDeliveryAgents(record);
    database
      .prepare(
        `INSERT INTO control_plane_stage_assignments (
        id, pipeline_id, issue_node_id, stage_id, agent_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pipeline_id, issue_node_id, stage_id) DO UPDATE SET
        agent_profile_id = excluded.agent_profile_id,
        updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.pipelineId,
        record.issueNodeId,
        record.stageId,
        record.agentProfileId,
        record.createdAt,
        record.updatedAt,
      );
    const row = database
      .prepare(
        'SELECT * FROM control_plane_stage_assignments WHERE pipeline_id = ? AND issue_node_id = ? AND stage_id = ?',
      )
      .get(
        record.pipelineId,
        record.issueNodeId,
        record.stageId,
      ) as AssignmentRow;
    return mapAssignment(row);
  });
  return save(input);
}

export function saveProjectItemSnapshot(
  input: ProjectItemSnapshot,
): ProjectItemSnapshot {
  const database = getDatabaseConnection();
  const save = database.transaction((record: ProjectItemSnapshot) => {
    const pipeline = requirePipeline(record.pipelineId);
    requireOpaqueId(record.projectItemId, 'projectItemId');
    requireOpaqueId(record.issueNodeId, 'issueNodeId');
    requireOpaqueId(record.githubFieldOptionId, 'githubFieldOptionId');
    if (!REPOSITORY_PATTERN.test(record.repository))
      throw new Error('repository must use owner/repository syntax');
    const repositoryScopes = JSON.parse(
      pipeline.repository_scopes_json,
    ) as string[];
    if (!repositoryScopes.includes(record.repository))
      throw new Error(
        'snapshot repository is outside the pipeline repository scope',
      );
    if (!Number.isInteger(record.issueNumber) || record.issueNumber <= 0)
      throw new Error('issue number must be a positive integer');
    requireTimestamp(record.githubFieldUpdatedAt, 'githubFieldUpdatedAt');
    requireTimestamp(record.syncedAt, 'syncedAt');
    const option = database
      .prepare(
        'SELECT 1 FROM control_plane_stages WHERE pipeline_id = ? AND github_field_option_id = ?',
      )
      .get(record.pipelineId, record.githubFieldOptionId);
    if (!option)
      throw new Error('GitHub field option does not belong to the pipeline');
    database
      .prepare(
        `INSERT INTO control_plane_item_snapshots (
        pipeline_id, project_item_id, issue_node_id, repository, issue_number,
        title, github_field_option_id, github_field_updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pipeline_id, project_item_id) DO UPDATE SET
        issue_node_id = excluded.issue_node_id,
        repository = excluded.repository,
        issue_number = excluded.issue_number,
        title = excluded.title,
        github_field_option_id = excluded.github_field_option_id,
        github_field_updated_at = excluded.github_field_updated_at,
        synced_at = excluded.synced_at`,
      )
      .run(
        record.pipelineId,
        record.projectItemId,
        record.issueNodeId,
        record.repository,
        record.issueNumber,
        record.title,
        record.githubFieldOptionId,
        record.githubFieldUpdatedAt,
        record.syncedAt,
      );
    return record;
  });
  return save(input);
}

export function claimStageDispatch(input: StageDispatchClaim): boolean {
  const database = getDatabaseConnection();
  const claim = database.transaction((record: StageDispatchClaim) => {
    requirePipeline(record.pipelineId);
    const stage = requireStage(record.pipelineId, record.stageId);
    requireOpaqueId(record.projectItemId, 'projectItemId');
    requireOpaqueId(record.issueNodeId, 'issueNodeId');
    requireOpaqueId(record.agentProfileId, 'agentProfileId');
    requireTimestamp(record.githubFieldUpdatedAt, 'githubFieldUpdatedAt');
    requireTimestamp(record.claimedAt, 'claimedAt');
    const snapshot = database
      .prepare(
        `SELECT * FROM control_plane_item_snapshots WHERE pipeline_id = ? AND project_item_id = ? AND issue_node_id = ? AND github_field_updated_at = ? AND github_field_option_id = ?`,
      )
      .get(
        record.pipelineId,
        record.projectItemId,
        record.issueNodeId,
        record.githubFieldUpdatedAt,
        stage.github_field_option_id,
      );
    if (!snapshot)
      throw new Error(
        'dispatch must match an existing pipeline item snapshot and stage option',
      );
    const assignment = database
      .prepare(
        'SELECT agent_profile_id FROM control_plane_stage_assignments WHERE pipeline_id = ? AND issue_node_id = ? AND stage_id = ?',
      )
      .get(record.pipelineId, record.issueNodeId, record.stageId) as
      | { agent_profile_id: string }
      | undefined;
    const effectiveAgent =
      assignment?.agent_profile_id ?? stage.agent_profile_id;
    if (record.agentProfileId !== effectiveAgent)
      throw new Error(
        'dispatch agent must match the effective stage assignment',
      );
    const derivedKey = buildStageDispatchKey(record);
    if (record.dispatchKey !== derivedKey)
      throw new Error('dispatch key does not match the persisted claim fields');
    return (
      database
        .prepare(
          `INSERT OR IGNORE INTO control_plane_dispatches (
          dispatch_key, pipeline_id, project_item_id, issue_node_id, stage_id,
          agent_profile_id, github_field_updated_at, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.dispatchKey,
          record.pipelineId,
          record.projectItemId,
          record.issueNodeId,
          record.stageId,
          record.agentProfileId,
          record.githubFieldUpdatedAt,
          record.claimedAt,
        ).changes === 1
    );
  });
  return claim(input);
}
