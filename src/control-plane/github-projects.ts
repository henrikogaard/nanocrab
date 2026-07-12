import { githubGraphql } from '../coding-jobs.js';

/** Low-level typed GraphQL transport. */
export interface GitHubGraphqlTransport {
  <T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: string;
  options?: ProjectFieldOption[];
}

export interface ProjectConfiguration {
  projectId: string;
  title: string;
  fields: ProjectField[];
}

export interface ProjectItem {
  projectItemId: string;
  issueNodeId: string;
  repository: string;
  issueNumber: number;
  title: string;
  currentSingleSelectOptionId: string | null;
  fieldUpdatedAt: string | null;
}

export interface ProjectItemFieldValue {
  optionId: string | null;
  fieldUpdatedAt: string;
}

export interface GitHubProjectClient {
  readProjectConfiguration(
    owner: string,
    projectNumber: number,
  ): Promise<ProjectConfiguration>;
  listProjectItems(projectId: string, fieldId: string): Promise<ProjectItem[]>;
  readProjectItem(
    projectId: string,
    itemId: string,
    fieldId: string,
  ): Promise<ProjectItemFieldValue | null>;
  updateProjectV2ItemFieldValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void>;
}

export class StageConflictError extends Error {
  projectItemId: string;
  fieldId: string;
  expectedOptionId: string | null;
  actualOptionId: string | null;
  expectedFieldUpdatedAt: string | null;
  actualFieldUpdatedAt: string | null;

  constructor(
    message: string,
    details: {
      projectItemId: string;
      fieldId: string;
      expectedOptionId: string | null;
      actualOptionId: string | null;
      expectedFieldUpdatedAt: string | null;
      actualFieldUpdatedAt: string | null;
    },
  ) {
    super(message);
    this.name = 'StageConflictError';
    this.projectItemId = details.projectItemId;
    this.fieldId = details.fieldId;
    this.expectedOptionId = details.expectedOptionId;
    this.actualOptionId = details.actualOptionId;
    this.expectedFieldUpdatedAt = details.expectedFieldUpdatedAt;
    this.actualFieldUpdatedAt = details.actualFieldUpdatedAt;
  }
}

export interface UpdateProjectItemStageInput {
  projectId: string;
  itemId: string;
  fieldId: string;
  optionId: string;
  expectedOptionId: string | null;
  expectedFieldUpdatedAt: string | null;
}

export interface StageMutationResult {
  workflowOptionId: string;
  fieldUpdatedAt: string;
}

export async function updateProjectItemStage(
  client: GitHubProjectClient,
  input: UpdateProjectItemStageInput,
): Promise<StageMutationResult> {
  const current = await client.readProjectItem(
    input.projectId,
    input.itemId,
    input.fieldId,
  );

  if (
    current?.optionId !== input.expectedOptionId ||
    current?.fieldUpdatedAt !== input.expectedFieldUpdatedAt
  ) {
    throw new StageConflictError(
      'GitHub project item has changed since the proposal was created',
      {
        projectItemId: input.itemId,
        fieldId: input.fieldId,
        expectedOptionId: input.expectedOptionId,
        actualOptionId: current?.optionId ?? null,
        expectedFieldUpdatedAt: input.expectedFieldUpdatedAt,
        actualFieldUpdatedAt: current?.fieldUpdatedAt ?? null,
      },
    );
  }

  await client.updateProjectV2ItemFieldValue(
    input.projectId,
    input.itemId,
    input.fieldId,
    input.optionId,
  );

  const updated = await client.readProjectItem(
    input.projectId,
    input.itemId,
    input.fieldId,
  );

  if (updated?.optionId !== input.optionId) {
    throw new StageConflictError(
      'GitHub project item field mutation did not take effect',
      {
        projectItemId: input.itemId,
        fieldId: input.fieldId,
        expectedOptionId: input.optionId,
        actualOptionId: updated?.optionId ?? null,
        expectedFieldUpdatedAt: input.expectedFieldUpdatedAt,
        actualFieldUpdatedAt: updated?.fieldUpdatedAt ?? null,
      },
    );
  }

  return {
    workflowOptionId: input.optionId,
    fieldUpdatedAt: updated.fieldUpdatedAt,
  };
}

interface ReadProjectInitialResponse {
  organization?: {
    projectV2?: {
      id: string;
      title: string;
      fields: FieldConnection;
    } | null;
  } | null;
  user?: {
    projectV2?: {
      id: string;
      title: string;
      fields: FieldConnection;
    } | null;
  } | null;
}

interface ReadProjectPageResponse {
  node?: {
    __typename?: string;
    id: string;
    fields: FieldConnection;
  } | null;
}

interface FieldConnection {
  pageInfo?: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
  nodes?: FieldNode[];
}

type FieldNode =
  | {
      __typename: 'ProjectV2Field';
      id: string;
      name: string;
      dataType: string;
      options?: undefined;
    }
  | {
      __typename: 'ProjectV2SingleSelectField';
      id: string;
      name: string;
      dataType: string;
      options: ProjectFieldOption[];
    }
  | {
      __typename: 'ProjectV2IterationField';
      id: string;
      name: string;
      dataType: string;
      options?: undefined;
    };

interface IssueContent {
  __typename: 'Issue';
  id: string;
  number: number;
  title: string;
  repository?: {
    nameWithOwner: string;
  } | null;
}

interface FieldValueNode {
  __typename: 'ProjectV2ItemFieldSingleSelectValue';
  field: {
    __typename: 'ProjectV2SingleSelectField';
    id: string;
  } | null;
  optionId: string | null;
  updatedAt: string;
}

interface ProjectItemNode {
  id: string;
  content: IssueContent | null;
  fieldValues: {
    nodes?: FieldValueNode[];
  };
}

interface ListProjectItemsResponse {
  node?: {
    __typename?: string;
    items: {
      pageInfo?: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes?: ProjectItemNode[];
    };
  } | null;
}

interface ReadProjectItemResponse {
  node?: {
    __typename?: string;
    fieldValues: {
      pageInfo?: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes?: FieldValueNode[];
    };
  } | null;
}

interface UpdateProjectV2ItemFieldValueResponse {
  updateProjectV2ItemFieldValue?: {
    projectV2Item?: {
      id: string;
    } | null;
  } | null;
}

export class DefaultGitHubProjectClient implements GitHubProjectClient {
  constructor(
    private graphql: GitHubGraphqlTransport = githubGraphql,
  ) {}

  async readProjectConfiguration(
    owner: string,
    projectNumber: number,
  ): Promise<ProjectConfiguration> {
    const initialQuery = `
      query ReadProjectConfiguration($owner: String!, $number: Int!, $after: String) {
        organization(login: $owner) {
          projectV2(number: $number) {
            id
            title
            fields(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                __typename
                ... on ProjectV2Field { id name dataType }
                ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                ... on ProjectV2IterationField { id name dataType }
              }
            }
          }
        }
        user(login: $owner) {
          projectV2(number: $number) {
            id
            title
            fields(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                __typename
                ... on ProjectV2Field { id name dataType }
                ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                ... on ProjectV2IterationField { id name dataType }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<ReadProjectInitialResponse>(initialQuery, {
      owner,
      number: projectNumber,
      after: null,
    });

    const project = data.organization?.projectV2 ?? data.user?.projectV2;
    if (!project) {
      throw new Error(
        `GitHub Project ${owner}/${projectNumber} was not found or is not accessible`,
      );
    }

    const fields: ProjectField[] = [];
    let cursor = project.fields.pageInfo?.endCursor ?? null;
    let hasNextPage = project.fields.pageInfo?.hasNextPage ?? false;
    const initialNodes = project.fields.nodes ?? [];
    for (const node of initialNodes) {
      if (node) addField(fields, mapFieldNode(node));
    }

    const pageQuery = `
      query PaginateProjectFields($projectId: ID!, $after: String) {
        node(id: $projectId) {
          __typename
          ... on ProjectV2 {
            fields(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                __typename
                ... on ProjectV2Field { id name dataType }
                ... on ProjectV2SingleSelectField { id name dataType options { id name } }
                ... on ProjectV2IterationField { id name dataType }
              }
            }
          }
        }
      }
    `;

    while (hasNextPage) {
      const pageData = await this.graphql<ReadProjectPageResponse>(pageQuery, {
        projectId: project.id,
        after: cursor,
      });
      const projectNode = pageData.node;
      if (!projectNode || projectNode.__typename !== 'ProjectV2') {
        throw new Error('GitHub project node was not found while paginating fields');
      }
      const nodes = projectNode.fields.nodes ?? [];
      for (const node of nodes) {
        if (node) addField(fields, mapFieldNode(node));
      }
      const pageInfo = projectNode.fields.pageInfo;
      hasNextPage = pageInfo?.hasNextPage ?? false;
      cursor = pageInfo?.endCursor ?? null;
    }

    return {
      projectId: project.id,
      title: project.title,
      fields,
    };
  }

  async listProjectItems(
    projectId: string,
    fieldId: string,
  ): Promise<ProjectItem[]> {
    const query = `
      query ListProjectItems($projectId: ID!, $after: String) {
        node(id: $projectId) {
          __typename
          ... on ProjectV2 {
            items(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content {
                  __typename
                  ... on Issue {
                    id
                    number
                    title
                    repository { nameWithOwner }
                  }
                  ... on PullRequest { __typename }
                  ... on DraftIssue { __typename }
                }
                fieldValues(first: 100) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      field { ... on ProjectV2SingleSelectField { id } }
                      optionId
                      updatedAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const items: ProjectItem[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const data: ListProjectItemsResponse = await this.graphql<ListProjectItemsResponse>(query, {
        projectId,
        after: cursor,
      });
      const project = data.node;
      if (!project || project.__typename !== 'ProjectV2') {
        throw new Error('GitHub project was not found while listing items');
      }

      const nodes = project.items.nodes ?? [];
      for (const node of nodes) {
        if (!node) continue;
        const content = node.content;
        if (!content || content.__typename !== 'Issue') continue;

        const fieldValues = node.fieldValues.nodes ?? [];
        const matched = fieldValues.find(
          (value): value is FieldValueNode =>
            value?.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
            value.field?.__typename === 'ProjectV2SingleSelectField' &&
            value.field.id === fieldId,
        );

        items.push({
          projectItemId: node.id,
          issueNodeId: content.id,
          repository: content.repository?.nameWithOwner ?? '',
          issueNumber: content.number,
          title: content.title ?? '',
          currentSingleSelectOptionId: matched?.optionId ?? null,
          fieldUpdatedAt: matched?.updatedAt ?? null,
        });
      }

      const pageInfo = project.items.pageInfo;
      hasNextPage = pageInfo?.hasNextPage ?? false;
      cursor = pageInfo?.endCursor ?? null;
    }

    return items;
  }

  async readProjectItem(
    _projectId: string,
    itemId: string,
    fieldId: string,
  ): Promise<ProjectItemFieldValue | null> {
    const query = `
      query ReadProjectItem($itemId: ID!, $after: String) {
        node(id: $itemId) {
          __typename
          ... on ProjectV2Item {
            id
            fieldValues(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { ... on ProjectV2SingleSelectField { id } }
                  optionId
                  updatedAt
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql<ReadProjectItemResponse>(query, {
      itemId,
      after: null,
    });
    const item = data.node;
    if (!item || item.__typename !== 'ProjectV2Item') {
      throw new Error(`GitHub project item ${itemId} was not found`);
    }

    const fieldValues = item.fieldValues.nodes ?? [];
    let cursor = item.fieldValues.pageInfo?.endCursor ?? null;
    let hasNextPage = item.fieldValues.pageInfo?.hasNextPage ?? false;

    while (hasNextPage) {
      const pageData = await this.graphql<ReadProjectItemResponse>(query, {
        itemId,
        after: cursor,
      });
      const pageItem = pageData.node;
      if (!pageItem || pageItem.__typename !== 'ProjectV2Item') {
        throw new Error(`GitHub project item ${itemId} was not found while paginating`);
      }
      fieldValues.push(...(pageItem.fieldValues.nodes ?? []));
      const pageInfo = pageItem.fieldValues.pageInfo;
      hasNextPage = pageInfo?.hasNextPage ?? false;
      cursor = pageInfo?.endCursor ?? null;
    }

    const matched = fieldValues.find(
      (value): value is FieldValueNode =>
        value?.__typename === 'ProjectV2ItemFieldSingleSelectValue' &&
        value.field?.__typename === 'ProjectV2SingleSelectField' &&
        value.field.id === fieldId,
    );

    if (!matched) return null;
    return {
      optionId: matched.optionId ?? null,
      fieldUpdatedAt: matched.updatedAt,
    };
  }

  async updateProjectV2ItemFieldValue(
    projectId: string,
    itemId: string,
    fieldId: string,
    optionId: string,
  ): Promise<void> {
    const mutation = `
      mutation UpdateProjectV2ItemFieldValue($input: UpdateProjectV2ItemFieldValueInput!) {
        updateProjectV2ItemFieldValue(input: $input) {
          projectV2Item { id }
        }
      }
    `;

    await this.graphql<UpdateProjectV2ItemFieldValueResponse>(mutation, {
      input: {
        projectId,
        itemId,
        fieldId,
        value: { singleSelectOptionId: optionId },
      },
    });
  }
}

function addField(fields: ProjectField[], field: ProjectField): void {
  const existing = fields.find((f) => f.id === field.id);
  if (existing) {
    const existingOptions = existing.options ?? [];
    const newOptions = field.options ?? [];
    if (newOptions.length > 0) {
      const seen = new Set(existingOptions.map((o) => o.id));
      for (const option of newOptions) {
        if (!seen.has(option.id)) {
          existingOptions.push(option);
          seen.add(option.id);
        }
      }
      existing.options = existingOptions;
    }
    return;
  }
  fields.push(field);
}

function mapFieldNode(node: FieldNode): ProjectField {
  if (node.__typename === 'ProjectV2SingleSelectField') {
    return {
      id: node.id,
      name: node.name,
      dataType: node.dataType,
      options: node.options ?? [],
    };
  }
  return {
    id: node.id,
    name: node.name,
    dataType: node.dataType,
  };
}
