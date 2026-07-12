import { getDatabaseConnection } from '../db.js';
import { buildStageDispatchKey } from './pipelines.js';
import {
  claimStageDispatch,
  getPipeline,
  saveProjectItemSnapshot,
} from './store.js';
import type { PipelineStage } from './types.js';
import type { GitHubProjectClient } from './github-projects.js';

export interface StageDispatchCandidate {
  dispatchKey: string;
  pipelineId: string;
  stageId: string;
  projectItemId: string;
  issueNodeId: string;
  repository: string;
  issueNumber: number;
  agentProfileId: string;
  observedOptionId: string;
  observedFieldUpdatedAt: string;
}

export interface PipelineConfigurationError {
  stageId?: string;
  githubFieldOptionId?: string;
  message: string;
}

export interface SyncPipelineResult {
  candidates: StageDispatchCandidate[];
  configurationErrors: PipelineConfigurationError[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function updateStageOptionName(stageId: string, name: string): void {
  getDatabaseConnection()
    .prepare(
      'UPDATE control_plane_stages SET github_field_option_name = ? WHERE id = ?',
    )
    .run(name, stageId);
}

function updatePipelineLastSyncedAt(pipelineId: string, syncedAt: string): void {
  getDatabaseConnection()
    .prepare(
      'UPDATE control_plane_pipelines SET last_synced_at = ?, updated_at = ? WHERE id = ?',
    )
    .run(syncedAt, syncedAt, pipelineId);
}

export async function syncPipeline(
  pipelineId: string,
  client: GitHubProjectClient,
): Promise<SyncPipelineResult> {
  const candidate = getPipeline(pipelineId);
  if (!candidate) throw new Error(`pipeline ${pipelineId} was not found`);
  if (!candidate.pipeline.enabled) {
    return { candidates: [], configurationErrors: [] };
  }

  const { pipeline, stages } = candidate;
  const configurationErrors: PipelineConfigurationError[] = [];
  const syncedAt = nowIso();

  const configuration = await client.readProjectConfiguration(
    pipeline.githubOwner,
    pipeline.githubProjectNumber,
  );

  const optionById = new Map<string, { name: string; fieldId: string }>();
  for (const field of configuration.fields) {
    if (field.options) {
      for (const option of field.options) {
        optionById.set(option.id, { name: option.name, fieldId: field.id });
      }
    }
  }

  const workflowField = configuration.fields.find(
    (field) => field.id === pipeline.workflowFieldId,
  );
  if (!workflowField) {
    configurationErrors.push({
      message: `workflow field ${pipeline.workflowFieldId} was not found in the project`,
    });
  }

  const deletedStageIds = new Set<string>();
  for (const stage of stages) {
    const option = optionById.get(stage.githubFieldOptionId);
    if (!option) {
      configurationErrors.push({
        stageId: stage.id,
        githubFieldOptionId: stage.githubFieldOptionId,
        message: 'mapped GitHub option has been deleted',
      });
      deletedStageIds.add(stage.id);
      continue;
    }
    if (option.name !== stage.githubFieldOptionName) {
      updateStageOptionName(stage.id, option.name);
    }
  }

  const stageByOptionId = new Map<string, PipelineStage>();
  for (const stage of stages) {
    if (!deletedStageIds.has(stage.id)) {
      stageByOptionId.set(stage.githubFieldOptionId, stage);
    }
  }

  const items = await client.listProjectItems(
    pipeline.githubProjectId,
    pipeline.workflowFieldId,
  );

  const candidates: StageDispatchCandidate[] = [];
  for (const item of items) {
    if (!item.currentSingleSelectOptionId || !item.fieldUpdatedAt) continue;
    if (!pipeline.repositoryScopes.includes(item.repository)) continue;

    const stage = stageByOptionId.get(item.currentSingleSelectOptionId);
    if (!stage) continue;

    saveProjectItemSnapshot({
      pipelineId: pipeline.id,
      projectItemId: item.projectItemId,
      issueNodeId: item.issueNodeId,
      repository: item.repository,
      issueNumber: item.issueNumber,
      title: item.title,
      githubFieldOptionId: item.currentSingleSelectOptionId,
      githubFieldUpdatedAt: item.fieldUpdatedAt,
      syncedAt,
    });

    const dispatchKey = buildStageDispatchKey({
      pipelineId: pipeline.id,
      projectItemId: item.projectItemId,
      issueNodeId: item.issueNodeId,
      stageId: stage.id,
      agentProfileId: stage.agentProfileId,
      githubFieldUpdatedAt: item.fieldUpdatedAt,
    });

    const claimed = claimStageDispatch({
      dispatchKey,
      pipelineId: pipeline.id,
      projectItemId: item.projectItemId,
      issueNodeId: item.issueNodeId,
      stageId: stage.id,
      agentProfileId: stage.agentProfileId,
      githubFieldUpdatedAt: item.fieldUpdatedAt,
      claimedAt: syncedAt,
    });

    if (claimed) {
      candidates.push({
        dispatchKey,
        pipelineId: pipeline.id,
        stageId: stage.id,
        projectItemId: item.projectItemId,
        issueNodeId: item.issueNodeId,
        repository: item.repository,
        issueNumber: item.issueNumber,
        agentProfileId: stage.agentProfileId,
        observedOptionId: item.currentSingleSelectOptionId,
        observedFieldUpdatedAt: item.fieldUpdatedAt,
      });
    }
  }

  updatePipelineLastSyncedAt(pipeline.id, syncedAt);

  return { candidates, configurationErrors };
}
