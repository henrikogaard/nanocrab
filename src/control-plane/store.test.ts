import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgentProfile } from '../agent-profiles.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import {
  claimStageDispatch,
  getPipeline,
  insertPipeline,
  saveProjectItemSnapshot,
  setStageAssignment,
} from './store.js';

const now = '2026-07-12T10:00:00.000Z';

describe('control plane store', () => {
  let agentIds: Record<'planning' | 'implement' | 'review', string>;

  beforeEach(() => {
    _initTestDatabase();
    agentIds = {} as Record<'planning' | 'implement' | 'review', string>;
    for (const [id, role] of [
      ['agent_atlas', 'planning'],
      ['agent_forge', 'implement'],
      ['agent_sentinel', 'review'],
    ] as const) {
      const profile = createAgentProfile({
        handle: id,
        displayName: id,
        stageRoles: [role],
        repositoryScopes: ['henrikogaard/nanocrab'],
      });
      agentIds[role] = profile.id;
    }
  });

  afterEach(() => _closeDatabase());

  it('persists pipelines and JSON fields without changing stable GitHub ids', () => {
    const pipeline = {
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
    const created = insertPipeline({
      pipeline,
      stages: [
        ['planning', 'agent_atlas'],
        ['implement', 'agent_forge'],
        ['review', 'agent_sentinel'],
      ].map(([stageKind, agentProfileId], position) => ({
        id: `stage_${stageKind}`,
        pipelineId: 'pipeline_1',
        githubFieldOptionId: `option_${stageKind}`,
        githubFieldOptionName: stageKind,
        stageKind: stageKind as 'planning' | 'implement' | 'review',
        agentProfileId:
          agentIds[stageKind as keyof typeof agentIds] ?? agentProfileId,
        requiredEvidence: position === 1 ? ['tests', 'open_pr'] : [],
        position,
      })),
    });

    expect(created.pipeline.githubProjectId).toBe('PVT_1');
    expect(getPipeline('pipeline_1')).toEqual(created);
  });

  it('prevents duplicate Project bindings and option mappings', () => {
    const pipeline = {
      id: 'pipeline_1',
      name: 'One',
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
    const stages = [
      {
        id: 'stage_plan',
        pipelineId: 'pipeline_1',
        githubFieldOptionId: 'option_same',
        githubFieldOptionName: 'Planning',
        stageKind: 'planning' as const,
        agentProfileId: agentIds.planning,
        requiredEvidence: [] as [],
        position: 0,
      },
      {
        id: 'stage_implement',
        pipelineId: 'pipeline_1',
        githubFieldOptionId: 'option_same',
        githubFieldOptionName: 'Implement',
        stageKind: 'implement' as const,
        agentProfileId: agentIds.implement,
        requiredEvidence: [] as [],
        position: 1,
      },
    ];
    const input = { pipeline, stages };
    expect(() => insertPipeline(input)).toThrow(/unique/i);

    insertPipeline({ ...input, stages: [stages[0]] });
    expect(() =>
      insertPipeline({
        pipeline: { ...pipeline, id: 'pipeline_2' },
        stages: [{ ...stages[0], id: 'stage_2', pipelineId: 'pipeline_2' }],
      }),
    ).toThrow(/unique/i);
  });

  it('persists assignments and Project item snapshots', () => {
    expect(
      setStageAssignment({
        id: 'assignment_1',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: 'stage_plan',
        agentProfileId: 'agent_atlas',
        createdAt: now,
        updatedAt: now,
      }).issueNodeId,
    ).toBe('I_1');
    expect(
      saveProjectItemSnapshot({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 113,
        title: 'Pipeline domain',
        githubFieldOptionId: 'option_planning',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      }).projectItemId,
    ).toBe('PVTI_1');
  });

  it('lets only one transactional dispatch claim win for a key', () => {
    const input = {
      dispatchKey: 'stable-key',
      pipelineId: 'pipeline_1',
      projectItemId: 'PVTI_1',
      issueNodeId: 'I_1',
      stageId: 'stage_plan',
      agentProfileId: 'agent_atlas',
      githubFieldUpdatedAt: now,
      claimedAt: now,
    };

    expect(claimStageDispatch(input)).toBe(true);
    expect(claimStageDispatch(input)).toBe(false);
  });
});
