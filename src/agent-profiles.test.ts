import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildAgentProfile,
  buildSubscriptionDedupeKey,
  createAgentProfile,
  createAgentSubscription,
  getAgentProfile,
  getAgentProfileByHandle,
  listAgentProfileActivity,
  listAgentProfiles,
  recordAgentProfileActivity,
  recordAgentSubscriptionEvent,
  normalizeAgentHandle,
  validateAgentProfileInput,
  validateSubscriptionShape,
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

  it('ignores non-string items when sanitizing JSON-facing lists', () => {
    const profile = buildAgentProfile({
      handle: 'ManualHost',
      displayName: 'Manual Host',
      allowedMcpServers: [
        'github',
        null,
        ' ',
        42,
        'filesystem',
      ] as unknown as string[],
      skills: ['repo-work', false, ' report-writing '] as unknown as string[],
      channelBindings: {
        github: ['@ManualHost', 123, ' '] as unknown as string[],
      },
    });

    expect(profile.allowedMcpServers).toEqual(['github', 'filesystem']);
    expect(profile.skills).toEqual(['repo-work', 'report-writing']);
    expect(profile.channelBindings).toEqual({ github: ['@ManualHost'] });
  });

  it('builds stable subscription dedupe keys', () => {
    expect(
      buildSubscriptionDedupeKey({
        sourceType: 'github',
        sourceId: 'henrikogaard/nanocrab',
        externalEventId: 'issue-123',
        agentProfileId: 'agent_repo_fixer',
      }),
    ).toBe('github:henrikogaard/nanocrab:issue-123:agent_repo_fixer');
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
      dedupeKey: 'github:henrikogaard/nanocrab:issue-1:' + profile.id,
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
});
