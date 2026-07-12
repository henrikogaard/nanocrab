import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { AgentProfileInput } from '../../agent-profiles.js';
import type { AgentProvider } from '../../agent-provider.js';
import type {
  AgentCliId,
  AgentProfileTaskKind,
  AgentStageRole,
} from '../../types.js';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-control-plane-route-test-${Date.now()}`,
);
const DATA_DIR = path.join(
  os.tmpdir(),
  `nanocrab-control-plane-route-test-data-${Date.now()}`,
);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-control-plane-route-test-groups-${Date.now()}`,
);

vi.mock('../../config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  GROUPS_DIR,
  ASSISTANT_NAME: 'Assistant',
}));

vi.mock('../../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../../admin/state.js', () => ({
  getState: () => {
    throw new Error('state not initialized');
  },
}));

vi.mock('../../admin/security.js', () => ({
  auditLog: vi.fn(),
}));

vi.mock('../../coding-jobs.js', () => {
  const jobs: Array<Record<string, unknown>> = [];
  return {
    getGitHubToken: vi.fn().mockReturnValue('mock-token'),
    githubApi: vi.fn().mockImplementation(async () => {
      throw new Error('not mocked');
    }),
    githubGraphql: vi.fn().mockImplementation(async () => {
      throw new Error('not mocked');
    }),
    getCodingJob: vi.fn((id: string) => jobs.find((j) => j.id === id)) as any,
    loadCodingJobs: vi.fn(() => jobs) as any,
    startCodingJob: vi.fn(async (input: any) => {
      const job = {
        id: `code-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...input,
        status: 'queued',
        prUrl: null,
        commitSha: null,
        branch: 'mock-branch',
        ciStatus: 'unknown',
        actualRuntime: input.actualRuntime,
      };
      jobs.push(job);
      return job;
    }),
  };
});

vi.mock('../../control-plane/github-projects.js', () => {
  class StageConflictError extends Error {
    details?: unknown;
    constructor(message: string, details?: unknown) {
      super(message);
      this.name = 'StageConflictError';
      this.details = details;
    }
  }

  // Shared mocks so tests can override the behavior seen by the route too.
  const readProjectConfiguration = vi.fn().mockResolvedValue({
    projectId: 'proj_123',
    title: 'Mock project',
    fields: [
      {
        id: 'field_123',
        name: 'Status',
        dataType: 'SINGLE_SELECT',
        options: [
          { id: 'opt_plan', name: 'Planning' },
          { id: 'opt_impl', name: 'Implement' },
          { id: 'opt_review', name: 'Review' },
        ],
      },
    ],
  });
  const listProjectItems = vi.fn().mockResolvedValue([]);
  const readProjectItem = vi.fn().mockResolvedValue({
    optionId: 'opt_plan',
    fieldUpdatedAt: '2026-07-12T12:00:00Z',
  });
  const updateProjectV2ItemFieldValue = vi.fn().mockResolvedValue(undefined);

  class DefaultGitHubProjectClient {
    readProjectConfiguration = readProjectConfiguration;
    listProjectItems = listProjectItems;
    readProjectItem = readProjectItem;
    updateProjectV2ItemFieldValue = updateProjectV2ItemFieldValue;
  }

  const updateProjectItemStage = vi.fn().mockResolvedValue({
    workflowOptionId: 'opt_impl',
    fieldUpdatedAt: '2026-07-12T12:00:01Z',
  });

  return {
    StageConflictError,
    DefaultGitHubProjectClient,
    updateProjectItemStage,
  };
});

const { _closeDatabase, _initTestDatabase } = await import('../../db.js');
const { createAgentProfile } = await import('../../agent-profiles.js');
const { saveProjectItemSnapshot: _saveProjectItemSnapshot } =
  await import('../../control-plane/store.js');
const { default: controlPlaneRouter } = await import('./control-plane.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: 'admin', username: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/control-plane', controlPlaneRouter);
  return app;
}

async function withServer<T>(
  handler: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = buildApp();
  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const listeningServer = app.listen(0, '127.0.0.1', () =>
        resolve(listeningServer),
      );
      listeningServer.on('error', reject);
    },
  );
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to a port');
    }
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

type PipelineResponse = {
  ok: boolean;
  pipeline: {
    pipeline: { id: string; name?: string };
    stages: Array<{ id: string; stageKind: string }>;
  };
};

async function postJson<T>(
  baseUrl: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as T };
}

async function putJson<T>(
  baseUrl: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; body: T }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as T };
}

function makeAgentInput(
  handle: string,
  role: AgentStageRole,
  cli: AgentCliId,
): AgentProfileInput {
  return {
    handle,
    displayName: handle.charAt(0).toUpperCase() + handle.slice(1),
    enabled: true,
    primaryRuntime: {
      cli: cli as AgentCliId,
      provider: (cli === 'devin' ? 'claude' : cli) as AgentProvider,
      model: cli === 'codex' ? 'gpt-5.4' : 'claude-sonnet-4-6',
    },
    stageRoles: [role],
    repositoryScopes: ['owner/repo'],
    taskKinds: ['coding_job' as AgentProfileTaskKind],
  };
}

function makePipelineInput(
  stages: { agentProfileId: string; stageKind: string }[],
) {
  return {
    pipeline: {
      name: 'NanoCrab Delivery',
      githubOwner: 'owner',
      githubProjectNumber: 1,
      githubProjectId: 'proj_123',
      workflowFieldId: 'field_123',
      repositoryScopes: ['owner/repo'],
      enabled: true,
    },
    stages: stages.map((s, position) => ({
      githubFieldOptionId: `opt_${s.stageKind}`,
      githubFieldOptionName: s.stageKind,
      stageKind: s.stageKind,
      agentProfileId: s.agentProfileId,
      requiredEvidence: [],
      position,
    })),
  };
}

describe('/api/control-plane', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(GROUPS_DIR, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  it('GET /api/control-plane/overview returns board cards and stats', async () => {
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      expect(create.res.status).toBe(201);
      const _pipelineId = create.body.pipeline.pipeline.id;

      const res = await fetch(`${base}/api/control-plane/overview`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        boardCards: Array<unknown>;
        stats: Record<string, number>;
      };
      expect(body.ok).toBe(true);
      expect(body.stats.pipelines).toBe(1);
      expect(body.stats.agents).toBe(3);
      expect(body.boardCards).toEqual([]);
    });
  });

  it('GET /api/control-plane/runtimes returns runtime health', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/control-plane/runtimes`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        runtimes: Array<{ cli: string; health: { status: string } | null }>;
      };
      expect(body.runtimes.length).toBeGreaterThan(0);
      expect(body.runtimes.map((r) => r.cli)).toContain('claude');
    });
  });

  it('POST /api/control-plane/pipelines creates a pipeline with 201', async () => {
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const { res, body } = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      expect(res.status).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.pipeline.pipeline.id).toMatch(/^pipeline_/);
    });
  });

  it('POST /api/control-plane/pipelines returns 400 for invalid stages', async () => {
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const { res, body } = await postJson<{ error: string }>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: atlas.id, stageKind: 'planning' },
        ]),
      );
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/exactly one planning/i);
    });
  });

  it('GET /api/control-plane/pipelines lists created pipelines', async () => {
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      await postJson(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );

      const res = await fetch(`${base}/api/control-plane/pipelines`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { pipelines: Array<{ id: string }> };
      expect(body.pipelines.length).toBe(1);
    });
  });

  it('PUT /api/control-plane/pipelines/:id updates and returns 200', async () => {
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const id = create.body.pipeline.pipeline.id;

      const { res, body } = await putJson<PipelineResponse>(
        base,
        `/api/control-plane/pipelines/${id}`,
        {
          pipeline: { name: 'Renamed' },
        },
      );
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.pipeline.pipeline.name).toBe('Renamed');
    });
  });

  it('PUT /api/control-plane/pipelines/:id returns 404 for unknown id', async () => {
    await withServer(async (base) => {
      const { res } = await putJson(
        base,
        '/api/control-plane/pipelines/pipeline_unknown',
        { pipeline: { name: 'Renamed' } },
      );
      expect(res.status).toBe(404);
    });
  });

  it('POST /api/control-plane/pipelines/:id/sync returns 200 with candidates', async () => {
    const { DefaultGitHubProjectClient: _DefaultGitHubProjectClient } =
      await import('../../control-plane/github-projects.js');
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const id = create.body.pipeline.pipeline.id;

      const res = await fetch(
        `${base}/api/control-plane/pipelines/${id}/sync`,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        candidates: unknown[];
        configurationErrors: unknown[];
      };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.candidates)).toBe(true);
    });
  });

  it('POST /api/control-plane/pipelines/:id/sync returns 503 when GitHub is unavailable', async () => {
    const { DefaultGitHubProjectClient } =
      await import('../../control-plane/github-projects.js');
    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const id = create.body.pipeline.pipeline.id;

      const client = new DefaultGitHubProjectClient();
      (client.readProjectConfiguration as any).mockRejectedValue(
        new Error('GITHUB_TOKEN is not configured'),
      );

      const res = await fetch(
        `${base}/api/control-plane/pipelines/${id}/sync`,
        { method: 'POST' },
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/github/i);
    });
  });

  it('GET /api/control-plane/runs returns control-plane runs', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/control-plane/runs`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { runs: unknown[] };
      expect(Array.isArray(body.runs)).toBe(true);
    });
  });

  it('GET /api/control-plane/decisions returns decisions', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/control-plane/decisions`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { decisions: unknown[] };
      expect(Array.isArray(body.decisions)).toBe(true);
    });
  });

  it('POST /api/control-plane/decisions/:id/approve returns 200 for a runtime fallback decision', async () => {
    const { insertDecision } = await import('../../control-plane/store.js');
    const { updateProjectItemStage } =
      await import('../../control-plane/github-projects.js');

    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const pipelineId = create.body.pipeline.pipeline.id;
      const implementStage = create.body.pipeline.stages.find(
        (s) => s.stageKind === 'implement',
      )!;

      const decision = insertDecision({
        id: `decision_${Date.now()}`,
        kind: 'runtime_fallback',
        status: 'pending',
        pipelineId,
        projectItemId: 'item_1',
        issueNodeId: 'issue_1',
        repository: 'owner/repo',
        issueNumber: 1,
        stageId: implementStage.id,
        runId: null,
        proposedStageId: null,
        proposedAgentProfileId: forge.id,
        proposedRuntime: forge.primaryRuntime,
        expectedGithubOptionId: 'opt_implement',
        expectedGithubFieldUpdatedAt: '2026-07-12T12:00:00Z',
        actualGithubOptionId: null,
        actualGithubFieldUpdatedAt: null,
        summary: 'Fallback to codex',
        evidence: {},
        decidedBy: null,
        decidedFrom: null,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        actualRuntime: null,
        dispatchStatus: null,
        dispatchError: null,
        dispatchJobId: null,
        dispatchDecisionId: null,
        approvalId: null,
        correlationId: null,
      });

      (updateProjectItemStage as any).mockResolvedValue({
        workflowOptionId: 'opt_implement',
        fieldUpdatedAt: '2026-07-12T12:00:01Z',
      });

      const res = await fetch(
        `${base}/api/control-plane/decisions/${decision.id}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'approved' }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        decision: { status: string };
      };
      expect(body.ok).toBe(true);
      expect(body.decision.status).toBe('approved');
    });
  });

  it('POST /api/control-plane/decisions/:id/approve returns 409 for a stale GitHub conflict', async () => {
    const { StageConflictError, updateProjectItemStage } =
      await import('../../control-plane/github-projects.js');
    const { insertDecision } = await import('../../control-plane/store.js');

    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const pipelineId = create.body.pipeline.pipeline.id;
      const implementStage = create.body.pipeline.stages.find(
        (s) => s.stageKind === 'implement',
      )!;

      const decision = insertDecision({
        id: `decision_${Date.now()}`,
        kind: 'stage_transition',
        status: 'pending',
        pipelineId,
        projectItemId: 'item_1',
        issueNodeId: 'issue_1',
        repository: 'owner/repo',
        issueNumber: 1,
        stageId: implementStage.id,
        runId: null,
        proposedStageId: create.body.pipeline.stages.find(
          (s) => s.stageKind === 'review',
        )!.id,
        proposedAgentProfileId: lens.id,
        proposedRuntime: null,
        expectedGithubOptionId: 'opt_implement',
        expectedGithubFieldUpdatedAt: '2026-07-12T12:00:00Z',
        actualGithubOptionId: null,
        actualGithubFieldUpdatedAt: null,
        summary: 'Move to review',
        evidence: {},
        decidedBy: null,
        decidedFrom: null,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        actualRuntime: null,
        dispatchStatus: null,
        dispatchError: null,
        dispatchJobId: null,
        dispatchDecisionId: null,
        approvalId: null,
        correlationId: null,
      });

      (updateProjectItemStage as any).mockRejectedValue(
        new StageConflictError('GitHub project item has changed', {} as any),
      );

      const res = await fetch(
        `${base}/api/control-plane/decisions/${decision.id}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'approved' }),
        },
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/stale|conflict/i);
    });
  });

  it('POST /api/control-plane/decisions/:id/approve returns 503 when GitHub is unavailable', async () => {
    const { updateProjectItemStage } =
      await import('../../control-plane/github-projects.js');
    const { insertDecision } = await import('../../control-plane/store.js');

    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const pipelineId = create.body.pipeline.pipeline.id;
      const implementStage = create.body.pipeline.stages.find(
        (s) => s.stageKind === 'implement',
      )!;

      const decision = insertDecision({
        id: `decision_${Date.now()}`,
        kind: 'stage_transition',
        status: 'pending',
        pipelineId,
        projectItemId: 'item_1',
        issueNodeId: 'issue_1',
        repository: 'owner/repo',
        issueNumber: 1,
        stageId: implementStage.id,
        runId: null,
        proposedStageId: create.body.pipeline.stages.find(
          (s) => s.stageKind === 'review',
        )!.id,
        proposedAgentProfileId: lens.id,
        proposedRuntime: null,
        expectedGithubOptionId: 'opt_implement',
        expectedGithubFieldUpdatedAt: '2026-07-12T12:00:00Z',
        actualGithubOptionId: null,
        actualGithubFieldUpdatedAt: null,
        summary: 'Move to review',
        evidence: {},
        decidedBy: null,
        decidedFrom: null,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        actualRuntime: null,
        dispatchStatus: null,
        dispatchError: null,
        dispatchJobId: null,
        dispatchDecisionId: null,
        approvalId: null,
        correlationId: null,
      });

      (updateProjectItemStage as any).mockRejectedValue(
        new Error('GITHUB_TOKEN is not configured'),
      );

      const res = await fetch(
        `${base}/api/control-plane/decisions/${decision.id}/approve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'approved' }),
        },
      );
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/github/i);
    });
  });

  it('POST /api/control-plane/decisions/:id/reject returns 200 for a pending decision', async () => {
    const { insertDecision } = await import('../../control-plane/store.js');

    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const pipelineId = create.body.pipeline.pipeline.id;
      const implementStage = create.body.pipeline.stages.find(
        (s) => s.stageKind === 'implement',
      )!;

      const decision = insertDecision({
        id: `decision_${Date.now()}`,
        kind: 'stage_transition',
        status: 'pending',
        pipelineId,
        projectItemId: 'item_1',
        issueNodeId: 'issue_1',
        repository: 'owner/repo',
        issueNumber: 1,
        stageId: implementStage.id,
        runId: null,
        proposedStageId: create.body.pipeline.stages.find(
          (s) => s.stageKind === 'review',
        )!.id,
        proposedAgentProfileId: lens.id,
        proposedRuntime: null,
        expectedGithubOptionId: 'opt_implement',
        expectedGithubFieldUpdatedAt: '2026-07-12T12:00:00Z',
        actualGithubOptionId: null,
        actualGithubFieldUpdatedAt: null,
        summary: 'Move to review',
        evidence: {},
        decidedBy: null,
        decidedFrom: null,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        actualRuntime: null,
        dispatchStatus: null,
        dispatchError: null,
        dispatchJobId: null,
        dispatchDecisionId: null,
        approvalId: null,
        correlationId: null,
      });

      const res = await fetch(
        `${base}/api/control-plane/decisions/${decision.id}/reject`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'not yet' }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        decision: { status: string };
      };
      expect(body.ok).toBe(true);
      expect(body.decision.status).toBe('rejected');
    });
  });

  it('POST /api/control-plane/decisions/:id/reassign returns 400 without agentHandle', async () => {
    const { insertDecision } = await import('../../control-plane/store.js');

    await withServer(async (base) => {
      const atlas = createAgentProfile(
        makeAgentInput('atlas', 'planning', 'claude'),
      );
      const forge = createAgentProfile(
        makeAgentInput('forge', 'implement', 'codex'),
      );
      const lens = createAgentProfile(
        makeAgentInput('lens', 'review', 'devin'),
      );

      const create = await postJson<PipelineResponse>(
        base,
        '/api/control-plane/pipelines',
        makePipelineInput([
          { agentProfileId: atlas.id, stageKind: 'planning' },
          { agentProfileId: forge.id, stageKind: 'implement' },
          { agentProfileId: lens.id, stageKind: 'review' },
        ]),
      );
      const pipelineId = create.body.pipeline.pipeline.id;
      const implementStage = create.body.pipeline.stages.find(
        (s) => s.stageKind === 'implement',
      )!;

      const decision = insertDecision({
        id: `decision_${Date.now()}`,
        kind: 'stage_transition',
        status: 'pending',
        pipelineId,
        projectItemId: 'item_1',
        issueNodeId: 'issue_1',
        repository: 'owner/repo',
        issueNumber: 1,
        stageId: implementStage.id,
        runId: null,
        proposedStageId: create.body.pipeline.stages.find(
          (s) => s.stageKind === 'review',
        )!.id,
        proposedAgentProfileId: lens.id,
        proposedRuntime: null,
        expectedGithubOptionId: 'opt_implement',
        expectedGithubFieldUpdatedAt: '2026-07-12T12:00:00Z',
        actualGithubOptionId: null,
        actualGithubFieldUpdatedAt: null,
        summary: 'Move to review',
        evidence: {},
        decidedBy: null,
        decidedFrom: null,
        decisionNote: null,
        createdAt: new Date().toISOString(),
        decidedAt: null,
        actualRuntime: null,
        dispatchStatus: null,
        dispatchError: null,
        dispatchJobId: null,
        dispatchDecisionId: null,
        approvalId: null,
        correlationId: null,
      });

      const res = await fetch(
        `${base}/api/control-plane/decisions/${decision.id}/reassign`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ note: 'reassign' }),
        },
      );
      expect(res.status).toBe(400);
    });
  });

  it('POST /api/control-plane/decisions/:id/{approve,reject,revise,reassign} returns 404 for unknown id', async () => {
    await withServer(async (base) => {
      for (const action of [
        'approve',
        'reject',
        'revise',
        'reassign',
      ] as const) {
        const res = await fetch(
          `${base}/api/control-plane/decisions/decision_unknown/${action}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ note: 'x' }),
          },
        );
        expect(res.status).toBe(404);
      }
    });
  });
});
