import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-report-jobs-${Date.now()}`);

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

vi.mock('./journal-store.js', () => ({
  findJournalEvents: () => [],
  listJournalEntryRecords: () => [],
}));

vi.mock('./memory-store.js', () => ({
  listMemoryRecords: () => [],
}));

const {
  approveReportDelivery,
  approveReportOutline,
  createReportJob,
  getReportJob,
} = await import('./report-jobs.js');
const { createDesignSystem } = await import('./design-systems.js');
const { listApprovals, reviewApproval } = await import('./approvals.js');
const { getSourceCollection, getSourceLedger } =
  await import('./source-collection.js');

function approvalFor(kind: string, targetId: string) {
  const approval = listApprovals({ targetId }).find(
    (item) => item.kind === kind,
  );
  if (!approval) throw new Error(`Missing ${kind} approval for ${targetId}`);
  return approval;
}

describe('report jobs', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('does not export artifacts until the outline approval is reviewed', async () => {
    const job = createReportJob({
      title: 'Approval Gated Digest',
      request: 'Summarize the week for the alliance.',
      outputFormats: ['markdown'],
      requireOutlineApproval: true,
      requireDeliveryApproval: true,
    });

    await expect(approveReportOutline(job.id)).rejects.toThrow(
      'Report outline approval is still pending',
    );

    expect(getReportJob(job.id)).toMatchObject({
      status: 'awaiting_outline_approval',
      artifacts: [],
      markdown: '',
    });
  });

  it('exports after outline approval and blocks delivery until reviewed', async () => {
    const job = createReportJob({
      title: 'Delivery Gated Digest',
      request: 'Summarize the week for the alliance.',
      outputFormats: ['markdown'],
      requireOutlineApproval: true,
      requireDeliveryApproval: true,
    });
    reviewApproval(
      approvalFor('report-outline', job.id).id,
      'approved',
      'owner',
    );

    const outlined = await approveReportOutline(job.id);

    expect(outlined.status).toBe('awaiting_delivery_approval');
    expect(outlined.artifacts).toHaveLength(1);
    expect(fs.existsSync(outlined.artifacts[0].path)).toBe(true);
    expect(outlined.sourceCollectionId).not.toBeNull();

    const collection = getSourceCollection(outlined.sourceCollectionId!);
    expect(collection).not.toBeUndefined();
    expect(collection!.reportJobId).toBe(job.id);
    expect(collection!.requestedScopes).toEqual(['journal', 'memory']);
    expect(collection!.items.every((i) => i.status === 'completed')).toBe(true);
    expect(getSourceLedger(job.id).length).toBe(0);

    await expect(() => approveReportDelivery(job.id)).toThrow(
      'Report delivery approval is still pending',
    );

    reviewApproval(
      approvalFor('report-delivery', job.id).id,
      'approved',
      'owner',
    );
    expect(approveReportDelivery(job.id)).toMatchObject({
      status: 'delivered',
    });
  });

  it('injects a selected design system into generated report artifacts', async () => {
    const designSystem = createDesignSystem({
      name: 'Executive Memo',
      description: 'Decision-first document system.',
      content:
        'Lead with the decision, use compact headings, and cite sources.',
    });
    const job = createReportJob({
      title: 'Design System Memo',
      request: 'Draft a board update memo.',
      designSystemId: designSystem.id,
      outputFormats: ['markdown'],
      requireOutlineApproval: false,
      requireDeliveryApproval: false,
    });

    const outlined = await approveReportOutline(job.id);

    expect(outlined.designSystemId).toBe(designSystem.id);
    expect(outlined.markdown).toContain('## Design System');
    expect(outlined.markdown).toContain('Executive Memo');
    expect(outlined.markdown).toContain(
      'Lead with the decision, use compact headings, and cite sources.',
    );
    expect(fs.readFileSync(outlined.artifacts[0].path, 'utf-8')).toContain(
      '## Design System',
    );
  });
});
