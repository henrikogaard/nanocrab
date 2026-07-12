import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

import type { AgentRuntimeSelection } from '../types.js';
import type { CodingJob, StartCodingJobInput } from '../coding-jobs.js';
import { createAgentProfile } from '../agent-profiles.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import { startCodingJob, getCodingJob } from '../coding-jobs.js';
import { CODING_WORKSPACE_DIR } from '../config.js';
import {
  executeControlPlaneCommand,
  parseControlPlaneCommand,
  resetControlPlaneCommandCache,
} from './commands.js';
import { dispatchCandidate, runtime } from './dispatcher.js';
import { proposeStageTransition } from './decisions.js';
import { syncPipeline } from './sync.js';
import { buildStageDispatchKey, insertPipeline } from './pipelines.js';
import { getDecision } from './store.js';
import {
  validateStageCompletion,
  type StageRunEvidence,
} from './run-evidence.js';
import type {
  GitHubProjectClient,
  ProjectConfiguration,
  ProjectItem,
} from './github-projects.js';

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DEFAULT_TRIGGER: '@Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
  STORE_DIR: '/tmp/nanocrab-cp-integration-test/store',
  CODING_WORKSPACE_DIR:
    '/tmp/nanocrab-cp-integration-test/data/coding-workspaces',
  DATA_DIR: '/tmp/nanocrab-cp-integration-test/data',
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  CREDENTIAL_PROXY_PORT: 3001,
  TIMEZONE: 'UTC',
  DOCKER_SOCKET_GID: 0,
  getTriggerPattern: (trigger: string = '@Andy') =>
    new RegExp(
      '^' + trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b',
      'i',
    ),
}));

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({ GITHUB_TOKEN: 'test-token' })),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  hostGatewayArgs: vi.fn(() => [
    '--add-host=host.docker.internal:host-gateway',
  ]),
  ensureContainerRuntimeRunning: vi.fn(),
  cleanupOrphans: vi.fn(),
}));

vi.mock('../credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
  CREDENTIAL_PROXY_PORT: 3001,
}));

vi.mock('../provider-router.js', () => ({
  resolveProviderFallbackForAction: vi.fn(() => ({
    approved: true,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
  })),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../coding-jobs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coding-jobs.js')>();
  return {
    ...actual,
    startCodingJob: vi.fn(),
    getCodingJob: vi.fn(),
  };
});

const TEST_ROOT = '/tmp/nanocrab-cp-integration-test';
const now = '2026-07-12T10:00:00.000Z';
const planningTime = now;
const implementTime = '2026-07-12T11:00:00.000Z';
const reviewTime = '2026-07-12T12:00:00.000Z';

interface TraceEvent {
  type: 'github-read' | 'github-write' | 'job-start';
  optionId?: string;
  stageKind?: string;
  agentProfileId?: string;
  workspace?: string;
  jobId?: string;
}

function runtimeSelection(
  cli: AgentRuntimeSelection['cli'],
  provider: AgentRuntimeSelection['provider'],
  model: string,
): AgentRuntimeSelection {
  return { cli, provider, model };
}

function makeGitHubClient(events: TraceEvent[]): GitHubProjectClient {
  const optionTimestamps: Record<string, string> = {
    option_planning: planningTime,
    option_implement: implementTime,
    option_review: reviewTime,
  };

  let current = { optionId: 'option_planning', fieldUpdatedAt: planningTime };

  const configuration: ProjectConfiguration = {
    projectId: 'PVT_120',
    title: 'NanoCrab Delivery',
    fields: [
      {
        id: 'PVTSSF_120',
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

  const items: ProjectItem[] = [
    {
      projectItemId: 'PVTI_120',
      issueNodeId: 'I_120',
      repository: 'henrikogaard/nanocrab',
      issueNumber: 120,
      title: 'Control plane end-to-end proof',
      currentSingleSelectOptionId: 'option_planning',
      fieldUpdatedAt: planningTime,
    },
  ];

  return {
    readProjectConfiguration: vi.fn().mockResolvedValue(configuration),
    listProjectItems: vi.fn().mockResolvedValue(items),
    readProjectItem: vi.fn().mockImplementation(async () => {
      events.push({ type: 'github-read', optionId: current.optionId });
      return { ...current };
    }),
    updateProjectV2ItemFieldValue: vi
      .fn()
      .mockImplementation(async (_projectId, _itemId, _fieldId, optionId) => {
        events.push({ type: 'github-write', optionId });
        current = {
          optionId,
          fieldUpdatedAt: optionTimestamps[optionId] || current.fieldUpdatedAt,
        };
      }),
  } as unknown as GitHubProjectClient;
}

describe('control-plane end-to-end integration', () => {
  let agentIds: Record<'planning' | 'implement' | 'review', string>;
  let pipelineId: string;
  let jobs: CodingJob[];
  let events: TraceEvent[];

  function makeJob(input: StartCodingJobInput): CodingJob {
    const index = jobs.length + 1;
    const id = `code-${index}-${Date.now()}`;
    const repoDir = input.repo ? input.repo.replace('/', '__') : 'repo';
    const workspace = `${CODING_WORKSPACE_DIR}/jobs/${id}/${repoDir}`;
    const job: CodingJob = {
      id,
      repo: input.repo,
      type: input.issueNumber ? 'issue' : 'prompt',
      prompt: input.prompt || '',
      issueNumber: input.issueNumber ?? null,
      issueTitle: input.issueNumber ? 'Control plane end-to-end proof' : null,
      provider: input.actualRuntime?.provider || 'claude',
      model: input.actualRuntime?.model || 'claude-sonnet-4-6',
      status: 'queued',
      branch: `nanocrab/issue-${input.issueNumber || 0}-${id.slice(-8)}`,
      workspace,
      createPr: input.createPr === true,
      dryRun: input.dryRun === true,
      prUrl: input.createPr ? null : null,
      commitSha: null,
      changedFiles: [],
      diffSummary: null,
      testSummary: null,
      investigationSummary: null,
      ciStatus: 'unknown',
      lastCiError: null,
      transitionedAt: {},
      transitionHistory: [],
      failureReason: null,
      approvalHistory: [],
      output: '',
      requestedBy: input.requestedBy,
      agentProfileId: input.agentProfileId || null,
      sourceSubscriptionId: input.sourceSubscriptionId || null,
      pipelineId: input.pipelineId || null,
      stageId: input.stageId || null,
      decisionId: input.decisionId || null,
      actualRuntime: input.actualRuntime || null,
      runId: input.runId || id,
      stageKind: input.stageKind || null,
      stageEvidence: input.stageEvidence || null,
      pushed: false,
      createdAt: now,
      completedAt: null,
    } as unknown as CodingJob;
    events.push({
      type: 'job-start',
      stageKind: input.stageKind || undefined,
      agentProfileId: input.agentProfileId || undefined,
      workspace,
      jobId: id,
    });
    jobs.push(job);
    return job;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetControlPlaneCommandCache();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();

    jobs = [];
    events = [];

    const atlas = createAgentProfile({
      handle: 'atlas',
      displayName: 'Atlas',
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/nanocrab'],
      primaryRuntime: runtimeSelection('claude', 'claude', 'claude-sonnet-4-6'),
    });
    const forge = createAgentProfile({
      handle: 'forge',
      displayName: 'Forge',
      stageRoles: ['implement'],
      repositoryScopes: ['henrikogaard/nanocrab'],
      primaryRuntime: runtimeSelection('codex', 'codex', 'gpt-5.4'),
    });
    const lens = createAgentProfile({
      handle: 'lens',
      displayName: 'Lens',
      stageRoles: ['review'],
      repositoryScopes: ['henrikogaard/nanocrab'],
      primaryRuntime: runtimeSelection('devin', 'claude', 'claude-sonnet-4-6'),
    });

    agentIds = {
      planning: atlas.id,
      implement: forge.id,
      review: lens.id,
    };

    pipelineId = insertPipeline({
      pipeline: {
        id: 'pipeline_120',
        name: 'NanoCrab delivery',
        githubOwner: 'henrikogaard',
        githubProjectNumber: 120,
        githubProjectId: 'PVT_120',
        workflowFieldId: 'PVTSSF_120',
        repositoryScopes: ['henrikogaard/nanocrab'],
        enabled: true,
        syncCursor: null,
        lastSyncedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      stages: [
        {
          id: 'stage_planning',
          pipelineId: 'pipeline_120',
          stageKind: 'planning',
          githubFieldOptionId: 'option_planning',
          githubFieldOptionName: 'Planning',
          agentProfileId: agentIds.planning,
          requiredEvidence: ['plan'],
          position: 0,
        },
        {
          id: 'stage_implement',
          pipelineId: 'pipeline_120',
          stageKind: 'implement',
          githubFieldOptionId: 'option_implement',
          githubFieldOptionName: 'Implement',
          agentProfileId: agentIds.implement,
          requiredEvidence: ['tests', 'open_pr'],
          position: 1,
        },
        {
          id: 'stage_review',
          pipelineId: 'pipeline_120',
          stageKind: 'review',
          githubFieldOptionId: 'option_review',
          githubFieldOptionName: 'Review',
          agentProfileId: agentIds.review,
          requiredEvidence: ['review'],
          position: 2,
        },
      ],
    }).pipeline.id;

    runtime.probe = vi
      .fn()
      .mockImplementation((cli: AgentRuntimeSelection['cli']) =>
        Promise.resolve({
          status: 'healthy',
          cli,
          executable: cli,
          version: '1.0.0',
          checkedAt: now,
          detail: 'ok',
        }),
      ) as unknown as typeof runtime.probe;

    vi.mocked(startCodingJob).mockImplementation(
      (input: StartCodingJobInput) => {
        return Promise.resolve(makeJob(input));
      },
    );
    vi.mocked(getCodingJob).mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    try {
      _closeDatabase();
    } catch {
      /* ignore */
    }
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('runs planning through review with distinct agents, isolated worktrees, and stale deduplication', async () => {
    const client = makeGitHubClient(events);

    // 1. Synchronize the issue in Planning and claim the dispatch.
    const sync = await syncPipeline(pipelineId, client);
    expect(sync.candidates).toHaveLength(1);
    expect(sync.candidates[0]).toMatchObject({
      pipelineId: 'pipeline_120',
      stageId: 'stage_planning',
      agentProfileId: agentIds.planning,
      observedOptionId: 'option_planning',
    });

    // 2. A second sync produces no duplicate candidate.
    const resync = await syncPipeline(pipelineId, client);
    expect(resync.candidates).toHaveLength(0);

    // 3. Dispatch Atlas once for the planning stage.
    const planningCandidate = sync.candidates[0];
    const planningResult = await dispatchCandidate(planningCandidate);
    expect(planningResult.status).toBe('dispatched');
    expect(planningResult.job).toBeDefined();
    expect(vi.mocked(startCodingJob)).toHaveBeenCalledOnce();
    expect(vi.mocked(startCodingJob).mock.calls[0][0].agentProfileId).toBe(
      agentIds.planning,
    );
    expect(vi.mocked(startCodingJob).mock.calls[0][0].stageKind).toBe(
      'planning',
    );
    const planningJob = jobs[0];
    expect(planningJob?.agentProfileId).toBe(agentIds.planning);
    expect(planningJob?.stageKind).toBe('planning');

    // 4. Store a plan artifact and create a pending Implement decision.
    const planEvidence: StageRunEvidence = {
      stageKind: 'planning',
      worktree: planningJob!.workspace,
      branch: planningJob!.branch,
      commitSha: null,
      pushed: false,
      prUrl: null,
      checks: [],
      artifacts: [{ kind: 'plan', pathOrUrl: '/tmp/plan.md' }],
    };
    expect(() => validateStageCompletion(planEvidence)).not.toThrow();

    const implementDecision = proposeStageTransition({
      candidate: planningCandidate,
      runId: planningJob!.id,
      summary: 'Plan produced for issue 120',
      evidence: { stageEvidence: planEvidence },
    });
    expect(implementDecision.kind).toBe('stage_transition');
    expect(implementDecision.status).toBe('pending');
    expect(implementDecision.proposedStageId).toBe('stage_implement');
    expect(implementDecision.proposedAgentProfileId).toBe(agentIds.implement);
    expect(implementDecision.proposedRuntime).toEqual(
      runtimeSelection('codex', 'codex', 'gpt-5.4'),
    );

    // 5. Approve through executeControlPlaneCommand and verify GitHub write/read-back before Forge dispatch.
    const approveImplement = parseControlPlaneCommand(
      'approve #120 to implement',
    )!;
    const implementResult = await executeControlPlaneCommand(approveImplement, {
      channel: 'test',
      chatJid: 'test:123',
      senderId: 'u1',
      senderName: 'Operator',
      isAuthorized: true,
      actor: 'owner',
      githubProjectClient: client,
    });
    expect(implementResult.text).toMatch(/approved.*#120.*implement/i);
    expect(implementResult.text).toContain('dispatched');
    expect(implementResult.decisionId).toBe(implementDecision.id);

    const implementDecisionAfter = getDecision(implementDecision.id)!;
    expect(implementDecisionAfter.status).toBe('approved');
    expect(implementDecisionAfter.actualGithubOptionId).toBe(
      'option_implement',
    );
    expect(implementDecisionAfter.dispatchStatus).toBe('dispatched');
    expect(implementDecisionAfter.actualRuntime).toEqual(
      runtimeSelection('codex', 'codex', 'gpt-5.4'),
    );

    // GitHub write and read-back happened before the Forge job started.
    const writeIdx = events.findIndex(
      (e) => e.type === 'github-write' && e.optionId === 'option_implement',
    );
    const readBackIdx = events.findIndex(
      (e) => e.type === 'github-read' && e.optionId === 'option_implement',
    );
    const forgeJobIdx = events.findIndex(
      (e) => e.type === 'job-start' && e.stageKind === 'implement',
    );
    expect(writeIdx).toBeGreaterThan(-1);
    expect(readBackIdx).toBeGreaterThan(-1);
    expect(forgeJobIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(forgeJobIdx);
    expect(readBackIdx).toBeLessThan(forgeJobIdx);

    expect(startCodingJob).toHaveBeenCalledTimes(2);
    expect(runtime.probe).toHaveBeenCalledTimes(2);
    const implementJob = jobs[1];
    expect(implementJob?.agentProfileId).toBe(agentIds.implement);
    expect(implementJob?.stageKind).toBe('implement');

    // 6. Record isolated worktree, passing test, pushed branch, and PR evidence.
    const implementEvidence: StageRunEvidence = {
      stageKind: 'implement',
      worktree: implementJob!.workspace,
      branch: implementJob!.branch,
      commitSha: 'def4567',
      pushed: true,
      prUrl: 'https://github.com/henrikogaard/nanocrab/pull/120',
      checks: [
        { name: 'typecheck', status: 'passed' },
        { name: 'lint', status: 'passed' },
        { name: 'test', status: 'passed' },
      ],
      artifacts: [
        { kind: 'tests', pathOrUrl: '/tmp/tests.log' },
        {
          kind: 'open_pr',
          pathOrUrl: 'https://github.com/henrikogaard/nanocrab/pull/120',
        },
      ],
      agentProfileId: agentIds.implement,
    };
    expect(() => validateStageCompletion(implementEvidence)).not.toThrow();

    const reviewCandidateKey = buildStageDispatchKey({
      pipelineId: 'pipeline_120',
      projectItemId: 'PVTI_120',
      issueNodeId: 'I_120',
      stageId: 'stage_implement',
      agentProfileId: agentIds.implement,
      githubFieldUpdatedAt: implementDecisionAfter.actualGithubFieldUpdatedAt!,
    });
    const reviewCandidate = {
      dispatchKey: reviewCandidateKey,
      pipelineId: 'pipeline_120',
      projectItemId: 'PVTI_120',
      issueNodeId: 'I_120',
      repository: 'henrikogaard/nanocrab',
      issueNumber: 120,
      stageId: 'stage_implement',
      agentProfileId: agentIds.implement,
      observedOptionId: implementDecisionAfter.actualGithubOptionId!,
      observedFieldUpdatedAt:
        implementDecisionAfter.actualGithubFieldUpdatedAt!,
    };

    const reviewDecision = proposeStageTransition({
      candidate: reviewCandidate,
      runId: implementJob!.id,
      summary: 'Implementation ready for review',
      evidence: { stageEvidence: implementEvidence },
    });
    expect(reviewDecision.kind).toBe('stage_transition');
    expect(reviewDecision.status).toBe('pending');
    expect(reviewDecision.proposedStageId).toBe('stage_review');
    expect(reviewDecision.proposedAgentProfileId).toBe(agentIds.review);

    // 7. Approve Review and verify Lens receives a different profile and worktree.
    const approveReview = parseControlPlaneCommand('approve #120 to review')!;
    const reviewResult = await executeControlPlaneCommand(approveReview, {
      channel: 'test',
      chatJid: 'test:123',
      senderId: 'u1',
      senderName: 'Operator',
      isAuthorized: true,
      actor: 'owner',
      githubProjectClient: client,
    });
    expect(reviewResult.text).toMatch(/approved.*#120.*review/i);
    expect(reviewResult.text).toContain('dispatched');

    const reviewDecisionAfter = getDecision(reviewDecision.id)!;
    expect(reviewDecisionAfter.status).toBe('approved');
    expect(reviewDecisionAfter.actualGithubOptionId).toBe('option_review');
    expect(reviewDecisionAfter.dispatchStatus).toBe('dispatched');
    expect(reviewDecisionAfter.actualRuntime).toEqual(
      runtimeSelection('devin', 'claude', 'claude-sonnet-4-6'),
    );

    expect(vi.mocked(startCodingJob)).toHaveBeenCalledTimes(3);
    expect(runtime.probe).toHaveBeenCalledTimes(3);
    const reviewJob = jobs[2];
    expect(reviewJob?.agentProfileId).toBe(agentIds.review);
    expect(reviewJob?.stageKind).toBe('review');
    expect(reviewJob?.workspace).not.toBe(implementJob?.workspace);
    expect(vi.mocked(startCodingJob).mock.calls[2][0].actualRuntime).toEqual(
      runtimeSelection('devin', 'claude', 'claude-sonnet-4-6'),
    );
    expect(vi.mocked(startCodingJob).mock.calls[2][0].createPr).toBe(false);

    // 8. Reject a stale duplicate command and prove no duplicate job exists.
    const staleDecision = proposeStageTransition({
      candidate: planningCandidate,
      runId: planningJob!.id,
      summary: 'Stale duplicate planning to implement decision',
    });
    const staleCommand = parseControlPlaneCommand('approve #120 to implement')!;
    const staleContext = {
      channel: 'test',
      chatJid: 'test:123',
      senderId: 'u1',
      senderName: 'Operator',
      isAuthorized: true,
      actor: 'owner',
      messageId: 'stale-duplicate',
      githubProjectClient: client,
    };
    const staleResult = await executeControlPlaneCommand(
      staleCommand,
      staleContext,
    );
    expect(staleResult.text).toContain('stale');
    expect(getDecision(staleDecision.id)?.status).toBe('stale');

    // A duplicate command with the same message id returns the cached result and does not start a job.
    const duplicateResult = await executeControlPlaneCommand(
      staleCommand,
      staleContext,
    );
    expect(duplicateResult).toEqual(staleResult);
    expect(startCodingJob).toHaveBeenCalledTimes(3);
    expect(runtime.probe).toHaveBeenCalledTimes(3);
  });
});
