import { describe, expect, it } from 'vitest';

import { evaluateActionPolicy } from './action-policy.js';

describe('action policy', () => {
  it('allows read-only work when the tool policy permits reads', () => {
    const decision = evaluateActionPolicy({
      action: 'read',
      toolPolicy: 'read-only',
      targetType: 'provider-profile',
      targetId: 'default_chat',
    });

    expect(decision).toMatchObject({
      decision: 'allow',
      risk: 'low',
      reason: 'Read-only action is allowed by policy',
    });
  });

  it('requires approval for write-capable work without an approval', () => {
    const decision = evaluateActionPolicy({
      action: 'provider-fallback',
      toolPolicy: 'approval-required',
      targetType: 'provider-profile',
      targetId: 'default_coding',
    });

    expect(decision).toMatchObject({
      decision: 'approval-required',
      risk: 'high',
      approvalKind: 'provider-fallback',
      targetType: 'provider-profile',
      targetId: 'default_coding',
    });
  });

  it('denies actions when the tool policy is deny', () => {
    const decision = evaluateActionPolicy({
      action: 'write',
      toolPolicy: 'deny',
      targetType: 'coding-job',
      targetId: 'code-1',
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      reason: 'Tool policy denies this action',
    });
  });

  it('allows write-capable work when a matching approval exists', () => {
    const decision = evaluateActionPolicy({
      action: 'provider-fallback',
      toolPolicy: 'approval-required',
      approved: true,
      targetType: 'provider-profile',
      targetId: 'default_coding',
    });

    expect(decision).toMatchObject({
      decision: 'allow',
      reason: 'Action has an approved policy decision',
    });
  });

  it('reports risky work as approval-required in dry-run mode without allowing it', () => {
    const decision = evaluateActionPolicy({
      action: 'coding-implement',
      toolPolicy: 'allow',
      dryRun: true,
      targetType: 'coding-job',
      targetId: 'code-1',
    });

    expect(decision).toMatchObject({
      decision: 'approval-required',
      dryRun: true,
      reason: 'Dry-run mode: action would require explicit approval',
      approvalKind: 'coding-implement',
    });
  });
});
