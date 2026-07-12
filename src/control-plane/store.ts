import { getDatabaseConnection } from '../db.js';
import {
  getAgentProfile,
  validateRuntimeSelection,
} from '../agent-profiles.js';
import {
  requireOpaqueId,
  requireTimestamp,
  serializeStageDispatchKey,
} from './types.js';
import type {
  ControlPlaneDecision,
  ControlPlaneDecisionStatus,
  DeliveryPipeline,
  PipelineStage,
  PipelineWithStages,
  ProjectItemSnapshot,
  StageAssignment,
  StageDispatchClaim,
} from './types.js';
import type { AgentRuntimeSelection } from '../types.js';

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

interface DecisionRow {
  id: string;
  kind: ControlPlaneDecision['kind'];
  status: ControlPlaneDecision['status'];
  pipeline_id: string;
  project_item_id: string;
  issue_node_id: string;
  repository: string;
  issue_number: number;
  stage_id: string;
  run_id: string | null;
  proposed_stage_id: string | null;
  proposed_agent_profile_id: string | null;
  proposed_runtime_json: string | null;
  expected_github_option_id: string;
  expected_github_field_updated_at: string;
  actual_github_option_id: string | null;
  actual_github_field_updated_at: string | null;
  summary: string;
  evidence_json: string;
  decided_by: string | null;
  decided_from: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  actual_runtime_json: string | null;
  dispatch_status: string | null;
  dispatch_error: string | null;
  dispatch_job_id: string | null;
  dispatch_decision_id: string | null;
  approval_id: string | null;
  correlation_id: string | null;
}

interface SnapshotRow {
  pipeline_id: string;
  project_item_id: string;
  issue_node_id: string;
  repository: string;
  issue_number: number;
  title: string;
  github_field_option_id: string;
  github_field_updated_at: string;
  synced_at: string;
}

const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

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

/** @internal Use pipelines.insertPipeline for the validated public API. */
export function _insertPipelineUnchecked(
  input: PipelineWithStages,
): PipelineWithStages {
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
    if (typeof record.title !== 'string' || !record.title.trim())
      throw new Error('snapshot title is required');
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
    const derivedKey = serializeStageDispatchKey(record);
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

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseRuntime(value: string | null): AgentRuntimeSelection | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'cli' in (parsed as object) &&
      'provider' in (parsed as object) &&
      'model' in (parsed as object)
    ) {
      return parsed as AgentRuntimeSelection;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function mapDecision(row: DecisionRow): ControlPlaneDecision {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    pipelineId: row.pipeline_id,
    projectItemId: row.project_item_id,
    issueNodeId: row.issue_node_id,
    repository: row.repository,
    issueNumber: row.issue_number,
    stageId: row.stage_id,
    runId: row.run_id,
    proposedStageId: row.proposed_stage_id,
    proposedAgentProfileId: row.proposed_agent_profile_id,
    proposedRuntime: parseRuntime(row.proposed_runtime_json),
    expectedGithubOptionId: row.expected_github_option_id,
    expectedGithubFieldUpdatedAt: row.expected_github_field_updated_at,
    actualGithubOptionId: row.actual_github_option_id,
    actualGithubFieldUpdatedAt: row.actual_github_field_updated_at,
    summary: row.summary,
    evidence: parseJsonObject(row.evidence_json),
    decidedBy: row.decided_by,
    decidedFrom: row.decided_from,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    actualRuntime: parseRuntime(row.actual_runtime_json),
    dispatchStatus: row.dispatch_status,
    dispatchError: row.dispatch_error,
    dispatchJobId: row.dispatch_job_id,
    dispatchDecisionId: row.dispatch_decision_id,
    approvalId: row.approval_id,
    correlationId: row.correlation_id,
  };
}

function validateDecisionRuntime(
  runtime: AgentRuntimeSelection | null | undefined,
  field: string,
): void {
  if (runtime === null || runtime === undefined) return;
  validateRuntimeSelection(runtime);
}

function validateDecisionRecord(record: ControlPlaneDecision): void {
  requireOpaqueId(record.id, 'decisionId');
  requireOpaqueId(record.pipelineId, 'pipelineId');
  requireOpaqueId(record.projectItemId, 'projectItemId');
  requireOpaqueId(record.issueNodeId, 'issueNodeId');
  requireOpaqueId(record.stageId, 'stageId');
  requireOpaqueId(record.expectedGithubOptionId, 'expectedGithubOptionId');
  requireTimestamp(
    record.expectedGithubFieldUpdatedAt,
    'expectedGithubFieldUpdatedAt',
  );
  requireTimestamp(record.createdAt, 'createdAt');
  if (!REPOSITORY_PATTERN.test(record.repository)) {
    throw new Error('decision repository must use owner/repository syntax');
  }
  if (!Number.isInteger(record.issueNumber) || record.issueNumber <= 0) {
    throw new Error('decision issue number must be a positive integer');
  }
  if (!['stage_transition', 'runtime_fallback'].includes(record.kind)) {
    throw new Error('decision kind is not supported');
  }
  if (
    ![
      'pending',
      'approved',
      'rejected',
      'revised',
      'reassigned',
      'stale',
    ].includes(record.status)
  ) {
    throw new Error('decision status is not supported');
  }
  validateDecisionRuntime(record.proposedRuntime, 'proposedRuntime');
  validateDecisionRuntime(record.actualRuntime, 'actualRuntime');
  const database = getDatabaseConnection();
  const pipeline = requirePipeline(record.pipelineId);
  const stage = requireStage(record.pipelineId, record.stageId);
  if (record.proposedStageId) {
    requireStage(record.pipelineId, record.proposedStageId);
  }
  if (record.proposedAgentProfileId) {
    const profile = getAgentProfile(record.proposedAgentProfileId);
    if (!profile) {
      throw new Error(
        `decision agent profile ${record.proposedAgentProfileId} was not found`,
      );
    }
    if (!profile.enabled) {
      throw new Error(
        `decision agent profile ${record.proposedAgentProfileId} is disabled`,
      );
    }
    const repositories = JSON.parse(
      pipeline.repository_scopes_json,
    ) as string[];
    if (repositories.some((repo) => !profile.repositoryScopes.includes(repo))) {
      throw new Error(
        `decision agent profile ${record.proposedAgentProfileId} does not include the pipeline repository scope`,
      );
    }
    const proposedStage = record.proposedStageId
      ? (database
          .prepare(
            'SELECT stage_kind FROM control_plane_stages WHERE id = ? AND pipeline_id = ?',
          )
          .get(record.proposedStageId, record.pipelineId) as
          | { stage_kind: PipelineStage['stageKind'] }
          | undefined)
      : undefined;
    const targetStage = proposedStage || stage;
    if (targetStage && !profile.stageRoles.includes(targetStage.stage_kind)) {
      throw new Error(
        `decision agent profile ${record.proposedAgentProfileId} lacks the ${targetStage.stage_kind} role`,
      );
    }
  }
}

export function insertDecision(
  record: ControlPlaneDecision,
): ControlPlaneDecision {
  const database = getDatabaseConnection();
  const save = database.transaction((decision: ControlPlaneDecision) => {
    validateDecisionRecord(decision);
    database
      .prepare(
        `INSERT INTO control_plane_decisions (
          id, kind, status, pipeline_id, project_item_id, issue_node_id,
          repository, issue_number, stage_id, run_id, proposed_stage_id,
          proposed_agent_profile_id, proposed_runtime_json,
          expected_github_option_id, expected_github_field_updated_at,
          actual_github_option_id, actual_github_field_updated_at,
          summary, evidence_json, decided_by, decided_from, decision_note,
          created_at, decided_at, actual_runtime_json, dispatch_status,
          dispatch_error, dispatch_job_id, dispatch_decision_id, approval_id,
          correlation_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.kind,
        decision.status,
        decision.pipelineId,
        decision.projectItemId,
        decision.issueNodeId,
        decision.repository,
        decision.issueNumber,
        decision.stageId,
        decision.runId,
        decision.proposedStageId,
        decision.proposedAgentProfileId,
        decision.proposedRuntime
          ? JSON.stringify(decision.proposedRuntime)
          : null,
        decision.expectedGithubOptionId,
        decision.expectedGithubFieldUpdatedAt,
        decision.actualGithubOptionId,
        decision.actualGithubFieldUpdatedAt,
        decision.summary,
        JSON.stringify(decision.evidence || {}),
        decision.decidedBy,
        decision.decidedFrom,
        decision.decisionNote,
        decision.createdAt,
        decision.decidedAt,
        decision.actualRuntime ? JSON.stringify(decision.actualRuntime) : null,
        decision.dispatchStatus,
        decision.dispatchError,
        decision.dispatchJobId,
        decision.dispatchDecisionId,
        decision.approvalId,
        decision.correlationId,
      );
    return decision;
  });
  save(record);
  return getDecision(record.id)!;
}

export function getDecision(id: string): ControlPlaneDecision | undefined {
  requireOpaqueId(id, 'decisionId');
  const database = getDatabaseConnection();
  const row = database
    .prepare('SELECT * FROM control_plane_decisions WHERE id = ?')
    .get(id) as DecisionRow | undefined;
  return row ? mapDecision(row) : undefined;
}

export function listDecisionsForIssue(
  pipelineId: string,
  issueNodeId: string,
): ControlPlaneDecision[] {
  requireOpaqueId(pipelineId, 'pipelineId');
  requireOpaqueId(issueNodeId, 'issueNodeId');
  const database = getDatabaseConnection();
  const rows = database
    .prepare(
      `SELECT * FROM control_plane_decisions
       WHERE pipeline_id = ? AND issue_node_id = ?
       ORDER BY created_at DESC`,
    )
    .all(pipelineId, issueNodeId) as DecisionRow[];
  return rows.map(mapDecision);
}

export function updateDecisionStatus(
  id: string,
  status: ControlPlaneDecisionStatus,
  fields: {
    decidedBy?: string | null;
    decidedFrom?: string | null;
    decisionNote?: string | null;
    decidedAt?: string | null;
  } = {},
): number {
  requireOpaqueId(id, 'decisionId');
  const database = getDatabaseConnection();
  const decidedAt = fields.decidedAt || new Date().toISOString();
  const result = database
    .prepare(
      `UPDATE control_plane_decisions
       SET status = ?, decided_by = ?, decided_from = ?, decision_note = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(
      status,
      fields.decidedBy ?? null,
      fields.decidedFrom ?? null,
      fields.decisionNote ?? null,
      decidedAt,
      id,
    );
  return result.changes;
}

export function setDecisionStatus(
  id: string,
  status: ControlPlaneDecisionStatus,
  fields: {
    decidedBy?: string | null;
    decidedFrom?: string | null;
    decisionNote?: string | null;
    decidedAt?: string | null;
  } = {},
): void {
  requireOpaqueId(id, 'decisionId');
  const database = getDatabaseConnection();
  const decidedAt = fields.decidedAt || new Date().toISOString();
  database
    .prepare(
      `UPDATE control_plane_decisions
       SET status = ?, decided_by = ?, decided_from = ?, decision_note = ?, decided_at = ?
       WHERE id = ?`,
    )
    .run(
      status,
      fields.decidedBy ?? null,
      fields.decidedFrom ?? null,
      fields.decisionNote ?? null,
      decidedAt,
      id,
    );
}

export function updateDecisionDispatchResult(
  id: string,
  fields: {
    actualRuntime?: AgentRuntimeSelection | null;
    actualGithubOptionId?: string | null;
    actualGithubFieldUpdatedAt?: string | null;
    dispatchStatus?: string | null;
    dispatchError?: string | null;
    dispatchJobId?: string | null;
    dispatchDecisionId?: string | null;
    runId?: string | null;
  },
): ControlPlaneDecision {
  requireOpaqueId(id, 'decisionId');
  const database = getDatabaseConnection();
  const existing = getDecision(id);
  if (!existing) throw new Error(`decision ${id} was not found`);
  database
    .prepare(
      `UPDATE control_plane_decisions
       SET actual_runtime_json = ?,
           actual_github_option_id = ?,
           actual_github_field_updated_at = ?,
           dispatch_status = ?,
           dispatch_error = ?,
           dispatch_job_id = ?,
           dispatch_decision_id = ?,
           run_id = ?
       WHERE id = ?`,
    )
    .run(
      fields.actualRuntime === undefined
        ? existing.actualRuntime
          ? JSON.stringify(existing.actualRuntime)
          : null
        : fields.actualRuntime
          ? JSON.stringify(fields.actualRuntime)
          : null,
      fields.actualGithubOptionId === undefined
        ? existing.actualGithubOptionId
        : fields.actualGithubOptionId,
      fields.actualGithubFieldUpdatedAt === undefined
        ? existing.actualGithubFieldUpdatedAt
        : fields.actualGithubFieldUpdatedAt,
      fields.dispatchStatus === undefined
        ? existing.dispatchStatus
        : fields.dispatchStatus,
      fields.dispatchError === undefined
        ? existing.dispatchError
        : fields.dispatchError,
      fields.dispatchJobId === undefined
        ? existing.dispatchJobId
        : fields.dispatchJobId,
      fields.dispatchDecisionId === undefined
        ? existing.dispatchDecisionId
        : fields.dispatchDecisionId,
      fields.runId === undefined ? existing.runId : fields.runId,
      id,
    );
  return getDecision(id)!;
}

export function updateDecisionApprovalId(
  id: string,
  approvalId: string,
): ControlPlaneDecision {
  requireOpaqueId(id, 'decisionId');
  requireOpaqueId(approvalId, 'approvalId');
  const database = getDatabaseConnection();
  database
    .prepare('UPDATE control_plane_decisions SET approval_id = ? WHERE id = ?')
    .run(approvalId, id);
  return getDecision(id)!;
}

export function getStageAssignment(
  pipelineId: string,
  issueNodeId: string,
  stageId: string,
): StageAssignment | undefined {
  requireOpaqueId(pipelineId, 'pipelineId');
  requireOpaqueId(issueNodeId, 'issueNodeId');
  requireOpaqueId(stageId, 'stageId');
  const database = getDatabaseConnection();
  const row = database
    .prepare(
      'SELECT * FROM control_plane_stage_assignments WHERE pipeline_id = ? AND issue_node_id = ? AND stage_id = ?',
    )
    .get(pipelineId, issueNodeId, stageId) as AssignmentRow | undefined;
  return row ? mapAssignment(row) : undefined;
}

export function getStageAssignmentsForIssue(
  pipelineId: string,
  issueNodeId: string,
): StageAssignment[] {
  requireOpaqueId(pipelineId, 'pipelineId');
  requireOpaqueId(issueNodeId, 'issueNodeId');
  const database = getDatabaseConnection();
  const rows = database
    .prepare(
      'SELECT * FROM control_plane_stage_assignments WHERE pipeline_id = ? AND issue_node_id = ? ORDER BY created_at ASC',
    )
    .all(pipelineId, issueNodeId) as AssignmentRow[];
  return rows.map(mapAssignment);
}

function mapSnapshot(row: SnapshotRow): ProjectItemSnapshot {
  return {
    pipelineId: row.pipeline_id,
    projectItemId: row.project_item_id,
    issueNodeId: row.issue_node_id,
    repository: row.repository,
    issueNumber: row.issue_number,
    title: row.title,
    githubFieldOptionId: row.github_field_option_id,
    githubFieldUpdatedAt: row.github_field_updated_at,
    syncedAt: row.synced_at,
  };
}

export function listPipelines(): PipelineWithStages[] {
  const database = getDatabaseConnection();
  const rows = database
    .prepare('SELECT * FROM control_plane_pipelines ORDER BY created_at DESC')
    .all() as PipelineRow[];
  return rows.map((row) => {
    const stages = database
      .prepare(
        'SELECT * FROM control_plane_stages WHERE pipeline_id = ? ORDER BY position ASC',
      )
      .all(row.id) as StageRow[];
    return { pipeline: mapPipeline(row), stages: stages.map(mapStage) };
  });
}

export function listDecisions(): ControlPlaneDecision[] {
  const database = getDatabaseConnection();
  const rows = database
    .prepare('SELECT * FROM control_plane_decisions ORDER BY created_at DESC')
    .all() as DecisionRow[];
  return rows.map(mapDecision);
}

export function listProjectItemSnapshots(
  pipelineId?: string,
): ProjectItemSnapshot[] {
  const database = getDatabaseConnection();
  if (pipelineId) {
    requireOpaqueId(pipelineId, 'pipelineId');
    const rows = database
      .prepare(
        'SELECT * FROM control_plane_item_snapshots WHERE pipeline_id = ? ORDER BY synced_at DESC',
      )
      .all(pipelineId) as SnapshotRow[];
    return rows.map(mapSnapshot);
  }
  const rows = database
    .prepare(
      'SELECT * FROM control_plane_item_snapshots ORDER BY synced_at DESC',
    )
    .all() as SnapshotRow[];
  return rows.map(mapSnapshot);
}
