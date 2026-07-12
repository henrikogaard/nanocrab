import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentProfileTaskKind } from './types.js';
import {
  buildAgentProfile,
  buildSubscriptionDedupeKey,
  createAgentProfile,
  createAgentSubscription,
  getAgentProfile,
  getAgentProfileByHandle,
  listAgentProfileActivity,
  listAgentProfiles,
  listAgentSubscriptions,
  recordAgentProfileActivity,
  recordAgentSubscriptionEvent,
  normalizeAgentHandle,
  updateAgentProfile,
  validateAgentProfileInput,
  validateSubscriptionShape,
  validateRuntimeSelection,
} from './agent-profiles.js';
import { _closeDatabase, _initTestDatabase } from './db.js';

describe('agent profile validation', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
  });

  it('normalizes handles to case-insensitive mention ids', () => {
    expect(normalizeAgentHandle('@Repo-Fixer')).toBe('repo-fixer');
    expect(normalizeAgentHandle(' ManualHost ')).toBe('manualhost');
  });

  it('rejects invalid handles before persistence', () => {
    expect(() =>
      validateAgentProfileInput({
        handle: 'bad handle',
        displayName: 'Bad Handle',
      }),
    ).toThrow(/handle/i);
  });

  it('builds enabled profiles with conservative write policy defaults', () => {
    const profile = buildAgentProfile({
      handle: 'ManualHost',
      displayName: 'Manual Host',
    });

    expect(profile.handle).toBe('manualhost');
    expect(profile.enabled).toBe(true);
    expect(profile.toolPolicy).toBe('approval-required');
    expect(profile.writePolicy).toEqual({
      directSendRequiresApproval: false,
      autonomousSendRequiresApproval: true,
    });
  });

  it('sanitizes JSON-facing string lists and channel bindings', () => {
    const profile = buildAgentProfile({
      handle: 'ManualHost',
      displayName: 'Manual Host',
      allowedMcpServers: ['github', ' ', 'filesystem'],
      skills: ['repo-work', ' report-writing '],
      channelBindings: {
        github: ['@ManualHost', 123, ' '] as unknown as string[],
      },
    });

    expect(profile.allowedMcpServers).toEqual(['github', 'filesystem']);
    expect(profile.skills).toEqual(['repo-work', 'report-writing']);
    expect(profile.channelBindings).toEqual({ github: ['@ManualHost'] });
  });

  it('rejects non-string capability list items', () => {
    expect(() =>
      buildAgentProfile({
        handle: 'ManualHost',
        displayName: 'Manual Host',
        allowedMcpServers: ['github', 42] as unknown as string[],
      }),
    ).toThrow(/allowedMcpServers/i);

    expect(() =>
      buildAgentProfile({
        handle: 'RepoFixer',
        displayName: 'Repo Fixer',
        skills: ['repo-work', false] as unknown as string[],
      }),
    ).toThrow(/skills/i);
  });

  it('builds stable subscription dedupe keys', () => {
    expect(
      buildSubscriptionDedupeKey({
        sourceType: 'github',
        sourceId: 'henrikogaard/nanocrab',
        externalEventId: 'issue-123',
        agentProfileId: 'agent_repo_fixer',
      }),
    ).toBe('["github","henrikogaard/nanocrab","issue-123","agent_repo_fixer"]');
  });

  it('builds unambiguous subscription dedupe keys for colon-containing ids', () => {
    const first = buildSubscriptionDedupeKey({
      sourceType: 'github',
      sourceId: 'repo:issue',
      externalEventId: '123',
      agentProfileId: 'agent_repo_fixer',
    });
    const second = buildSubscriptionDedupeKey({
      sourceType: 'github',
      sourceId: 'repo',
      externalEventId: 'issue:123',
      agentProfileId: 'agent_repo_fixer',
    });

    expect(first).not.toBe(second);
    expect(JSON.parse(first)).toEqual([
      'github',
      'repo:issue',
      '123',
      'agent_repo_fixer',
    ]);
  });

  it('rejects bad subscription source, task, and autonomy inputs', () => {
    expect(() =>
      validateSubscriptionShape({
        sourceType: 'rss' as never,
        taskKind: 'coding_job',
        autonomyMode: 'investigate_then_pause',
      }),
    ).toThrow(/sourceType/i);
    expect(() =>
      validateSubscriptionShape({
        sourceType: 'github',
        taskKind: 'deploy_now' as never,
        autonomyMode: 'investigate_then_pause',
      }),
    ).toThrow(/taskKind/i);
    expect(() =>
      validateSubscriptionShape({
        sourceType: 'github',
        taskKind: 'coding_job',
        autonomyMode: 'fully_autonomous' as never,
      }),
    ).toThrow(/autonomyMode/i);
  });
});

describe('agent profile persistence', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
  });

  it('stores profiles and enforces unique normalized handles', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });

    expect(getAgentProfile(profile.id)?.handle).toBe('repofixer');
    expect(getAgentProfileByHandle('@REPOFIXER')?.id).toBe(profile.id);
    expect(listAgentProfiles()).toHaveLength(1);
    expect(() =>
      createAgentProfile({ handle: 'repofixer', displayName: 'Duplicate' }),
    ).toThrow(/already exists/i);
  });

  it('updates profiles through editable patches while preserving immutable fields', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
      description: 'Original description',
      allowedMcpServers: ['github'],
      writePolicy: { autonomousSendRequiresApproval: false },
    });
    createAgentProfile({
      handle: 'OtherAgent',
      displayName: 'Other Agent',
    });

    const updatedAt = new Date(
      Date.parse(profile.createdAt) + 1000,
    ).toISOString();
    const updated = updateAgentProfile(
      profile.id,
      {
        handle: '@ManualHost',
        displayName: ' Manual Host ',
        avatar: ' https://example.test/avatar.png ',
        description: ' ',
        personality: ' Precise and terse ',
        enabled: false,
        providerProfileId: ' provider-main ',
        model: ' gpt-5 ',
        allowedMcpServers: ['filesystem', ' github '],
        skills: [' repo-work '],
        taskKinds: ['coding_job'],
        channelBindings: {
          github: ['@ManualHost', 123] as unknown as string[],
        },
        writePolicy: { directSendRequiresApproval: true },
      },
      () => updatedAt,
    );

    expect(updated.id).toBe(profile.id);
    expect(updated.createdAt).toBe(profile.createdAt);
    expect(updated.updatedAt).toBe(updatedAt);
    expect(updated.updatedAt >= profile.createdAt).toBe(true);
    expect(updated.handle).toBe('manualhost');
    expect(updated.displayName).toBe('Manual Host');
    expect(updated.avatar).toBe('https://example.test/avatar.png');
    expect(updated.description).toBeNull();
    expect(updated.personality).toBe('Precise and terse');
    expect(updated.enabled).toBe(false);
    expect(updated.providerProfileId).toBe('provider-main');
    expect(updated.model).toBe('gpt-5');
    expect(updated.allowedMcpServers).toEqual(['filesystem', 'github']);
    expect(updated.skills).toEqual(['repo-work']);
    expect(updated.taskKinds).toEqual(['coding_job']);
    expect(updated.channelBindings).toEqual({ github: ['@ManualHost'] });
    expect(updated.writePolicy).toEqual({
      directSendRequiresApproval: true,
      autonomousSendRequiresApproval: false,
    });
    expect(() =>
      updateAgentProfile(profile.id, { handle: 'OtherAgent' }),
    ).toThrow(/already exists/i);
    expect(() =>
      updateAgentProfile(profile.id, {
        taskKinds: [
          'coding_job',
          'deploy_now',
        ] as unknown as AgentProfileTaskKind[],
      }),
    ).toThrow(/taskKind/i);
  });

  it('stores subscriptions and activity for a profile', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      enabled: true,
      filters: { repo: 'henrikogaard/nanocrab', labels: ['autofix'] },
      taskKind: 'coding_job',
      autonomyMode: 'investigate_then_pause',
    });
    const event = recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey: buildSubscriptionDedupeKey({
        sourceType: 'github',
        sourceId: 'henrikogaard/nanocrab',
        externalEventId: 'issue-1',
        agentProfileId: profile.id,
      }),
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      externalEventId: 'issue-1',
      runId: 'code-1',
      status: 'matched',
      metadata: { issueNumber: 1 },
    });
    recordAgentProfileActivity({
      agentProfileId: profile.id,
      subscriptionId: subscription.id,
      kind: 'subscription_match',
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      summary: 'Matched #1',
      runId: 'code-1',
      approvalId: null,
      metadata: { eventId: event.id },
    });

    expect(listAgentProfileActivity(profile.id)).toHaveLength(1);
  });

  it('round-trips subscription filter JSON', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });

    createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: {
        repo: 'henrikogaard/nanocrab',
        labels: ['autofix', 'agent-profile'],
        pullRequests: { includeDrafts: false },
      },
      taskKind: 'coding_job',
    });

    expect(listAgentSubscriptions(profile.id)[0]?.filters).toEqual({
      repo: 'henrikogaard/nanocrab',
      labels: ['autofix', 'agent-profile'],
      pullRequests: { includeDrafts: false },
    });
  });

  it('rejects subscriptions for missing parent profiles', () => {
    expect(() =>
      createAgentSubscription({
        agentProfileId: 'agent_missing',
        sourceType: 'github',
        filters: { repo: 'henrikogaard/nanocrab' },
        taskKind: 'coding_job',
      }),
    ).toThrow(/agent profile not found/i);
  });

  it('rejects arbitrary CLI executable paths in runtime selection', () => {
    expect(() =>
      validateRuntimeSelection({
        cli: '/tmp/run-anything' as never,
        provider: 'codex',
        model: 'gpt-5.4',
      }),
    ).toThrow(/CLI is not supported/i);
  });

  it('preserves an ordered fallback chain', () => {
    const profile = buildAgentProfile({
      handle: 'forge',
      displayName: 'Forge',
      instructions: 'Implement only an approved plan.',
      primaryRuntime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
      fallbackRuntimes: [
        { cli: 'claude', provider: 'claude', model: 'claude-sonnet-4-6' },
      ],
      stageRoles: ['implement'],
      repositoryScopes: ['henrikogaard/nanocrab'],
      maxConcurrency: 1,
    });
    expect(profile.fallbackRuntimes.map((runtime) => runtime.cli)).toEqual([
      'claude',
    ]);
  });

  it('records subscription events idempotently by dedupe key', () => {
    const profile = createAgentProfile({
      handle: 'RepoFixer',
      displayName: 'Repo Fixer',
    });
    const subscription = createAgentSubscription({
      agentProfileId: profile.id,
      sourceType: 'github',
      filters: { repo: 'henrikogaard/nanocrab' },
      taskKind: 'coding_job',
    });
    const dedupeKey = buildSubscriptionDedupeKey({
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      externalEventId: 'issue-1',
      agentProfileId: profile.id,
    });

    const first = recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey,
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      externalEventId: 'issue-1',
      runId: 'code-1',
      status: 'matched',
      metadata: { issueNumber: 1 },
    });
    const second = recordAgentSubscriptionEvent({
      subscriptionId: subscription.id,
      agentProfileId: profile.id,
      dedupeKey,
      sourceType: 'github',
      sourceId: 'henrikogaard/nanocrab',
      externalEventId: 'issue-1',
      runId: 'code-2',
      status: 'ignored',
      metadata: { issueNumber: 2 },
    });

    expect(second).toEqual(first);
  });
});
