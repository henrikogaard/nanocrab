import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-policy-${Date.now()}`);

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

const { evaluatePolicy, loadPolicyRules, resetPolicyRules, savePolicyRules } =
  await import('./policy-engine.js');

describe('policy engine', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    resetPolicyRules();
  });

  it('requires approval for risky write actions from stored policy rules', () => {
    savePolicyRules([
      {
        id: 'repo-writes',
        actionPattern: 'coding.*',
        risk: 'high',
        requireApproval: true,
        allowDryRun: true,
        explanation: 'Coding jobs can write repository state.',
      },
    ]);

    const decision = evaluatePolicy({
      actor: 'autofix',
      actionType: 'coding.open_pr',
      resource: 'owner/repo',
      context: { branch: 'nanocrab/task' },
    });

    expect(decision).toMatchObject({
      actionType: 'coding.open_pr',
      risk: 'high',
      decision: 'requires_approval',
      approvalRequired: true,
      dryRunAllowed: true,
      matchedRuleIds: ['repo-writes'],
    });
    expect(loadPolicyRules()).toHaveLength(1);
  });

  it('allows dry-run simulation for risky actions without approving external writes', () => {
    savePolicyRules([
      {
        id: 'external-sends',
        actionPattern: 'channel.send',
        risk: 'high',
        requireApproval: true,
        allowDryRun: true,
        explanation: 'Outbound messages leave NanoCrab.',
      },
    ]);

    const decision = evaluatePolicy({
      actor: 'automation',
      actionType: 'channel.send',
      resource: 'tg:ops',
      dryRun: true,
      context: { text: 'preview only' },
    });

    expect(decision.decision).toBe('simulated');
    expect(decision.approvalRequired).toBe(false);
    expect(decision.risk).toBe('high');
  });

  it('sanitizes decision explanations and context-derived secrets', () => {
    savePolicyRules([
      {
        id: 'deny-secret-upload',
        actionPattern: 'upload.*',
        risk: 'high',
        deny: true,
        explanation: 'Denied with token sk-test-secret and password hunter2',
      },
    ]);

    const decision = evaluatePolicy({
      actor: 'uploader',
      actionType: 'upload.process',
      resource: 'archive.zip',
      context: { cookie: 'session=secret', api_key: 'abc123' },
    });

    expect(decision.decision).toBe('denied');
    expect(decision.explanation).not.toContain('sk-test-secret');
    expect(decision.explanation).not.toContain('hunter2');
    expect(JSON.stringify(decision.context)).not.toContain('session=secret');
    expect(JSON.stringify(decision.context)).not.toContain('abc123');
  });
});
