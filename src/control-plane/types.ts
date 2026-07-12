export type PipelineStageKind = 'planning' | 'implement' | 'review';

export type PipelineEvidence =
  | 'plan'
  | 'tests'
  | 'pushed_branch'
  | 'open_pr'
  | 'review';

export interface DeliveryPipeline {
  id: string;
  name: string;
  githubOwner: string;
  githubProjectNumber: number;
  githubProjectId: string;
  workflowFieldId: string;
  repositoryScopes: string[];
  enabled: boolean;
  syncCursor: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  githubFieldOptionId: string;
  githubFieldOptionName: string;
  stageKind: PipelineStageKind;
  agentProfileId: string;
  requiredEvidence: PipelineEvidence[];
  position: number;
}

export interface StageAssignment {
  id: string;
  pipelineId: string;
  issueNodeId: string;
  stageId: string;
  agentProfileId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectItemSnapshot {
  pipelineId: string;
  projectItemId: string;
  issueNodeId: string;
  repository: string;
  issueNumber: number;
  title: string;
  githubFieldOptionId: string;
  githubFieldUpdatedAt: string;
  syncedAt: string;
}

export interface PipelineWithStages {
  pipeline: DeliveryPipeline;
  stages: PipelineStage[];
}

export interface StageDispatchClaim {
  dispatchKey: string;
  pipelineId: string;
  projectItemId: string;
  issueNodeId: string;
  stageId: string;
  agentProfileId: string;
  githubFieldUpdatedAt: string;
  claimedAt: string;
}

/** @internal Primitive validation shared without coupling store and domain modules. */
export function requireOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty GitHub id`);
  }
}

/** @internal Primitive validation shared without coupling store and domain modules. */
export function requireTimestamp(value: string | null, field: string): void {
  if (value === null) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
}

/** @internal Canonical dispatch identity serialization. */
export function serializeStageDispatchKey(input: {
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
