import { describe, expect, it } from 'vitest';

import {
  buildAgentProfile,
  buildSubscriptionDedupeKey,
  normalizeAgentHandle,
  validateAgentProfileInput,
} from './agent-profiles.js';

describe('agent profile validation', () => {
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
});
