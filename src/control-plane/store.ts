import { getDatabaseConnection } from '../db.js';
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
  getDatabaseConnection()
    .prepare(
      `INSERT INTO control_plane_stage_assignments (
        id, pipeline_id, issue_node_id, stage_id, agent_profile_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pipeline_id, issue_node_id, stage_id) DO UPDATE SET
        agent_profile_id = excluded.agent_profile_id,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.pipelineId,
      input.issueNodeId,
      input.stageId,
      input.agentProfileId,
      input.createdAt,
      input.updatedAt,
    );
  return input;
}

export function saveProjectItemSnapshot(
  input: ProjectItemSnapshot,
): ProjectItemSnapshot {
  getDatabaseConnection()
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
      input.pipelineId,
      input.projectItemId,
      input.issueNodeId,
      input.repository,
      input.issueNumber,
      input.title,
      input.githubFieldOptionId,
      input.githubFieldUpdatedAt,
      input.syncedAt,
    );
  return input;
}

export function claimStageDispatch(input: StageDispatchClaim): boolean {
  const database = getDatabaseConnection();
  const claim = database.transaction(
    (record: StageDispatchClaim) =>
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
        ).changes === 1,
  );
  return claim(input);
}
