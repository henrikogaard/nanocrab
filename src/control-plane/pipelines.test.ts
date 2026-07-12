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

  it('validates opaque ids, timestamps, and evidence shapes', () => {
    const blankPipeline = pipelineWith(['planning', 'implement', 'review']);
    blankPipeline.pipeline.id = ' ';
    expect(() => validatePipeline(blankPipeline)).toThrow(/pipelineId/i);

    const badTimestamp = pipelineWith(['planning', 'implement', 'review']);
    badTimestamp.pipeline.updatedAt = 'not-a-timestamp';
    expect(() => validatePipeline(badTimestamp)).toThrow(/updatedAt/i);

    const badEvidence = pipelineWith(['planning', 'implement', 'review']);
    badEvidence.stages[0].requiredEvidence = ['unknown' as 'plan'];
    expect(() => validatePipeline(badEvidence)).toThrow(/requiredEvidence/i);
  });

  it('prefers an issue-specific assignment over the stage default', () => {
    const candidate = pipelineWith(['planning', 'implement', 'review']);
    const stage = candidate.stages[0];
    const override = createAgentProfile({
      handle: 'architect',
      displayName: 'Architect',
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const assignments: StageAssignment[] = [
      {
        id: 'assignment_1',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: stage.id,
        agentProfileId: override.id,
        createdAt: now,
        updatedAt: now,
      },
    ];

    expect(
      resolveStageAssignment(candidate, stage.id, 'I_1', assignments),
    ).toBe(override.id);
    expect(
      resolveStageAssignment(candidate, stage.id, 'I_2', assignments),
    ).toBe(agentIds.planning);
  });

  it('rejects override profiles that bypass stage policy', () => {
    const candidate = pipelineWith(['planning', 'implement', 'review']);
    const planningStage = candidate.stages[0];
    const incompatible = createAgentProfile({
      handle: 'wrong-role',
      displayName: 'Wrong role',
      stageRoles: ['review'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const disabled = createAgentProfile({
      handle: 'disabled-planner',
      displayName: 'Disabled planner',
      enabled: false,
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const outOfScope = createAgentProfile({
      handle: 'external-planner',
      displayName: 'External planner',
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/other'],
    });
    const assignment = (agentProfileId: string): StageAssignment[] => [
      {
        id: 'assignment_1',
        pipelineId: candidate.pipeline.id,
        issueNodeId: 'I_1',
        stageId: planningStage.id,
        agentProfileId,
        createdAt: now,
        updatedAt: now,
      },
    ];

    expect(() =>
      resolveStageAssignment(
        candidate,
        planningStage.id,
        'I_1',
        assignment('missing'),
      ),
    ).toThrow(/not found/i);
    expect(() =>
      resolveStageAssignment(
        candidate,
        planningStage.id,
        'I_1',
        assignment(disabled.id),
      ),
    ).toThrow(/disabled/i);
    expect(() =>
      resolveStageAssignment(
        candidate,
        planningStage.id,
        'I_1',
        assignment(incompatible.id),
      ),
    ).toThrow(/planning role/i);
    expect(() =>
      resolveStageAssignment(
        candidate,
        planningStage.id,
        'I_1',
        assignment(outOfScope.id),
      ),
    ).toThrow(/repository scope/i);
  });

  it('keeps effective implement and review agents distinct after overrides', () => {
    const shared = createAgentProfile({
      handle: 'builder-reviewer',
      displayName: 'Builder reviewer',
      stageRoles: ['implement', 'review'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    const candidate = pipelineWith(['planning', 'implement', 'review'], {
      implement: shared.id,
    });
    const reviewStage = candidate.stages[2];
    const assignments: StageAssignment[] = [
      {
        id: 'assignment_1',
        pipelineId: candidate.pipeline.id,
        issueNodeId: 'I_1',
        stageId: reviewStage.id,
        agentProfileId: shared.id,
        createdAt: now,
        updatedAt: now,
      },
    ];

    expect(() =>
      resolveStageAssignment(candidate, reviewStage.id, 'I_1', assignments),
    ).toThrow(/implement and review agents must differ/i);
  });
});
