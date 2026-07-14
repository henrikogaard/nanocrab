import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ConnectorAuthorizationInput } from './connector-permissions.js';

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
  reportSourceRuntime,
} = await import('./report-jobs.js');
const { createDesignSystem } = await import('./design-systems.js');
const { listApprovals, reviewApproval } = await import('./approvals.js');
const { getSourceCollection, getSourceLedger } =
  await import('./source-collection.js');
const { collectSources } = await import('./source-collection.js');

const defaultCollectSources = reportSourceRuntime?.collectSources;

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
    if (reportSourceRuntime && defaultCollectSources) {
      reportSourceRuntime.collectSources = defaultCollectSources;
    }
  });

  it('persists distinct report connector authorization context', () => {
    const job = createReportJob({
      request: 'Collect authorized sources.',
      requester: 'alice',
      authorizationContext: {
        actorUsername: 'alice',
        groupFolder: 'engineering-group',
        agentId: 'agent-reporter',
        isMainAgent: true,
      },
    });

    expect(getReportJob(job.id)?.authorizationContext).toEqual({
      actorUsername: 'alice',
      groupFolder: 'engineering-group',
      agentId: 'agent-reporter',
      isMainAgent: true,
    });
  });

  it('applies safe authorization defaults to existing stored report jobs', () => {
    const job = createReportJob({
      request: 'Load a legacy report.',
      requester: 'legacy-requester',
    });
    const jobsPath = path.join(STORE_DIR, 'report-jobs.json');
    const stored = JSON.parse(fs.readFileSync(jobsPath, 'utf-8')) as Array<
      Record<string, unknown>
    >;
    delete stored[0].authorizationContext;
    fs.writeFileSync(jobsPath, `${JSON.stringify(stored, null, 2)}\n`);

    expect(getReportJob(job.id)?.authorizationContext).toEqual({
      actorUsername: 'legacy-requester',
      groupFolder: 'dashboard',
      isMainAgent: false,
    });
  });

  it('finishes connector-only report collection as failed when unavailable', async () => {
    reportSourceRuntime.collectSources = (jobId, scopes, query, context) =>
      collectSources(jobId, scopes, query, context, {
        availableConnectors: [],
      });
    const job = createReportJob({
      request: 'Collect connector sources.',
      sourceScopes: ['connector'],
      requireOutlineApproval: false,
      requireDeliveryApproval: false,
      authorizationContext: {
        actorUsername: 'alice',
        groupFolder: 'engineering-group',
        agentId: 'agent-reporter',
        isMainAgent: false,
      },
    });

    const outlined = await approveReportOutline(job.id);
    expect(getSourceCollection(outlined.sourceCollectionId!)?.status).toBe(
      'failed',
    );
  });

  it('threads authorization context and makes denied mixed reports partial without fetching', async () => {
    const authorize = vi.fn((input: ConnectorAuthorizationInput) => ({
      allowed: false,
      connectorId: input.connectorId,
      action: input.action,
      decision: 'denied' as const,
      requiresApproval: false,
      reason: 'group policy denied connector read',
    }));
    const githubApi = vi.fn();
    reportSourceRuntime.collectSources = (jobId, scopes, query, context) =>
      collectSources(jobId, scopes, query, context, {
        availableConnectors: ['github'],
        authorizeConnectorAction: authorize,
        githubApi,
        listMemoryRecords: () => [],
      });
    const job = createReportJob({
      request: 'Collect mixed sources.',
      sourceScopes: ['memory', 'connector'],
      requireOutlineApproval: false,
      requireDeliveryApproval: false,
      authorizationContext: {
        actorUsername: 'alice',
        groupFolder: 'engineering-group',
        agentId: 'agent-reporter',
        isMainAgent: true,
      },
    });

    const outlined = await approveReportOutline(job.id);
    expect(getSourceCollection(outlined.sourceCollectionId!)?.status).toBe(
      'partial',
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        groupFolder: 'engineering-group',
        agentId: 'agent-reporter',
        isMain: true,
        context: expect.objectContaining({ actor: 'alice' }),
      }),
    );
    expect(githubApi).not.toHaveBeenCalled();
  });

  it('threads allowed report authorization context into the external fetch path', async () => {
    const authorize = vi.fn((input: ConnectorAuthorizationInput) => ({
      allowed: true,
      connectorId: input.connectorId,
      action: input.action,
      decision: 'allowed' as const,
      requiresApproval: false,
      reason: 'allowed',
    }));
    const githubApi = vi.fn().mockResolvedValue({ items: [] });
    reportSourceRuntime.collectSources = (jobId, scopes, query, context) =>
      collectSources(jobId, scopes, query, context, {
        availableConnectors: ['github'],
        authorizeConnectorAction: authorize,
        githubApi,
      });
    const job = createReportJob({
      request: 'Collect allowed connector sources.',
      sourceScopes: ['connector'],
      requireOutlineApproval: false,
      requireDeliveryApproval: false,
      authorizationContext: {
        actorUsername: 'bob',
        groupFolder: 'main-group',
        agentId: 'agent-main',
        isMainAgent: true,
      },
    });

    const outlined = await approveReportOutline(job.id);
    expect(getSourceCollection(outlined.sourceCollectionId!)?.status).toBe(
      'completed',
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        groupFolder: 'main-group',
        agentId: 'agent-main',
        isMain: true,
      }),
    );
    expect(githubApi).toHaveBeenCalledTimes(1);
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
