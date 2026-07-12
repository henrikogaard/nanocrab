import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentProfile } from '../agent-profiles.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import { insertPipeline } from './pipelines.js';
import { getPipeline } from './store.js';
import { syncPipeline } from './sync.js';
import type {
  GitHubProjectClient,
  ProjectConfiguration,
  ProjectItem,
} from './github-projects.js';

const now = '2026-07-12T10:00:00.000Z';

describe('syncPipeline', () => {
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

  function insertValidPipeline(overrides: { enabled?: boolean } = {}) {
    return insertPipeline({
      pipeline: {
        id: 'pipeline_1',
        name: 'NanoCrab delivery',
        githubOwner: 'henrikogaard',
        githubProjectNumber: 7,
        githubProjectId: 'PVT_1',
        workflowFieldId: 'PVTSSF_1',
        repositoryScopes: ['henrikogaard/nanocrab'],
        enabled: overrides.enabled ?? true,
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

  function mockClient(
    configuration: ProjectConfiguration,
    items: ProjectItem[],
  ): GitHubProjectClient {
    return {
      readProjectConfiguration: vi.fn().mockResolvedValue(configuration),
      listProjectItems: vi.fn().mockResolvedValue(items),
      readProjectItem: vi.fn(),
      updateProjectV2ItemFieldValue: vi.fn(),
    } as unknown as GitHubProjectClient;
  }

  it('throws when the pipeline does not exist', async () => {
    const client = mockClient(
      { projectId: 'PVT_1', title: 'T', fields: [] },
      [],
    );
    await expect(syncPipeline('missing', client)).rejects.toThrow(/missing/);
  });

  it('returns empty results for a disabled pipeline', async () => {
    insertValidPipeline({ enabled: false });
    const client = mockClient(
      { projectId: 'PVT_1', title: 'T', fields: [] },
      [],
    );
    expect(await syncPipeline('pipeline_1', client)).toEqual({
      candidates: [],
      configurationErrors: [],
    });
    expect(client.readProjectConfiguration).not.toHaveBeenCalled();
  });

  it('preserves renamed GitHub option labels and updates the stored stage name', async () => {
    insertValidPipeline();
    const client = mockClient(
      {
        projectId: 'PVT_1',
        title: 'NanoCrab',
        fields: [
          {
            id: 'PVTSSF_1',
            name: 'Workflow',
            dataType: 'SINGLE_SELECT',
            options: [
              { id: 'option_planning', name: 'Planning renamed' },
              { id: 'option_implement', name: 'Implement' },
              { id: 'option_review', name: 'Review' },
            ],
          },
        ],
      },
      [],
    );

    const result = await syncPipeline('pipeline_1', client);

    expect(result.configurationErrors).toEqual([]);
    const updated = getPipeline('pipeline_1');
    expect(updated?.stages[0].githubFieldOptionName).toBe('Planning renamed');
  });

  it('flags deleted mapped options as configuration errors and ignores those stages', async () => {
    insertValidPipeline();
    const client = mockClient(
      {
        projectId: 'PVT_1',
        title: 'NanoCrab',
        fields: [
          {
            id: 'PVTSSF_1',
            name: 'Workflow',
            dataType: 'SINGLE_SELECT',
            options: [
              { id: 'option_planning', name: 'Planning' },
              { id: 'option_review', name: 'Review' },
            ],
          },
        ],
      },
      [],
    );

    const result = await syncPipeline('pipeline_1', client);

    expect(result.configurationErrors).toEqual([
      {
        stageId: 'stage_implement',
        githubFieldOptionId: 'option_implement',
        message: 'mapped GitHub option has been deleted',
      },
    ]);
    expect(result.candidates).toEqual([]);
  });

  it('returns candidates for matching issues and claims only one per GitHub revision', async () => {
    insertValidPipeline();
    const client = mockClient(
      {
        projectId: 'PVT_1',
        title: 'NanoCrab',
        fields: [
          {
            id: 'PVTSSF_1',
            name: 'Workflow',
            dataType: 'SINGLE_SELECT',
            options: [
              { id: 'option_planning', name: 'Planning' },
              { id: 'option_implement', name: 'Implement' },
              { id: 'option_review', name: 'Review' },
            ],
          },
        ],
      },
      [
        {
          projectItemId: 'PVTI_1',
          issueNodeId: 'I_1',
          repository: 'henrikogaard/nanocrab',
          issueNumber: 113,
          title: 'First issue',
          currentSingleSelectOptionId: 'option_planning',
          fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
        },
      ],
    );

    const first = await syncPipeline('pipeline_1', client);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]).toMatchObject({
      pipelineId: 'pipeline_1',
      stageId: 'stage_planning',
      issueNumber: 113,
      observedOptionId: 'option_planning',
      observedFieldUpdatedAt: '2026-07-12T10:00:00.000Z',
    });

    const second = await syncPipeline('pipeline_1', client);
    expect(second.candidates).toEqual([]);
  });

  it('ignores project items outside the pipeline repository scope', async () => {
    insertValidPipeline();
    const client = mockClient(
      {
        projectId: 'PVT_1',
        title: 'NanoCrab',
        fields: [
          {
            id: 'PVTSSF_1',
            name: 'Workflow',
            dataType: 'SINGLE_SELECT',
            options: [
              { id: 'option_planning', name: 'Planning' },
              { id: 'option_implement', name: 'Implement' },
              { id: 'option_review', name: 'Review' },
            ],
          },
        ],
      },
      [
        {
          projectItemId: 'PVTI_1',
          issueNodeId: 'I_1',
          repository: 'henrikogaard/other',
          issueNumber: 113,
          title: 'Other repo issue',
          currentSingleSelectOptionId: 'option_planning',
          fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
        },
      ],
    );

    const result = await syncPipeline('pipeline_1', client);

    expect(result.candidates).toEqual([]);
    expect(result.configurationErrors).toEqual([]);
  });

  it('produces a new dispatch candidate when the GitHub field value changes', async () => {
    insertValidPipeline();
    const configuration = {
      projectId: 'PVT_1',
      title: 'NanoCrab',
      fields: [
        {
          id: 'PVTSSF_1',
          name: 'Workflow',
          dataType: 'SINGLE_SELECT',
          options: [
            { id: 'option_planning', name: 'Planning' },
            { id: 'option_implement', name: 'Implement' },
            { id: 'option_review', name: 'Review' },
          ],
        },
      ],
    };

    const client = {
      readProjectConfiguration: vi.fn().mockResolvedValue(configuration),
      listProjectItems: vi
        .fn()
        .mockResolvedValueOnce([
          {
            projectItemId: 'PVTI_1',
            issueNodeId: 'I_1',
            repository: 'henrikogaard/nanocrab',
            issueNumber: 113,
            title: 'First issue',
            currentSingleSelectOptionId: 'option_planning',
            fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
          },
        ])
        .mockResolvedValueOnce([
          {
            projectItemId: 'PVTI_1',
            issueNodeId: 'I_1',
            repository: 'henrikogaard/nanocrab',
            issueNumber: 113,
            title: 'First issue',
            currentSingleSelectOptionId: 'option_implement',
            fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
          },
        ]),
      readProjectItem: vi.fn(),
      updateProjectV2ItemFieldValue: vi.fn(),
    } as unknown as GitHubProjectClient;

    const first = await syncPipeline('pipeline_1', client);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0].stageId).toBe('stage_planning');

    const second = await syncPipeline('pipeline_1', client);
    expect(second.candidates).toHaveLength(1);
    expect(second.candidates[0].stageId).toBe('stage_implement');
  });

  it('does not treat GitHub permission errors as an empty project', async () => {
    insertValidPipeline();
    const client = {
      readProjectConfiguration: vi
        .fn()
        .mockRejectedValue(new Error('Bad credentials')),
      listProjectItems: vi.fn(),
      readProjectItem: vi.fn(),
      updateProjectV2ItemFieldValue: vi.fn(),
    } as unknown as GitHubProjectClient;

    await expect(syncPipeline('pipeline_1', client)).rejects.toThrow(
      'Bad credentials',
    );
  });

  it('reports a missing workflow field as a configuration error', async () => {
    insertValidPipeline();
    const client = mockClient(
      {
        projectId: 'PVT_1',
        title: 'NanoCrab',
        fields: [
          {
            id: 'PVTSSF_other',
            name: 'Other',
            dataType: 'SINGLE_SELECT',
            options: [],
          },
        ],
      },
      [],
    );

    const result = await syncPipeline('pipeline_1', client);

    expect(result.configurationErrors).toContainEqual({
      message: 'workflow field PVTSSF_1 was not found in the project',
    });
    expect(result.candidates).toEqual([]);
  });
});
