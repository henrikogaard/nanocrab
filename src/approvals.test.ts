import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-approvals-${Date.now()}`);
const APPROVALS_PATH = path.join(STORE_DIR, 'approvals.json');

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

const {
  createApproval,
  hasApprovedTarget,
  listApprovals,
  reviewApproval,
  revertApprovalToPending,
} = await import('./approvals.js');

function writeApprovals(records: Array<Record<string, unknown>>): void {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(APPROVALS_PATH, `${JSON.stringify(records, null, 2)}\n`);
}

describe('approval store', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('defaults provenance fields when reading old approval records', () => {
    writeApprovals([
      {
        id: 'old-approval',
        kind: 'publish',
        title: 'Publish digest',
        summary: 'Send the prepared digest.',
        risk: 'medium',
        requester: 'operations',
        targetType: 'message',
        targetId: 'msg-1',
        payload: { text: 'ready' },
        status: 'pending',
        createdAt: '2026-06-10T10:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    const [approval] = listApprovals();

    expect(approval).toMatchObject({
      id: 'old-approval',
      source: 'legacy',
      correlationId: null,
      expiresAt: null,
      actionPreview: null,
      resourceSummary: null,
      policyDecisionId: null,
    });
  });

  it('filters approvals by provenance, requester, risk, and created range', () => {
    writeApprovals([
      {
        id: 'matching',
        kind: 'tool-action',
        title: 'Run repo tool',
        summary: 'Run a repo mutation tool.',
        risk: 'high',
        requester: 'main',
        targetType: 'repo',
        targetId: 'nanocrab',
        payload: {},
        status: 'pending',
        source: 'tool',
        correlationId: 'corr-123',
        createdAt: '2026-06-10T12:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
      {
        id: 'wrong-risk',
        kind: 'tool-action',
        title: 'Low risk tool',
        summary: 'Read-only inspection.',
        risk: 'low',
        requester: 'main',
        targetType: 'repo',
        payload: {},
        status: 'pending',
        correlationId: 'corr-123',
        createdAt: '2026-06-10T12:30:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
      {
        id: 'wrong-date',
        kind: 'tool-action',
        title: 'Old tool',
        summary: 'Old repo mutation.',
        risk: 'high',
        requester: 'main',
        targetType: 'repo',
        payload: {},
        status: 'pending',
        correlationId: 'corr-123',
        createdAt: '2026-06-08T12:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    const approvals = listApprovals({
      status: 'pending',
      risk: 'high',
      kind: 'tool-action',
      requester: 'main',
      targetType: 'repo',
      correlationId: 'corr-123',
      createdFrom: '2026-06-10T00:00:00.000Z',
      createdTo: '2026-06-11T00:00:00.000Z',
    });

    expect(approvals.map((approval) => approval.id)).toEqual(['matching']);
  });

  it('prevents approving expired pending approvals and marks them expired', () => {
    writeApprovals([
      {
        id: 'expired-approval',
        kind: 'external-message',
        title: 'Send expired message',
        summary: 'This approval is stale.',
        risk: 'high',
        requester: 'main',
        targetType: 'message',
        targetId: 'msg-expired',
        payload: {},
        status: 'pending',
        expiresAt: '2000-01-01T00:00:00.000Z',
        createdAt: '1999-12-31T23:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    expect(() =>
      reviewApproval('expired-approval', 'approved', 'owner'),
    ).toThrow('Approval is expired');
    expect(listApprovals({ status: 'expired' })[0]).toMatchObject({
      id: 'expired-approval',
      status: 'expired',
      reviewedBy: 'system',
      decisionNote: 'Expired before review',
    });
  });

  it('does not count expired approvals as approved targets', () => {
    const approval = createApproval({
      kind: 'external-message',
      title: 'Send message',
      summary: 'Send a sensitive outbound message.',
      targetType: 'message',
      targetId: 'msg-2',
      expiresAt: '2000-01-01T00:00:00.000Z',
    });

    expect(() => reviewApproval(approval.id, 'approved', 'owner')).toThrow(
      'Approval is expired',
    );
    expect(hasApprovedTarget('external-message', 'message', 'msg-2')).toBe(
      false,
    );
  });

  it('does not reuse approvals after their deadline even when already approved', () => {
    writeApprovals([
      {
        id: 'approved-stale',
        kind: 'external-message',
        title: 'Send approved message',
        summary: 'This approval was reviewed before its deadline.',
        risk: 'medium',
        requester: 'main',
        targetType: 'message',
        targetId: 'msg-stale-approved',
        payload: {},
        status: 'approved',
        expiresAt: '2000-01-01T00:00:00.000Z',
        createdAt: '1999-12-31T22:00:00.000Z',
        reviewedAt: '1999-12-31T23:00:00.000Z',
        reviewedBy: 'owner',
        decisionNote: 'Approved before deadline.',
      },
    ]);

    expect(
      hasApprovedTarget('external-message', 'message', 'msg-stale-approved'),
    ).toBe(false);
  });

  it('marks expired pending approvals during listing so they are not actionable', () => {
    writeApprovals([
      {
        id: 'pending-stale',
        kind: 'upload',
        title: 'Review stale upload',
        summary: 'This pending approval has passed its deadline.',
        risk: 'medium',
        requester: 'uploader',
        targetType: 'upload',
        targetId: 'upload-stale',
        payload: {},
        status: 'pending',
        expiresAt: '2000-01-01T00:00:00.000Z',
        createdAt: '1999-12-31T22:00:00.000Z',
        reviewedAt: null,
        reviewedBy: null,
        decisionNote: null,
      },
    ]);

    expect(listApprovals({ status: 'pending' })).toEqual([]);
    expect(listApprovals({ status: 'expired' })[0]).toMatchObject({
      id: 'pending-stale',
      status: 'expired',
      reviewedBy: 'system',
      decisionNote: 'Expired before review',
    });
  });

  it('reverts an approved approval to pending so a failed downstream action can be retried', () => {
    const approval = createApproval({
      kind: 'coding-close-pr',
      title: 'Close PR owner/repo#1',
      summary: 'Close without merge.',
      targetType: 'github-pr',
      targetId: 'owner/repo#1',
      risk: 'medium',
      requester: 'owner',
    });
    reviewApproval(approval.id, 'approved', 'owner');
    expect(
      hasApprovedTarget('coding-close-pr', 'github-pr', 'owner/repo#1'),
    ).toBe(true);

    const reverted = revertApprovalToPending(
      approval.id,
      'GitHub PR close failed: 500',
    );
    expect(reverted.status).toBe('pending');
    expect(reverted.reviewedAt).toBeNull();
    expect(reverted.reviewedBy).toBeNull();
    expect(
      hasApprovedTarget('coding-close-pr', 'github-pr', 'owner/repo#1'),
    ).toBe(false);
    const pending = listApprovals({
      status: 'pending',
      kind: 'coding-close-pr',
      targetType: 'github-pr',
      targetId: 'owner/repo#1',
    });
    expect(pending.map((a) => a.id)).toContain(approval.id);
  });

  it('refuses to revert a pending approval', () => {
    const approval = createApproval({
      kind: 'coding-close-pr',
      title: 'Close PR owner/repo#2',
      summary: 'Close without merge.',
      targetType: 'github-pr',
      targetId: 'owner/repo#2',
      risk: 'medium',
      requester: 'owner',
    });
    expect(() => revertApprovalToPending(approval.id, 'noop')).toThrow(
      /pending, cannot revert/,
    );
  });
});
