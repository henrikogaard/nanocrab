import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

import { createAgentProfile } from '../agent-profiles.js';
import {
  getCodingJob,
  startCodingJob,
  type CodingJob,
} from '../coding-jobs.js';
import type { AgentRuntimeHealth, AgentRuntimeSelection } from '../types.js';
import { _closeDatabase, _initTestDatabase } from '../db.js';
import { buildStageDispatchKey, insertPipeline } from './pipelines.js';
import { proposeStageTransition } from './decisions.js';
import { runtime } from './dispatcher.js';
import { getDecision, saveProjectItemSnapshot } from './store.js';
import type { StageDispatchCandidate } from './sync.js';
import {
  executeControlPlaneCommand,
  parseControlPlaneCommand,
  resetControlPlaneCommandCache,
  type ControlPlaneCommandResult as _ControlPlaneCommandResult,
} from './commands.js';
import type { GitHubProjectClient } from './github-projects.js';

vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DEFAULT_TRIGGER: '@Andy',
  TRIGGER_PATTERN: /^@Andy\b/i,
  STORE_DIR: '/tmp/nanocrab-cp-commands-test/store',
  CODING_WORKSPACE_DIR: '/tmp/nanocrab-cp-commands-test/data/coding-workspaces',
  DATA_DIR: '/tmp/nanocrab-cp-commands-test/data',
  CONTAINER_IMAGE: 'nanocrab:test',
  CONTAINER_HOST_GATEWAY: 'host.docker.internal',
  CREDENTIAL_PROXY_PORT: 8080,
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
    'claude/claude-opus-4-6': 'claude-opus-4.6',
  },
  DEVIN_CREDENTIAL_PATH: null,
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
  hostGatewayArgs: vi.fn(() => []),
  ensureContainerRuntimeRunning: vi.fn(),
  cleanupOrphans: vi.fn(),
}));

vi.mock('../credential-proxy.js', () => ({
  detectAuthMode: vi.fn(() => 'api-key'),
  CREDENTIAL_PROXY_PORT: 8080,
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

const TEST_ROOT = '/tmp/nanocrab-cp-commands-test';

const now = '2026-07-12T10:00:00.000Z';

function runtimeSelection(
  cli: 'codex' | 'claude',
  provider: 'codex' | 'claude',
  model: string,
): AgentRuntimeSelection {
  return { cli, provider, model };
}

function healthy(cli: 'codex' | 'claude'): AgentRuntimeHealth {
  return {
    status: 'healthy',
    cli,
    executable: cli,
    version: '1.0.0',
    checkedAt: now,
    detail: 'ok',
  };
}

function makeClient(
  initial: { optionId: string; fieldUpdatedAt: string },
  target: { optionId: string; fieldUpdatedAt: string },
): GitHubProjectClient {
  let current = { ...initial };
  return {
    readProjectItem: vi.fn(async () => ({ ...current })),
    updateProjectV2ItemFieldValue: vi.fn(async () => {
      current = { ...target };
    }),
  } as unknown as GitHubProjectClient;
}

describe('control-plane commands', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetControlPlaneCommandCache();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _closeDatabase();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  describe('parseControlPlaneCommand', () => {
    it('parses status commands', () => {
      expect(parseControlPlaneCommand('status #128')).toEqual({
        action: 'status',
        repository: undefined,
        issueNumber: 128,
      });
      expect(
        parseControlPlaneCommand('status henrikogaard/nanocrab#128'),
      ).toEqual({
        action: 'status',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 128,
      });
    });

    it('parses plan and decision queries', () => {
      expect(parseControlPlaneCommand('show plan #128')).toEqual({
        action: 'show_plan',
        repository: undefined,
        issueNumber: 128,
      });
      expect(parseControlPlaneCommand('show decision nanocrab#128')).toEqual({
        action: 'show_decision',
        repository: 'nanocrab',
        issueNumber: 128,
      });
    });

    it('parses approve with optional target stage', () => {
      expect(parseControlPlaneCommand('approve #128')).toEqual({
        action: 'approve',
        repository: undefined,
        issueNumber: 128,
        targetStage: undefined,
      });
      expect(parseControlPlaneCommand('approve #128 to implement')).toEqual({
        action: 'approve',
        repository: undefined,
        issueNumber: 128,
        targetStage: 'implement',
      });
      expect(
        parseControlPlaneCommand('approve henrikogaard/nanocrab#128 to review'),
      ).toEqual({
        action: 'approve',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 128,
        targetStage: 'review',
      });
    });

    it('parses reject and revise with notes', () => {
      expect(parseControlPlaneCommand('reject #128: not ready')).toEqual({
        action: 'reject',
        repository: undefined,
        issueNumber: 128,
        note: 'not ready',
      });
      expect(
        parseControlPlaneCommand('revise #128: add rollback tests'),
      ).toEqual({
        action: 'revise',
        repository: undefined,
        issueNumber: 128,
        note: 'add rollback tests',
      });
    });

    it('parses reassign with stage and agent', () => {
      expect(
        parseControlPlaneCommand('reassign #128 implement to @Forge'),
      ).toEqual({
        action: 'reassign',
        repository: undefined,
        issueNumber: 128,
        stage: 'implement',
        agentHandle: 'forge',
      });
      expect(
        parseControlPlaneCommand('reassign #128 planning to atlas'),
      ).toEqual({
        action: 'reassign',
        repository: undefined,
        issueNumber: 128,
        stage: 'planning',
        agentHandle: 'atlas',
      });
    });

    it('strips configured trigger and leading channel mentions', () => {
      expect(
        parseControlPlaneCommand('@Andy status #128', { trigger: '@Andy' }),
      ).toEqual({
        action: 'status',
        issueNumber: 128,
      });
      expect(
        parseControlPlaneCommand('@NanoCrab status #128', {
          trigger: '@NanoCrab',
        }),
      ).toEqual({
        action: 'status',
        issueNumber: 128,
      });
      expect(
        parseControlPlaneCommand('@NanoCrab approve #128 to implement', {
          trigger: '@NanoCrab',
        }),
      ).toEqual({
        action: 'approve',
        issueNumber: 128,
        targetStage: 'implement',
      });
      expect(
        parseControlPlaneCommand('@Andy @andy_ai_bot status #128', {
          trigger: '@Andy',
        }),
      ).toEqual({
        action: 'status',
        issueNumber: 128,
      });
    });

    it('returns null for non-commands', () => {
      expect(parseControlPlaneCommand('hello')).toBeNull();
      expect(parseControlPlaneCommand('status')).toBeNull();
      expect(parseControlPlaneCommand('@Andy hello')).toBeNull();
    });

    it('returns null for invalid reassign', () => {
      expect(
        parseControlPlaneCommand('reassign #128 plan to @Forge'),
      ).toBeNull();
      expect(parseControlPlaneCommand('reassign #128')).toBeNull();
    });
  });

  describe('executeControlPlaneCommand', () => {
    let agentIds: { planning: string; implement: string; review: string };
    let pipelineId: string;

    function candidate(
      stage: 'planning' | 'implement' | 'review',
      optionId: string,
    ): StageDispatchCandidate {
      return {
        dispatchKey: buildStageDispatchKey({
          pipelineId,
          projectItemId: 'PVTI_1',
          issueNodeId: 'I_1',
          stageId: `stage_${stage}`,
          agentProfileId: agentIds[stage],
          githubFieldUpdatedAt: now,
        }),
        pipelineId,
        stageId: `stage_${stage}`,
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 128,
        agentProfileId: agentIds[stage],
        observedOptionId: optionId,
        observedFieldUpdatedAt: now,
      };
    }

    beforeEach(() => {
      vi.mocked(startCodingJob).mockResolvedValue({
        id: 'job_1',
        repo: 'henrikogaard/nanocrab',
        issueNumber: 128,
        status: 'queued',
        actualRuntime: runtimeSelection('codex', 'codex', 'gpt-5.4'),
      } as unknown as CodingJob);
      vi.mocked(getCodingJob).mockReturnValue(undefined);
      (runtime as any).probe = vi.fn().mockResolvedValue(healthy('codex'));

      const atlas = createAgentProfile({
        handle: 'atlas',
        displayName: 'Atlas',
        personality: 'planning agent',
        primaryRuntime: runtimeSelection(
          'claude',
          'claude',
          'claude-sonnet-4-6',
        ),
        stageRoles: ['planning'],
        repositoryScopes: ['henrikogaard/nanocrab'],
      });
      const forge = createAgentProfile({
        handle: 'forge',
        displayName: 'Forge',
        personality: 'implement agent',
        primaryRuntime: runtimeSelection('codex', 'codex', 'gpt-5.4'),
        stageRoles: ['implement'],
        repositoryScopes: ['henrikogaard/nanocrab'],
      });
      const sentinel = createAgentProfile({
        handle: 'sentinel',
        displayName: 'Sentinel',
        personality: 'review agent',
        primaryRuntime: runtimeSelection(
          'claude',
          'claude',
          'claude-sonnet-4-6',
        ),
        stageRoles: ['review'],
        repositoryScopes: ['henrikogaard/nanocrab'],
      });

      agentIds = {
        planning: atlas.id,
        implement: forge.id,
        review: sentinel.id,
      };

      pipelineId = insertPipeline({
        pipeline: {
          id: 'pipeline_1',
          name: 'Test Pipeline',
          githubOwner: 'henrikogaard',
          githubProjectNumber: 7,
          githubProjectId: 'PVT_1',
          workflowFieldId: 'PVTF_1',
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
            pipelineId: 'pipeline_1',
            stageKind: 'planning',
            githubFieldOptionId: 'option_planning',
            githubFieldOptionName: 'Planning',
            agentProfileId: agentIds.planning,
            requiredEvidence: ['plan'],
            position: 0,
          },
          {
            id: 'stage_implement',
            pipelineId: 'pipeline_1',
            stageKind: 'implement',
            githubFieldOptionId: 'option_implement',
            githubFieldOptionName: 'Implement',
            agentProfileId: agentIds.implement,
            requiredEvidence: ['tests', 'open_pr'],
            position: 1,
          },
          {
            id: 'stage_review',
            pipelineId: 'pipeline_1',
            stageKind: 'review',
            githubFieldOptionId: 'option_review',
            githubFieldOptionName: 'Review',
            agentProfileId: agentIds.review,
            requiredEvidence: ['review'],
            position: 2,
          },
        ],
      }).pipeline.id;
    });

    function saveSnapshot(optionId: string = 'option_planning') {
      saveProjectItemSnapshot({
        pipelineId,
        projectItemId: 'PVTI_1',
        issueNodeId: 'I_1',
        repository: 'henrikogaard/nanocrab',
        issueNumber: 128,
        title: 'Test issue',
        githubFieldOptionId: optionId,
        githubFieldUpdatedAt: now,
        syncedAt: now,
      });
    }

    function createPipeline2() {
      const atlas2 = createAgentProfile({
        handle: 'atlas2',
        displayName: 'Atlas2',
        personality: 'planning agent',
        primaryRuntime: runtimeSelection(
          'claude',
          'claude',
          'claude-sonnet-4-6',
        ),
        stageRoles: ['planning'],
        repositoryScopes: ['otherowner/nanocrab'],
      });
      const forge2 = createAgentProfile({
        handle: 'forge2',
        displayName: 'Forge2',
        personality: 'implement agent',
        primaryRuntime: runtimeSelection('codex', 'codex', 'gpt-5.4'),
        stageRoles: ['implement'],
        repositoryScopes: ['otherowner/nanocrab'],
      });
      const sentinel2 = createAgentProfile({
        handle: 'sentinel2',
        displayName: 'Sentinel2',
        personality: 'review agent',
        primaryRuntime: runtimeSelection(
          'claude',
          'claude',
          'claude-sonnet-4-6',
        ),
        stageRoles: ['review'],
        repositoryScopes: ['otherowner/nanocrab'],
      });
      const pipeline2 = insertPipeline({
        pipeline: {
          id: 'pipeline_2',
          name: 'Other Pipeline',
          githubOwner: 'otherowner',
          githubProjectNumber: 8,
          githubProjectId: 'PVT_2',
          workflowFieldId: 'PVTF_2',
          repositoryScopes: ['otherowner/nanocrab'],
          enabled: true,
          syncCursor: null,
          lastSyncedAt: null,
          createdAt: now,
          updatedAt: now,
        },
        stages: [
          {
            id: 'stage_planning2',
            pipelineId: 'pipeline_2',
            stageKind: 'planning',
            githubFieldOptionId: 'option_planning',
            githubFieldOptionName: 'Planning',
            agentProfileId: atlas2.id,
            requiredEvidence: ['plan'],
            position: 0,
          },
          {
            id: 'stage_implement2',
            pipelineId: 'pipeline_2',
            stageKind: 'implement',
            githubFieldOptionId: 'option_implement',
            githubFieldOptionName: 'Implement',
            agentProfileId: forge2.id,
            requiredEvidence: ['tests', 'open_pr'],
            position: 1,
          },
          {
            id: 'stage_review2',
            pipelineId: 'pipeline_2',
            stageKind: 'review',
            githubFieldOptionId: 'option_review',
            githubFieldOptionName: 'Review',
            agentProfileId: sentinel2.id,
            requiredEvidence: ['review'],
            position: 2,
          },
        ],
      });
      saveProjectItemSnapshot({
        pipelineId: pipeline2.pipeline.id,
        projectItemId: 'PVTI_2',
        issueNodeId: 'I_2',
        repository: 'otherowner/nanocrab',
        issueNumber: 128,
        title: 'Other issue',
        githubFieldOptionId: 'option_planning',
        githubFieldUpdatedAt: now,
        syncedAt: now,
      });
      return pipeline2.pipeline.id;
    }

    it('returns status for an issue with no decisions', async () => {
      saveSnapshot('option_planning');
      const command = parseControlPlaneCommand('status #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('is in planning stage');
      expect(result.text).toContain('Pending decisions: 0');
      expect(result.decisionId).toBeNull();
      expect(result.actions.every((a) => !a.enabled)).toBe(true);
    });

    it('shows a proposed plan', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('show plan #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Plan for henrikogaard/nanocrab#128');
      expect(result.decisionId).toBe(decision.id);
      expect(result.actions.every((a) => a.enabled)).toBe(true);
    });

    it('shows a decision', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('show decision #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain(`Decision ${decision.id}`);
      expect(result.text).toContain('pending');
      expect(result.decisionId).toBe(decision.id);
    });

    it('approves a pending decision to the next stage', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('approve #128 to implement')!;
      const client = makeClient(
        { optionId: 'option_planning', fieldUpdatedAt: now },
        {
          optionId: 'option_implement',
          fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
        },
      );
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
        githubProjectClient: client,
      });
      expect(result.text).toContain(
        'Approved henrikogaard/nanocrab#128 to implement',
      );
      expect(result.text).toContain('dispatched');
      expect(result.decisionId).not.toBeNull();
      const decision = getDecision(result.decisionId!);
      expect(decision?.status).toBe('approved');
      expect(decision?.dispatchStatus).toBe('dispatched');
      expect(startCodingJob).toHaveBeenCalledOnce();
    });

    it('rejects a pending decision', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('reject #128: not ready')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Rejected');
      expect(result.decisionId).toBe(decision.id);
      expect(getDecision(decision.id)?.status).toBe('rejected');
    });

    it('revises a pending decision with feedback', async () => {
      saveSnapshot('option_implement');
      const decision = proposeStageTransition({
        candidate: candidate('implement', 'option_implement'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand(
        'revise #128: add rollback tests',
      )!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Revised');
      expect(result.text).toContain('add rollback tests');
      expect(result.decisionId).toBe(decision.id);
      expect(getDecision(decision.id)?.status).toBe('revised');
    });

    it('reassigns a pending decision to another agent', async () => {
      saveSnapshot('option_implement');
      const decision = proposeStageTransition({
        candidate: candidate('implement', 'option_implement'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand(
        'reassign #128 implement to @Forge',
      )!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain(
        'Reassigned henrikogaard/nanocrab#128 to forge',
      );
      expect(result.decisionId).toBe(decision.id);
      expect(getDecision(decision.id)?.status).toBe('reassigned');
    });

    it('refuses mutations from unauthorized senders', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('approve #128 to implement')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: false,
        actor: 'u1',
      });
      expect(result.text).toContain('Unauthorized');
      expect(result.decisionId).toBeNull();
      expect(result.actions).toHaveLength(0);
    });

    it('detects ambiguous issue numbers across repositories', async () => {
      saveSnapshot('option_planning');
      createPipeline2();
      const command = parseControlPlaneCommand('status #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('multiple repositories');
      expect(result.text).toContain('henrikogaard/nanocrab');
      expect(result.text).toContain('otherowner/nanocrab');
      expect(result.decisionId).toBeNull();
    });

    it('disambiguates by repository', async () => {
      saveSnapshot('option_planning');
      createPipeline2();
      const command = parseControlPlaneCommand(
        'status henrikogaard/nanocrab#128',
      )!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('is in planning stage');
      expect(result.text).toContain('henrikogaard/nanocrab#128');
    });

    it('handles stale decisions', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('approve #128 to implement')!;
      const client = makeClient(
        {
          optionId: 'option_implement',
          fieldUpdatedAt: '2026-07-12T12:00:00.000Z',
        },
        {
          optionId: 'option_implement',
          fieldUpdatedAt: '2026-07-12T12:00:00.000Z',
        },
      );
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
        githubProjectClient: client,
      });
      expect(result.text).toContain('stale');
      expect(result.decisionId).not.toBeNull();
      expect(getDecision(result.decisionId!)?.status).toBe('stale');
    });

    it('is idempotent by message id', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run-1',
      });
      const command = parseControlPlaneCommand('approve #128 to implement')!;
      const client = makeClient(
        { optionId: 'option_planning', fieldUpdatedAt: now },
        {
          optionId: 'option_implement',
          fieldUpdatedAt: '2026-07-12T11:00:00.000Z',
        },
      );
      const context = {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
        messageId: 'msg-1',
        githubProjectClient: client,
      };
      const result1 = await executeControlPlaneCommand(command, context);
      const result2 = await executeControlPlaneCommand(command, context);
      expect(result1).toEqual(result2);
      expect(startCodingJob).toHaveBeenCalledOnce();
      expect(runtime.probe).toHaveBeenCalledOnce();
    });

    it('reports no active run or pending decision for cancel', async () => {
      saveSnapshot('option_planning');
      const command = parseControlPlaneCommand('cancel #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain(
        'No active run or pending decision to cancel',
      );
    });

    it('reports no pending decision for pause', async () => {
      saveSnapshot('option_planning');
      const command = parseControlPlaneCommand('pause #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('No pending decision to pause');
    });

    it('parses follow commands', () => {
      const command = parseControlPlaneCommand('follow #128');
      expect(command).toEqual({ action: 'follow', issueNumber: 128 });
    });

    it('parses pause with note', () => {
      const command = parseControlPlaneCommand('pause #128: need to review');
      expect(command).toEqual({
        action: 'pause',
        issueNumber: 128,
        note: 'need to review',
      });
    });

    it('parses cancel with note', () => {
      const command = parseControlPlaneCommand('cancel #128: wrong direction');
      expect(command).toEqual({
        action: 'cancel',
        issueNumber: 128,
        note: 'wrong direction',
      });
    });

    it('pauses a pending decision via control plane', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run_1',
      });
      const command = parseControlPlaneCommand('pause #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Paused decision');
      expect(result.text).toContain('paused');
      expect(result.decisionId).toBe(decision.id);
      // Verify the decision status was updated
      const updatedDecision = getDecision(decision.id);
      expect(updatedDecision?.status).toBe('paused');
    });

    it('cancels a pending decision via control plane', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run_1',
      });
      const command = parseControlPlaneCommand('cancel #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Cancelled decision');
      expect(result.text).toContain('cancelled');
      expect(result.decisionId).toBe(decision.id);
      // Verify the decision status was updated
      const updatedDecision = getDecision(decision.id);
      expect(updatedDecision?.status).toBe('cancelled');
    });

    it('follows a pending decision via control plane', async () => {
      saveSnapshot('option_planning');
      const decision = proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run_1',
      });
      const command = parseControlPlaneCommand('follow #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      });
      expect(result.text).toContain('Decision');
      expect(result.text).toContain('pending');
      expect(result.decisionId).toBe(decision.id);
    });

    it('refuses to pause a decision without authorization', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run_1',
      });
      const command = parseControlPlaneCommand('pause #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: false,
        actor: 'u1',
      });
      expect(result.text).toContain('Unauthorized');
    });

    it('refuses to cancel a decision without authorization', async () => {
      saveSnapshot('option_planning');
      proposeStageTransition({
        candidate: candidate('planning', 'option_planning'),
        runId: 'run_1',
      });
      const command = parseControlPlaneCommand('cancel #128')!;
      const result = await executeControlPlaneCommand(command, {
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: false,
        actor: 'u1',
      });
      expect(result.text).toContain('Unauthorized');
    });
  });
});
