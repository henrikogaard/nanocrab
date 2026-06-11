import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-report-jobs-test';

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/nanocrab-report-jobs-test/data',
  GROUPS_DIR: '/tmp/nanocrab-report-jobs-test/groups',
  STORE_DIR: '/tmp/nanocrab-report-jobs-test/store',
}));

import { createApproval, listApprovals, reviewApproval } from './approvals.js';
import { _closeDatabase, _initTestDatabase } from './db.js';
import {
  approveReportDelivery,
  approveReportOutline,
  createReportJob,
} from './report-jobs.js';

describe('report jobs', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    _closeDatabase();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('requires outline approval before exporting report artifacts', async () => {
    const job = createReportJob({
      title: 'Approval-gated report',
      request: 'Summarize approved context.',
      outputFormats: ['markdown'],
      deliverablesDir: path.join(TEST_ROOT, 'deliverables'),
      requireOutlineApproval: true,
      requireDeliveryApproval: true,
    });

    await expect(approveReportOutline(job.id)).rejects.toThrow(
      'Report outline approval required',
    );
    expect(
      listApprovals({ kind: 'report-outline', targetId: job.id }),
    ).toHaveLength(1);
  });

  it('exports artifacts after outline approval and gates delivery', async () => {
    const job = createReportJob({
      title: 'Exported report',
      request: 'Summarize approved context.',
      outputFormats: ['markdown'],
      deliverablesDir: path.join(TEST_ROOT, 'deliverables'),
      requireOutlineApproval: true,
      requireDeliveryApproval: true,
    });
    const approval = createApproval({
      kind: 'report-outline',
      title: 'Approve outline',
      summary: job.outline,
      targetType: 'report-job',
      targetId: job.id,
      payload: { jobId: job.id },
    });
    reviewApproval(approval.id, 'approved', 'vitest');

    const exported = await approveReportOutline(job.id);

    expect(exported.status).toBe('awaiting_delivery_approval');
    expect(exported.artifacts[0]?.format).toBe('markdown');
    expect(fs.existsSync(exported.artifacts[0]?.path || '')).toBe(true);

    expect(() => approveReportDelivery(job.id)).toThrow(
      'Report delivery approval required',
    );
    expect(
      listApprovals({ kind: 'report-delivery', targetId: job.id }),
    ).toHaveLength(1);
  });
});
