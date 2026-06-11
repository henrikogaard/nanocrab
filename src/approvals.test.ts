import fs from 'fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-approvals-test/store',
}));

import { createApproval, listApprovals, reviewApproval } from './approvals.js';

const TEST_ROOT = '/tmp/nanocrab-approvals-test';

describe('approvals', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns an existing pending target approval instead of creating a duplicate', () => {
    const first = createApproval({
      kind: 'provider-fallback',
      title: 'Approve fallback',
      summary: 'Allow fallback.',
      targetType: 'provider-profile',
      targetId: 'default_coding',
      payload: { targetProfileId: 'default_chat' },
    });
    const second = createApproval({
      kind: 'provider-fallback',
      title: 'Approve fallback again',
      summary: 'Allow fallback again.',
      targetType: 'provider-profile',
      targetId: 'default_coding',
      payload: { targetProfileId: 'default_chat' },
    });

    expect(second.id).toBe(first.id);
    expect(listApprovals()).toHaveLength(1);
  });

  it('filters approvals by status and kind', () => {
    const fallback = createApproval({
      kind: 'provider-fallback',
      title: 'Approve fallback',
      summary: 'Allow fallback.',
    });
    createApproval({
      kind: 'coding-open-pr',
      title: 'Open PR',
      summary: 'Open a PR.',
    });

    reviewApproval(fallback.id, 'approved', 'tester');

    expect(
      listApprovals({ status: 'approved', kind: 'provider-fallback' }).map(
        (approval) => approval.id,
      ),
    ).toEqual([fallback.id]);
    expect(listApprovals({ status: 'pending' })).toHaveLength(1);
  });
});
