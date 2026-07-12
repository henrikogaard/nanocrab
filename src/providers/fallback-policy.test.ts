import { afterEach, beforeEach, describe, expect, it, vi as _vi } from 'vitest';

import { FallbackPolicyManager, isFallbackAction } from './fallback-policy.js';
import type { FallbackAction as _FallbackAction, FallbackDecision as _FallbackDecision } from './fallback-policy.js';

function _makePolicy(
  _overrides?: Partial<ReturnType<FallbackPolicyManager['evaluateFallback']>>,
) {
  const manager = new FallbackPolicyManager();
  return { manager };
}

const readSource = {
  providerId: 'claude',
  model: 'claude-sonnet-4-20250514',
  toolPolicy: 'read-only',
};

const writeSource = {
  providerId: 'claude',
  model: 'claude-sonnet-4-20250514',
  toolPolicy: 'approval-required',
};

const target = {
  providerId: 'codex',
  model: 'gpt-5.4',
};

const fullCapabilities = {
  toolCalls: true,
  structuredOutput: true,
  codeStrength: 'high',
};

const basicCapabilities = {
  toolCalls: false,
  structuredOutput: false,
  codeStrength: 'low',
};

describe('FallbackPolicyManager', () => {
  let manager: FallbackPolicyManager;

  beforeEach(() => {
    manager = new FallbackPolicyManager();
  });

  afterEach(() => {
    manager.clearApprovalCache();
  });

  describe('evaluateFallback', () => {
    describe('read actions', () => {
      it('returns allowed=false, requiresApproval=false when no fallback configured', () => {
        const result = manager.evaluateFallback(
          'read',
          readSource,
          target,
          fullCapabilities,
          false,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain('no fallback provider configured');
      });

      it('returns allowed=true when fallback configured and toolPolicy is not deny', () => {
        const result = manager.evaluateFallback(
          'read',
          readSource,
          target,
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain('read fallback');
      });

      it('requires approval when read fallback crosses local/private to hosted boundary', () => {
        const result = manager.evaluateFallback(
          'read',
          { ...readSource, providerId: 'ollama', privacyTier: 'local' },
          { ...target, providerId: 'openrouter', privacyTier: 'third-party' },
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('local/private');
      });

      it('returns allowed=false when toolPolicy is deny', () => {
        const result = manager.evaluateFallback(
          'read',
          { ...readSource, toolPolicy: 'deny' },
          target,
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain("tool policy 'deny'");
      });

      it('returns allowed=false when target lacks basic capabilities', () => {
        const result = manager.evaluateFallback(
          'read',
          readSource,
          target,
          basicCapabilities,
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain('lacks sufficient capabilities');
      });
    });

    describe('write actions', () => {
      it('requires approval when fallback configured', () => {
        const result = manager.evaluateFallback(
          'write',
          writeSource,
          target,
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.reason).toContain('requires approval');
      });

      it('requires approval with strict tool policy', () => {
        const result = manager.evaluateFallback(
          'write',
          { ...writeSource, toolPolicy: 'allow' },
          target,
          fullCapabilities,
          true,
        );

        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('dangerous actions', () => {
      const dangerous: FallbackAction[] = [
        'publish',
        'external-message',
        'upload',
        'shell',
        'pr',
        'coding-implementation',
        'pr-creation',
        'automation-execution',
        'skill-installation',
      ];

      for (const action of dangerous) {
        it(`'${action}' always requires approval`, () => {
          const result = manager.evaluateFallback(
            action,
            writeSource,
            target,
            fullCapabilities,
            true,
          );

          expect(result.allowed).toBe(false);
          expect(result.requiresApproval).toBe(true);
          expect(result.reason).toContain('requires approval');
        });
      }
    });

    describe('capability checks', () => {
      it('blocks write action when target lacks tool calls', () => {
        const result = manager.evaluateFallback(
          'write',
          writeSource,
          target,
          { toolCalls: false, structuredOutput: false, codeStrength: 'high' },
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('lacks tool call support');
      });

      it('blocks write action when code strength is none', () => {
        const result = manager.evaluateFallback(
          'write',
          writeSource,
          target,
          { toolCalls: true, structuredOutput: true, codeStrength: 'none' },
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('code strength');
      });

      it('blocks write action when code strength is low', () => {
        const result = manager.evaluateFallback(
          'write',
          writeSource,
          target,
          { toolCalls: true, structuredOutput: true, codeStrength: 'low' },
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('code strength');
      });
    });

    describe('unknown action', () => {
      it('returns denied for unrecognized action', () => {
        const result = manager.evaluateFallback(
          'unknown-action' as FallbackAction,
          readSource,
          target,
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toContain('unknown action');
      });
    });

    describe('missing capabilities', () => {
      it('handles empty tool policy gracefully', () => {
        const result = manager.evaluateFallback(
          'read',
          { ...readSource, toolPolicy: '' },
          target,
          fullCapabilities,
          true,
        );

        expect(result.allowed).toBe(true);
      });

      it('handles undefined capabilities fields', () => {
        const result = manager.evaluateFallback(
          'write',
          writeSource,
          target,
          { toolCalls: false, structuredOutput: false, codeStrength: '' },
          true,
        );

        expect(result.allowed).toBe(false);
      });
    });

    it('requires approval when fallback moves local or private work to a hosted provider', () => {
      const result = manager.evaluateFallback(
        'provider-fallback',
        {
          ...writeSource,
          privacyTier: 'local',
        },
        {
          ...target,
          privacyTier: 'third-party',
        },
        fullCapabilities,
        true,
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('local/private');
    });
  });

  describe('approveFallback', () => {
    it('caches approval and prevents re-asking', () => {
      manager.approveFallback('claude', 'codex', 'write');

      const result = manager.evaluateFallback(
        'write',
        writeSource,
        target,
        fullCapabilities,
        true,
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain('cached');
    });

    it('cached approval is action-specific', () => {
      manager.approveFallback('claude', 'codex', 'read');

      const writeResult = manager.evaluateFallback(
        'write',
        writeSource,
        target,
        fullCapabilities,
        true,
      );

      expect(writeResult.allowed).toBe(false);
      expect(writeResult.requiresApproval).toBe(true);
    });

    it('cached approval is provider-specific', () => {
      manager.approveFallback('claude', 'codex', 'write');

      const differentTarget = { providerId: 'ollama', model: 'llama3' };
      const result = manager.evaluateFallback(
        'write',
        writeSource,
        differentTarget,
        fullCapabilities,
        true,
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe('clearApprovalCache', () => {
    it('resets all cached approvals', () => {
      manager.approveFallback('claude', 'codex', 'write');
      manager.clearApprovalCache();

      const result = manager.evaluateFallback(
        'write',
        writeSource,
        target,
        fullCapabilities,
        true,
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });
  });
});

describe('isFallbackAction', () => {
  it('accepts known fallback actions and rejects arbitrary route input', () => {
    expect(isFallbackAction('pr-creation')).toBe(true);
    expect(isFallbackAction('external-message')).toBe(true);
    expect(isFallbackAction('delete-everything')).toBe(false);
    expect(isFallbackAction(null)).toBe(false);
  });
});
