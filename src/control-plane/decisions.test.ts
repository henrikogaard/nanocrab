import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-cp-decisions-test/store',
  CODING_WORKSPACE_DIR:
    '/tmp/nanocrab-cp-decisions-test/data/coding-workspaces',
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CREDENTIAL_PROXY_PORT: 3001,
  DATA_DIR: '/tmp/nanocrab-cp-decisions-test/data',
  TIMEZONE: 'UTC',
}));

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({ GITHUB_TOKEN: 'test-token' })),
}));

vi.mock('../container-runtime.js', () => ({
  CONTAINER_RUNTIME_BIN: 'docker',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  hostGatewayArgs: vi.fn(() => [
    '--add-host=host.docker.internal:host-gateway',
  ]),
}));

vi.mock('../credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
}));

vi.mock('../provider-router.js', () => ({
  resolveProviderFallbackForAction: vi.fn(() => ({
    approved: true,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
  })),
}));

vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

import fs from 'fs';

import { createAgentProfile } from '../agent-profiles.js';
import { registerCodingRepo } from '../coding-jobs.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import { insertPipeline } from './pipelines.js';
import {
  proposeStageTransition,
  resolveDecision,
  DecisionResolutionError as _DecisionResolutionError,
  DecisionStaleError as _DecisionStaleError,
} from './decisions.js';
import { getDecision, getStageAssignmentsForIssue } from './store.js';
import { runtime } from './dispatcher.js';
import type { StageDispatchCandidate } from './sync.js';
import type { GitHubProjectClient } from './github-projects.js';
import type { AgentRuntimeSelection } from '../types.js';

const TEST_ROOT = '/tmp/nanocrab-cp-decisions-test';
const now = '2026-07-12T10:00:00.000Z';

function mockGitHubFetch(handler: (url: string) => unknown) {
  const fetchMock = vi.fn(async (url: string | URL) => ({
    ok: true,
    status: 200,
    json: async () => handler(String(url)),
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function runtimeSelection(
  cli: AgentRuntimeSelection['cli'],
  provider: AgentRuntimeSelection['provider'],
  model: string,
): AgentRuntimeSelection {
  return { cli, provider, model };
}

function healthy(
  cli: AgentRuntimeSelection['cli'],
): import('../types.js').AgentRuntimeHealth {
  return {
    status: 'healthy',
    cli,
    executable: cli,
    version: '1.0.0',
    checkedAt: now,
    detail: 'ok',
  };
}

function missing(
  cli: AgentRuntimeSelection['cli'],
): import('../types.js').AgentRuntimeHealth {
  return {
    status: 'missing',
    cli,
    executable: cli,
    version: null,
    checkedAt: now,
    detail: 'not installed',
  };
}

describe('control plane decisions', () => {
  let agentIds: Record<'planning' | 'implement' | 'review', string>;

  beforeEach(() => {
    vi.useFakeTimers();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
    agentIds = {} as Record<'planning' | 'implement' | 'review', string>;
    for (const [handle, role] of [
      ['atlas', 'planning'],
      ['forge', 'implement'],
      ['sentinel', 'review'],
    ] as const) {
      const profile = createAgentProfile({
        handle,
        displayName: handle,
        stageRoles: [role],
        repositoryScopes: ['henrikogaard/nanocrab'],
        primaryRuntime:
          role === 'planning'
            ? runtimeSelection('claude', 'claude', 'claude-sonnet-4-6')
            : runtimeSelection('codex', 'codex', 'gpt-5.4'),
        fallbackRuntimes:
          role === 'implement'
            ? [
                runtimeSelection(
                  'opencode',
                  'opencode',
                  'opencode/grok-code-fast-1',
                ),
              ]
            : [runtimeSelection('claude', 'claude', 'claude-sonnet-4-6')],
      });
      agentIds[role] = profile.id;
    }

    insertPipeline({
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
          requiredEvidence: position === 1 ? ['tests', 'open_pr'] : [],
          position,
        }),
      ),
    });

    mockGitHubFetch((url) => {
      if (url.includes('/repos/henrikogaard/nanocrab/issues/1')) {
        return { title: 'Example issue', body: 'Issue body' };
      }
      if (url.includes('/repos/henrikogaard/nanocrab')) {
        return { default_branch: 'main' };
      }
      return {};
    });

    runtime.probe = vi.fn() as unknown as typeof runtime.probe;
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

  function candidate(
    stage: 'planning' | 'implement' | 'review',
  ): StageDispatchCandidate {
    return {
      dispatchKey: 'key',
      pipelineId: 'pipeline_1',
      projectItemId: 'PVTI_1',
      issueNodeId: 'I_1',
      repository: 'henrikogaard/nanocrab',
      issueNumber: 1,
      stageId: `stage_${stage}`,
      agentProfileId: agentIds[stage],
      observedOptionId: `option_${stage}`,
      observedFieldUpdatedAt: now,
    };
  }

  function makeClient(
    initial: { optionId: string; fieldUpdatedAt: string },
    target: { optionId: string; fieldUpdatedAt: string; stale?: boolean },
  ): GitHubProjectClient {
    let current = target.stale ? target : initial;
    return {
      readProjectConfiguration: vi.fn(),
      listProjectItems: vi.fn(),
      readProjectItem: vi.fn(async () => ({
        optionId: current.optionId,
        fieldUpdatedAt: current.fieldUpdatedAt,
      })),
      updateProjectV2ItemFieldValue: vi.fn(
        async (_projectId, _itemId, _fieldId, optionId) => {
          current = {
            optionId,
            fieldUpdatedAt: target.fieldUpdatedAt,
          };
        },
      ),
    };
  }

  it('proposes a stage transition decision', () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });

    expect(decision.kind).toBe('stage_transition');
    expect(decision.status).toBe('pending');
    expect(decision.stageId).toBe('stage_planning');
    expect(decision.proposedStageId).toBe('stage_implement');
    expect(decision.proposedAgentProfileId).toBe(agentIds.implement);
    expect(decision.proposedRuntime).toEqual(
      runtimeSelection('codex', 'codex', 'gpt-5.4'),
    );
  });

  it('concurrent approve/reject attempts allow exactly one terminal action', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );
    vi.mocked(runtime.probe).mockResolvedValue(healthy('codex'));
    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const [approveResult, rejectResult] = await Promise.allSettled([
      resolveDecision(
        decision.id,
        { action: 'approve', actor: 'owner' },
        client,
      ),
      resolveDecision(decision.id, { action: 'reject', actor: 'owner' }),
    ]);

    const statuses = [approveResult, rejectResult].map((r) =>
      r.status === 'fulfilled' ? r.value.status : undefined,
    );
    expect(statuses).toContain('approved');
    const settled = new Set(statuses);
    expect(settled.size).toBe(2);

    const resolved = getDecision(decision.id);
    expect(resolved?.status).toBe('approved');
  });

  it('rejects an unauthorized actor', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });

    await expect(
      resolveDecision(decision.id, { action: 'approve', actor: 'attacker' }),
    ).rejects.toThrow(/not authorized/);
  });

  it('invalidates a stale decision when the GitHub state changed', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_other',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
        stale: true,
      },
    );

    await expect(
      resolveDecision(
        decision.id,
        { action: 'approve', actor: 'owner' },
        client,
      ),
    ).rejects.toThrow(/stale/);

    expect(getDecision(decision.id)?.status).toBe('stale');
  });

  it('rejects without mutating GitHub', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );

    const result = await resolveDecision(
      decision.id,
      { action: 'reject', actor: 'owner', note: 'not ready' },
      client,
    );

    expect(result.status).toBe('rejected');
    expect(client.updateProjectV2ItemFieldValue).not.toHaveBeenCalled();
  });

  it('revises with feedback and does not write GitHub', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );
    vi.mocked(runtime.probe).mockResolvedValue(healthy('claude'));
    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const result = await resolveDecision(
      decision.id,
      { action: 'revise', actor: 'owner', note: 'Add rollback tests.' },
      client,
    );

    expect(result.status).toBe('revised');
    expect(client.updateProjectV2ItemFieldValue).not.toHaveBeenCalled();
    expect(result.dispatchStatus).toBe('dispatched');
    expect(result.dispatchJobId).toBeTruthy();
  });

  it('reassigns while preserving stage/profile policy constraints', async () => {
    const architect = createAgentProfile({
      handle: 'architect',
      displayName: 'Architect',
      stageRoles: ['planning'],
      repositoryScopes: ['henrikogaard/nanocrab'],
      primaryRuntime: runtimeSelection('claude', 'claude', 'claude-sonnet-4-6'),
    });

    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    vi.mocked(runtime.probe).mockResolvedValue(healthy('claude'));
    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const result = await resolveDecision(decision.id, {
      action: 'reassign',
      actor: 'owner',
      agentHandle: 'architect',
    });

    expect(result.status).toBe('reassigned');
    expect(result.dispatchStatus).toBe('dispatched');
    const assignments = getStageAssignmentsForIssue('pipeline_1', 'I_1');
    expect(
      assignments.find((a) => a.stageId === 'stage_planning')?.agentProfileId,
    ).toBe(architect.id);
  });

  it('rejects reassignment that violates stage policy', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });

    await expect(
      resolveDecision(decision.id, {
        action: 'reassign',
        actor: 'owner',
        agentHandle: 'forge',
      }),
    ).rejects.toThrow(/stage role|role/);
  });

  it('approves a stage transition and dispatches the next stage', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );
    vi.mocked(runtime.probe).mockResolvedValue(healthy('codex'));
    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const result = await resolveDecision(
      decision.id,
      { action: 'approve', actor: 'owner' },
      client,
    );

    expect(result.status).toBe('approved');
    expect(result.dispatchStatus).toBe('dispatched');
    expect(result.actualRuntime).toEqual(
      runtimeSelection('codex', 'codex', 'gpt-5.4'),
    );
    expect(client.updateProjectV2ItemFieldValue).toHaveBeenCalled();
  });

  it('approved fallback records the actual CLI/provider/model', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );
    const probe = vi.mocked(runtime.probe);
    probe.mockResolvedValueOnce(missing('codex'));
    probe.mockResolvedValueOnce(healthy('opencode'));

    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const approved = await resolveDecision(
      decision.id,
      { action: 'approve', actor: 'owner' },
      client,
    );

    expect(approved.status).toBe('approved');
    expect(approved.dispatchStatus).toBe('awaiting_fallback_approval');
    expect(approved.dispatchDecisionId).toBeTruthy();

    const fallback = getDecision(approved.dispatchDecisionId!);
    expect(fallback).toBeDefined();
    expect(fallback?.proposedRuntime).toEqual(
      runtimeSelection('opencode', 'opencode', 'opencode/grok-code-fast-1'),
    );

    const fallbackResult = await resolveDecision(fallback!.id, {
      action: 'approve',
      actor: 'owner',
    });

    expect(fallbackResult.status).toBe('approved');
    expect(fallbackResult.dispatchStatus).toBe('dispatched');
    expect(fallbackResult.actualRuntime).toEqual(
      runtimeSelection('opencode', 'opencode', 'opencode/grok-code-fast-1'),
    );
  });

  it('keeps a failed dispatch visible and retryable without rolling back GitHub', async () => {
    const decision = proposeStageTransition({
      candidate: candidate('planning'),
      runId: 'run_1',
    });
    const client = makeClient(
      { optionId: 'option_planning', fieldUpdatedAt: now },
      {
        optionId: 'option_implement',
        fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
      },
    );
    vi.mocked(runtime.probe).mockResolvedValue(healthy('codex'));

    const first = await resolveDecision(
      decision.id,
      { action: 'approve', actor: 'owner' },
      client,
    );

    expect(first.status).toBe('approved');
    expect(first.dispatchStatus).toBe('dispatch_failed');
    expect(first.actualGithubOptionId).toBe('option_implement');
    expect(client.updateProjectV2ItemFieldValue).toHaveBeenCalledTimes(1);

    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });

    const second = await resolveDecision(decision.id, {
      action: 'approve',
      actor: 'owner',
    });

    expect(second.status).toBe('approved');
    expect(second.dispatchStatus).toBe('dispatched');
    expect(second.dispatchJobId).toBeTruthy();
    expect(client.updateProjectV2ItemFieldValue).toHaveBeenCalledTimes(1);
  });
});
