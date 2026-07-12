import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DefaultGitHubProjectClient,
  StageConflictError,
  updateProjectItemStage,
  type GitHubProjectClient,
  type GitHubGraphqlTransport,
} from './github-projects.js';

const mockGraphql = vi.fn() as unknown as GitHubGraphqlTransport;

afterEach(() => {
  vi.resetAllMocks();
});

function projectConfigurationFixture(
  fields: {
    id: string;
    name: string;
    options?: { id: string; name: string }[];
  }[],
  overrides: { hasNextPage?: boolean; endCursor?: string | null } = {},
) {
  return {
    organization: {
      projectV2: {
        id: 'PVT_1',
        title: 'NanoCrab delivery',
        fields: {
          pageInfo: {
            hasNextPage: overrides.hasNextPage ?? false,
            endCursor: overrides.endCursor ?? null,
          },
          nodes: fields.map((field) => ({
            __typename: 'ProjectV2SingleSelectField',
            id: field.id,
            name: field.name,
            dataType: 'SINGLE_SELECT',
            options: field.options ?? [],
          })),
        },
      },
    },
  };
}

describe('DefaultGitHubProjectClient', () => {
  it('paginates fields and returns all options', async () => {
    const client = new DefaultGitHubProjectClient(mockGraphql);
    vi.mocked(mockGraphql)
      .mockResolvedValueOnce(
        projectConfigurationFixture(
          [
            {
              id: 'PVTSSF_1',
              name: 'Status',
              options: [{ id: 'opt_plan', name: 'Planning' }],
            },
          ],
          { hasNextPage: true, endCursor: 'cursor1' },
        ),
      )
      .mockResolvedValueOnce({
        node: {
          __typename: 'ProjectV2',
          fields: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                __typename: 'ProjectV2SingleSelectField',
                id: 'PVTSSF_1',
                name: 'Status',
                dataType: 'SINGLE_SELECT',
                options: [{ id: 'opt_impl', name: 'Implement' }],
              },
            ],
          },
        },
      });

    const config = await client.readProjectConfiguration('henrikogaard', 7);

    expect(mockGraphql).toHaveBeenCalledTimes(2);
    expect(config.projectId).toBe('PVT_1');
    expect(config.fields).toHaveLength(1);
    expect(config.fields[0].options).toEqual([
      { id: 'opt_plan', name: 'Planning' },
      { id: 'opt_impl', name: 'Implement' },
    ]);
  });

  it('paginates issue items and ignores draft issues and pull requests', async () => {
    const client = new DefaultGitHubProjectClient(mockGraphql);
    vi.mocked(mockGraphql)
      .mockResolvedValueOnce({
        node: {
          __typename: 'ProjectV2',
          items: {
            pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
            nodes: [
              {
                id: 'PVTI_1',
                content: {
                  __typename: 'Issue',
                  id: 'I_1',
                  number: 113,
                  title: 'First issue',
                  repository: { nameWithOwner: 'henrikogaard/nanocrab' },
                },
                fieldValues: {
                  nodes: [
                    {
                      __typename: 'ProjectV2ItemFieldSingleSelectValue',
                      field: {
                        __typename: 'ProjectV2SingleSelectField',
                        id: 'PVTSSF_1',
                      },
                      optionId: 'opt_plan',
                      updatedAt: '2026-07-12T10:00:00.000Z',
                    },
                  ],
                },
              },
              {
                id: 'PVTI_2',
                content: { __typename: 'PullRequest' },
                fieldValues: { nodes: [] },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        node: {
          __typename: 'ProjectV2',
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PVTI_3',
                content: {
                  __typename: 'Issue',
                  id: 'I_3',
                  number: 114,
                  title: 'Second issue',
                  repository: { nameWithOwner: 'henrikogaard/nanocrab' },
                },
                fieldValues: {
                  nodes: [
                    {
                      __typename: 'ProjectV2ItemFieldSingleSelectValue',
                      field: {
                        __typename: 'ProjectV2SingleSelectField',
                        id: 'PVTSSF_1',
                      },
                      optionId: 'opt_impl',
                      updatedAt: '2026-07-12T10:00:00.000Z',
                    },
                  ],
                },
              },
              {
                id: 'PVTI_4',
                content: { __typename: 'DraftIssue' },
                fieldValues: { nodes: [] },
              },
            ],
          },
        },
      });

    const items = await client.listProjectItems('PVT_1', 'PVTSSF_1');

    expect(mockGraphql).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.issueNumber)).toEqual([113, 114]);
    expect(
      items.every((item) => item.currentSingleSelectOptionId !== null),
    ).toBe(true);
  });

  it('does not treat permission and rate-limit failures as empty Projects', async () => {
    const client = new DefaultGitHubProjectClient(mockGraphql);
    vi.mocked(mockGraphql).mockRejectedValueOnce(
      new Error('GitHub GraphQL 403: Forbidden'),
    );

    await expect(
      client.readProjectConfiguration('henrikogaard', 7),
    ).rejects.toThrow(/GitHub GraphQL 403/);

    vi.mocked(mockGraphql).mockRejectedValueOnce(
      new Error('GitHub GraphQL 429: Rate limit exceeded'),
    );

    await expect(client.listProjectItems('PVT_1', 'PVTSSF_1')).rejects.toThrow(
      /GitHub GraphQL 429/,
    );
  });
});

describe('updateProjectItemStage', () => {
  function mockClient(): GitHubProjectClient {
    return {
      readProjectConfiguration: vi.fn(),
      listProjectItems: vi.fn(),
      readProjectItem: vi.fn(),
      updateProjectV2ItemFieldValue: vi.fn(),
    } as unknown as GitHubProjectClient;
  }

  const validMutation = {
    projectId: 'PVT_1',
    itemId: 'PVTI_1',
    fieldId: 'PVTSSF_1',
    optionId: 'implement',
    expectedOptionId: 'planning',
    expectedFieldUpdatedAt: '2026-07-12T10:00:00.000Z',
  };

  it('refuses to overwrite a newer GitHub stage', async () => {
    const client = mockClient();
    vi.mocked(client.readProjectItem).mockResolvedValue({
      optionId: 'review',
      fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
    });

    await expect(
      updateProjectItemStage(client, validMutation),
    ).rejects.toBeInstanceOf(StageConflictError);
    expect(client.updateProjectV2ItemFieldValue).not.toHaveBeenCalled();
  });

  it('verifies a field mutation by reading it back', async () => {
    const client = mockClient();
    vi.mocked(client.readProjectItem)
      .mockResolvedValueOnce({
        optionId: 'planning',
        fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
      })
      .mockResolvedValueOnce({
        optionId: 'implement',
        fieldUpdatedAt: '2026-07-12T10:00:01.000Z',
      });

    const result = await updateProjectItemStage(client, validMutation);

    expect(result).toMatchObject({ workflowOptionId: 'implement' });
    expect(client.updateProjectV2ItemFieldValue).toHaveBeenCalledWith(
      'PVT_1',
      'PVTI_1',
      'PVTSSF_1',
      'implement',
    );
  });

  it('throws StageConflictError when the read-back does not match the requested option', async () => {
    const client = mockClient();
    vi.mocked(client.readProjectItem)
      .mockResolvedValueOnce({
        optionId: 'planning',
        fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
      })
      .mockResolvedValueOnce({
        optionId: 'planning',
        fieldUpdatedAt: '2026-07-12T10:00:00.000Z',
      });

    await expect(
      updateProjectItemStage(client, validMutation),
    ).rejects.toBeInstanceOf(StageConflictError);
  });
});
