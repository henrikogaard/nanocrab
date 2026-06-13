import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-policy-${Date.now()}`);

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

const { _closeDatabase, _initTestDatabase } = await import('./db.js');
const { listAuditEvents } = await import('./audit-log.js');
const { auditUploadSend } = await import('./upload-audit.js');
const { evaluatePolicy, loadPolicyRules, resetPolicyRules, savePolicyRules } =
  await import('./policy-engine.js');

describe('policy engine', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    resetPolicyRules();
    try {
      _closeDatabase();
    } catch {
      /* database may not be initialized */
    }
    _initTestDatabase();
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

  it('audits allowed upload sends with redacted context', async () => {
    const send = vi.fn(async () => 'sent');

    await expect(
      auditUploadSend(
        {
          channel: 'telegram',
          jid: 'tg:123',
          filename: 'report.pdf',
          filePath: '/tmp/report.pdf',
          sizeBytes: 42,
          context: { authorization: 'Bearer secret-token' },
        },
        send,
      ),
    ).resolves.toBe('sent');

    expect(send).toHaveBeenCalledTimes(1);
    const events = listAuditEvents({ actionType: 'upload.send' });
    expect(events.some((event) => event.decision === 'allowed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('secret-token');
  });

  it('blocks and audits denied upload sends before external transfer', async () => {
    savePolicyRules([
      {
        id: 'deny-uploads',
        actionPattern: 'upload.send',
        risk: 'high',
        deny: true,
        explanation: 'Do not send files from this channel.',
      },
    ]);
    const send = vi.fn(async () => 'sent');

    await expect(
      auditUploadSend(
        {
          channel: 'signal',
          jid: 'sig:ops',
          filename: 'secret.zip',
          filePath: '/tmp/secret.zip',
          sizeBytes: 1024,
        },
        send,
      ),
    ).rejects.toThrow('Upload blocked by policy');

    expect(send).not.toHaveBeenCalled();
    expect(listAuditEvents({ actionType: 'upload.send' })[0]).toMatchObject({
      decision: 'denied',
      resource: 'signal/sig:ops/secret.zip',
    });
  });
});
