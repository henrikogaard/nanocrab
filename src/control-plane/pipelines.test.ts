import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgentProfile } from '../agent-profiles.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import {
  buildStageDispatchKey,
  resolveStageAssignment,
  validatePipeline,
} from './pipelines.js';
import type {
  DeliveryPipeline,
  PipelineStage,
  PipelineStageKind,
  StageAssignment,
} from './types.js';

const now = '2026-07-12T10:00:00.000Z';
let agentIds = {
  planning: 'agent_atlas',
  implement: 'agent_forge',
  review: 'agent_sentinel',
};

function pipelineWith(
  kinds: PipelineStageKind[],
  overrides: Partial<Record<PipelineStageKind, string>> = {},
): { pipeline: DeliveryPipeline; stages: PipelineStage[] } {
  const pipeline: DeliveryPipeline = {
    id: 'pipeline_1',
    name: 'NanoCrab delivery',
    githubOwner: 'henrikogaard',
    githubProjectNumber: 7,
    githubProjectId: 'PVT_1',
    workflowFieldId: 'PVTSSF_1',
    repositoryScopes: ['henrikogaard/nanocrab'],
    enabled: true,
    syncCursor: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const defaults = {
    ...agentIds,
    ...overrides,
  };
  const stages = kinds.map((stageKind, position) => ({
    id: `stage_${stageKind}`,
    pipelineId: pipeline.id,
    githubFieldOptionId: `option_${stageKind}`,
    githubFieldOptionName: stageKind,
    stageKind,
    agentProfileId: defaults[stageKind],
    requiredEvidence: [],
    position,
  }));
  return { pipeline, stages };
}

describe('delivery pipeline domain', () => {
  beforeEach(() => {
    _initTestDatabase();
    const planning = createAgentProfile({
      handle: 'atlas',
      displayName: 'Atlas',
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const implement = createAgentProfile({
      handle: 'forge',
      displayName: 'Forge',
      stageRoles: ['implement'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const review = createAgentProfile({
      handle: 'sentinel',
      displayName: 'Sentinel',
      stageRoles: ['review'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    agentIds = {
      planning: planning.id,
      implement: implement.id,
      review: review.id,
    };
  });

  afterEach(() => _closeDatabase());

  it('requires one planning, implement, and review stage', () => {
    const candidate = pipelineWith(['planning', 'implement']);
    expect(() => validatePipeline(candidate)).toThrow(
      /exactly one planning, implement, and review/i,
    );
  });

  it('rejects the same profile for implement and review', () => {
    const candidate = pipelineWith(['planning', 'implement', 'review'], {
      review: agentIds.implement,
    });
    expect(() => validatePipeline(candidate)).toThrow(
      /implement and review agents must differ/i,
    );
  });

  it('validates stage order, profile role, enabled state, and repository scope', () => {
    expect(() =>
      validatePipeline(pipelineWith(['implement', 'planning', 'review'])),
    ).toThrow(/fixed order/i);

    const incompatible = pipelineWith(['planning', 'implement', 'review'], {
      planning: agentIds.implement,
    });
    expect(() => validatePipeline(incompatible)).toThrow(/planning role/i);

    const outOfScope = pipelineWith(['planning', 'implement', 'review']);
    outOfScope.pipeline.repositoryScopes = ['henrikogaard/other'];
    expect(() => validatePipeline(outOfScope)).toThrow(/repository scope/i);
  });

  it('uses stable GitHub option ids in the dispatch key', () => {
    expect(
      buildStageDispatchKey({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        stageId: 'stage_plan',
        agentProfileId: 'agent_atlas',
        githubFieldUpdatedAt: '2026-07-12T10:00:00.000Z',
      }),
    ).toBe(
      'pipeline_1:PVTI_1:I_1:stage_plan:agent_atlas:2026-07-12T10:00:00.000Z',
    );
  });

  it('prefers an issue-specific assignment over the stage default', () => {
    const stage = pipelineWith(['planning']).stages[0];
    const assignments: StageAssignment[] = [
      {
        id: 'assignment_1',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: stage.id,
        agentProfileId: 'agent_sentinel',
        createdAt: now,
        updatedAt: now,
      },
    ];

    expect(resolveStageAssignment(stage, 'I_1', assignments)).toBe(
      'agent_sentinel',
    );
    expect(resolveStageAssignment(stage, 'I_2', assignments)).toBe(
      agentIds.planning,
    );
  });
});
