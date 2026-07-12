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
import { buildStageDispatchKey } from './pipelines.js';

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

  function insertValidPipeline() {
    return insertPipeline({
      pipeline: {
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
      },
      stages: (['planning', 'implement', 'review'] as const).map(
        (stageKind, position) => ({
          id: `stage_${stageKind}`,
          pipelineId: 'pipeline_1',
          githubFieldOptionId: `option_${stageKind}`,
          githubFieldOptionName: stageKind,
          stageKind,
          agentProfileId: agentIds[stageKind],
          requiredEvidence: [],
          position,
        }),
      ),
    });
  }

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
    insertValidPipeline();
    expect(
      setStageAssignment({
        id: 'assignment_1',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: 'stage_planning',
        agentProfileId: agentIds.planning,
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
    insertValidPipeline();
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
    });
    const input = {
      dispatchKey: buildStageDispatchKey({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        stageId: 'stage_planning',
        agentProfileId: agentIds.planning,
        githubFieldUpdatedAt: now,
      }),
      pipelineId: 'pipeline_1',
      projectItemId: 'PVTI_1',
      issueNodeId: 'I_1',
      stageId: 'stage_planning',
      agentProfileId: agentIds.planning,
      githubFieldUpdatedAt: now,
      claimedAt: now,
    };

    expect(claimStageDispatch(input)).toBe(true);
    expect(claimStageDispatch(input)).toBe(false);
  });

  it('rejects a caller dispatch key that does not match persisted claim fields', () => {
    insertValidPipeline();
    saveProjectItemSnapshot({
      pipelineId: 'pipeline_1',
      projectItemId: 'PVTI_1',
      issueNodeId: 'I_1',
      repository: 'henrikogaard/nanocrab',
      issueNumber: 113,
      title: 'Pipeline',
      githubFieldOptionId: 'option_planning',
      githubFieldUpdatedAt: now,
      syncedAt: now,
    });
    expect(() =>
      claimStageDispatch({
        dispatchKey: 'mismatched',
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        stageId: 'stage_planning',
        agentProfileId: agentIds.planning,
        githubFieldUpdatedAt: now,
        claimedAt: now,
      }),
    ).toThrow(/dispatch key/i);
  });

  it('rejects orphan and cross-pipeline records at the store boundary', () => {
    expect(() =>
      insertPipeline({
        pipeline: {
          id: 'pipeline_x',
          name: 'x',
          githubOwner: 'henrikogaard',
          githubProjectNumber: 8,
          githubProjectId: 'PVT_X',
          workflowFieldId: 'FIELD_X',
          repositoryScopes: ['henrikogaard/nanocrab'],
          enabled: true,
          syncCursor: null,
          lastSyncedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        stages: [
          {
            id: 'stage_x',
            pipelineId: 'missing',
            githubFieldOptionId: 'option_x',
            githubFieldOptionName: 'Planning',
            stageKind: 'planning',
            agentProfileId: agentIds.planning,
            requiredEvidence: [],
            position: 0,
          },
        ],
      }),
    ).toThrow(/belong/i);
    insertValidPipeline();
    expect(() =>
      setStageAssignment({
        id: 'assignment_x',
        pipelineId: 'missing',
        issueNodeId: 'I_1',
        stageId: 'stage_planning',
        agentProfileId: agentIds.planning,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/pipeline/i);
    expect(() =>
      setStageAssignment({
        id: 'assignment_x',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: 'missing',
        agentProfileId: agentIds.planning,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/stage/i);
    expect(() =>
      saveProjectItemSnapshot({
        pipelineId: 'missing',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 113,
        title: 'x',
        githubFieldOptionId: 'option_planning',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      }),
    ).toThrow(/pipeline/i);
    expect(() =>
      saveProjectItemSnapshot({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 113,
        title: 'x',
        githubFieldOptionId: 'wrong',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      }),
    ).toThrow(/option/i);
  });

  it('returns the persisted assignment row after an upsert', () => {
    insertValidPipeline();
    setStageAssignment({
      id: 'assignment_original',
      pipelineId: 'pipeline_1',
      issueNodeId: 'I_1',
      stageId: 'stage_planning',
      agentProfileId: agentIds.planning,
      createdAt: now,
      updatedAt: now,
    });
    const persisted = setStageAssignment({
      id: 'assignment_ignored',
      pipelineId: 'pipeline_1',
      issueNodeId: 'I_1',
      stageId: 'stage_planning',
      agentProfileId: agentIds.planning,
      createdAt: '2026-07-12T10:30:00.000Z',
      updatedAt: '2026-07-12T11:00:00.000Z',
    });
    expect(persisted.id).toBe('assignment_original');
    expect(persisted.createdAt).toBe(now);
  });

  it('rejects assignments that collapse effective implement and review agents', () => {
    const shared = createAgentProfile({
      handle: 'shared-builder-reviewer',
      displayName: 'Shared builder reviewer',
      stageRoles: ['implement', 'review'],
      repositoryScopes: ['henrikogaard/nanocrab'],
    });
    insertValidPipeline();
    setStageAssignment({
      id: 'assignment_implement',
      pipelineId: 'pipeline_1',
      issueNodeId: 'I_1',
      stageId: 'stage_implement',
      agentProfileId: shared.id,
      createdAt: now,
      updatedAt: now,
    });
    expect(() =>
      setStageAssignment({
        id: 'assignment_review',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: 'stage_review',
        agentProfileId: shared.id,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/implement and review agents must differ/i);
  });

  it('validates required public store fields', () => {
    insertValidPipeline();
    expect(() =>
      setStageAssignment({
        id: '',
        pipelineId: 'pipeline_1',
        issueNodeId: 'I_1',
        stageId: 'stage_planning',
        agentProfileId: agentIds.planning,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/id/i);
    expect(() =>
      saveProjectItemSnapshot({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'bad repo',
        issueNumber: 0,
        title: 'x',
        githubFieldOptionId: 'option_planning',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      }),
    ).toThrow(/repository|issue number/i);
    expect(() =>
      saveProjectItemSnapshot({
        pipelineId: 'pipeline_1',
        projectItemId: 'PVTI_2',
        issueNodeId: 'I_2',
        repository: 'henrikogaard/other',
        issueNumber: 1,
        title: 'x',
        githubFieldOptionId: 'option_planning',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      }),
    ).toThrow(/repository scope/i);
    expect(() =>
      insertPipeline({
        pipeline: {
          id: 'pipeline_2',
          name: 'x',
          githubOwner: 'henrikogaard',
          githubProjectNumber: 8,
          githubProjectId: 'PVT_2',
          workflowFieldId: 'FIELD_2',
          repositoryScopes: ['henrikogaard/nanocrab'],
          enabled: true,
          syncCursor: null,
          lastSyncedAt: null,
          createdAt: 'bad',
          updatedAt: now,
        },
        stages: [],
      }),
    ).toThrow(/createdAt/i);
  });
});
