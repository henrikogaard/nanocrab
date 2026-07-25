import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-cp-dispatcher-test/store',
  CODING_WORKSPACE_DIR:
    '/tmp/nanocrab-cp-dispatcher-test/data/coding-workspaces',
  CONTAINER_IMAGE: 'nanocrab-agent:test',
  CREDENTIAL_PROXY_PORT: 3001,
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
  },
  DEVIN_CREDENTIAL_PATH: null,
  DATA_DIR: '/tmp/nanocrab-cp-dispatcher-test/data',
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
  agentNetworkArgs: vi.fn(() => []),
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
  dispatchCandidate,
  requestRuntimeFallback,
  runtime,
  type DispatchCandidateResult as _DispatchCandidateResult,
} from './dispatcher.js';
import type { StageDispatchCandidate } from './sync.js';
import type { AgentRuntimeSelection } from '../types.js';

const TEST_ROOT = '/tmp/nanocrab-cp-dispatcher-test';
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

describe('control plane dispatcher', () => {
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

  it('dispatches a stage with a healthy primary runtime', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({
      status: 'healthy',
      cli: 'claude',
      executable: 'claude',
      version: '1.0.0',
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);

    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });
    const result = await dispatchCandidate(candidate('planning'));

    expect(result.status).toBe('dispatched');
    expect(result.job).toBeDefined();
    expect(result.job?.pipelineId).toBe('pipeline_1');
    expect(result.job?.stageId).toBe('stage_planning');
    expect(result.job?.actualRuntime).toEqual(
      runtimeSelection('claude', 'claude', 'claude-sonnet-4-6'),
    );
  });

  it('blocks write-capable fallback until approved', async () => {
    const probe = vi.mocked(runtime.probe);
    probe.mockResolvedValueOnce({
      status: 'missing',
      cli: 'codex',
      executable: 'codex',
      version: null,
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);
    probe.mockResolvedValueOnce({
      status: 'healthy',
      cli: 'opencode',
      executable: 'opencode',
      version: '1.0.0',
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);

    await registerCodingRepo({ repo: 'henrikogaard/nanocrab' });
    const result = await dispatchCandidate(candidate('implement'));

    expect(result.status).toBe('awaiting_fallback_approval');
    expect(result.decision).toBeDefined();
    expect(result.decision?.kind).toBe('runtime_fallback');
    expect(result.decision?.proposedRuntime).toEqual(
      runtimeSelection('opencode', 'opencode', 'opencode/grok-code-fast-1'),
    );
  });

  it('records a fallback decision for the first configured alternative', async () => {
    const probe = vi.mocked(runtime.probe);
    probe.mockResolvedValueOnce({
      status: 'missing',
      cli: 'codex',
      executable: 'codex',
      version: null,
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);
    probe.mockResolvedValueOnce({
      status: 'healthy',
      cli: 'opencode',
      executable: 'opencode',
      version: '1.0.0',
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);

    const result = await dispatchCandidate(candidate('implement'));

    expect(result.status).toBe('awaiting_fallback_approval');
    expect(result.decision).toBeDefined();
    expect(result.decision?.status).toBe('pending');
    expect(result.decision?.proposedRuntime?.cli).toBe('opencode');
  });

  it('returns an error when no runtime is available', async () => {
    vi.mocked(runtime.probe).mockResolvedValue({
      status: 'missing',
      cli: 'codex',
      executable: 'codex',
      version: null,
      checkedAt: now,
      detail: 'ok',
    } as import('../types.js').AgentRuntimeHealth);

    const result = await dispatchCandidate(candidate('planning'));

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no healthy fallback is available/);
  });

  it('requestRuntimeFallback creates a pending fallback decision', () => {
    const fallback = runtimeSelection('opencode', 'opencode', 'opencode/auto');
    const decision = requestRuntimeFallback(candidate('implement'), fallback, {
      reason: 'primary missing',
    });

    expect(decision.kind).toBe('runtime_fallback');
    expect(decision.status).toBe('pending');
    expect(decision.proposedRuntime).toEqual(fallback);
    expect(decision.approvalId).toBeTruthy();
  });
});
