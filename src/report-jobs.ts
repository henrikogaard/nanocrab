import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Document, Packer, Paragraph, TextRun } from 'docx';

import { STORE_DIR } from './config.js';
import { buildArtifactVaultFromReports } from './artifact-vault.js';
import {
  createApproval,
  hasApprovedTarget,
  listApprovals,
  type ApprovalKind,
} from './approvals.js';
import { ProviderPurpose } from './provider-router.js';
import {
  collectSources,
  getSourceCollection,
  getSourceLedger,
  type SourceLedgerEntry,
} from './source-collection.js';
import {
  designSystemSelectionSummary,
  type DesignSystem,
} from './design-systems.js';

export type ReportJobStatus =
  | 'outline_ready'
  | 'awaiting_outline_approval'
  | 'draft_ready'
  | 'awaiting_delivery_approval'
  | 'delivered'
  | 'failed';

export interface ReportAuthorizationContext {
  actorUsername: string;
  groupFolder: string;
  agentId?: string;
  isMainAgent: boolean;
}

export interface ReportJob {
  id: string;
  title: string;
  request: string;
  requester: string;
  authorizationContext: ReportAuthorizationContext;
  providerProfileId: ProviderPurpose;
  sourceScopes: string[];
  outputFormats: string[];
  designSystemId: string | null;
  deliverablesDir: string;
  requireOutlineApproval: boolean;
  requireDeliveryApproval: boolean;
  status: ReportJobStatus;
  outline: string;
  markdown: string;
  citations: Array<{ label: string; source: string }>;
  sourceCollectionId: string | null;
  artifacts: Array<{ format: string; path: string }>;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface CreateReportJobInput {
  title?: string;
  request: string;
  requester?: string;
  authorizationContext?: ReportAuthorizationContext;
  providerProfileId?: ProviderPurpose;
  sourceScopes?: string[];
  outputFormats?: string[];
  designSystemId?: string;
  designSystemName?: string;
  deliverablesDir?: string;
  requireOutlineApproval?: boolean;
  requireDeliveryApproval?: boolean;
}

const REPORT_JOBS_PATH = path.join(STORE_DIR, 'report-jobs.json');

function readJobs(): ReportJob[] {
  try {
    const jobs = JSON.parse(
      fs.readFileSync(REPORT_JOBS_PATH, 'utf-8'),
    ) as ReportJob[];
    return jobs.map((job) => ({
      ...job,
      authorizationContext: {
        actorUsername:
          job.authorizationContext?.actorUsername ||
          job.requester ||
          'dashboard',
        groupFolder: job.authorizationContext?.groupFolder || 'dashboard',
        ...(job.authorizationContext?.agentId
          ? { agentId: job.authorizationContext.agentId }
          : {}),
        isMainAgent: job.authorizationContext?.isMainAgent === true,
      },
    }));
  } catch {
    return [];
  }
}

export const reportSourceRuntime = {
  collectSources,
};

function writeJobs(jobs: ReportJob[]): void {
  fs.mkdirSync(path.dirname(REPORT_JOBS_PATH), { recursive: true });
  fs.writeFileSync(REPORT_JOBS_PATH, `${JSON.stringify(jobs, null, 2)}\n`);
}

function upsertJob(job: ReportJob): void {
  const jobs = readJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  writeJobs(jobs);
}

function safeFilename(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'report'
  );
}

async function collectReportSources(job: ReportJob): Promise<{
  sections: string[];
  citations: Array<{ label: string; source: string }>;
  connectorScopes?: string[];
}> {
  const collected = await reportSourceRuntime.collectSources(
    job.id,
    job.sourceScopes,
    job.request,
    {
      actor: job.authorizationContext.actorUsername,
      groupFolder: job.authorizationContext.groupFolder,
      agentId: job.authorizationContext.agentId,
      isMain: job.authorizationContext.isMainAgent,
    },
  );
  job.sourceCollectionId = collected.sourceCollectionId;
  return {
    sections: collected.sections,
    citations: collected.citations,
    connectorScopes: collected.connectorScopes,
  };
}

function composeOutline(job: ReportJob): string {
  return [
    `# ${job.title}`,
    '',
    '1. Situation summary',
    '2. Key events and decisions',
    '3. Relevant memories and standing context',
    '4. Risks, gaps, and follow-up actions',
  ].join('\n');
}

function ensureReportApproval(job: ReportJob, kind: ApprovalKind): void {
  const existing = listApprovals({
    status: 'pending',
    kind,
    targetType: 'report-job',
    targetId: job.id,
    limit: 1,
  });
  if (existing.length > 0) return;
  createApproval({
    kind,
    title:
      kind === 'report-outline'
        ? `Approve report outline: ${job.title}`
        : `Approve report delivery: ${job.title}`,
    summary:
      kind === 'report-outline'
        ? job.outline
        : `Artifacts ready:\n${job.artifacts.map((artifact) => artifact.path).join('\n')}`,
    risk: kind === 'report-outline' ? 'low' : 'medium',
    requester: job.requester,
    targetType: 'report-job',
    targetId: job.id,
    payload:
      kind === 'report-outline'
        ? { jobId: job.id }
        : { jobId: job.id, artifacts: job.artifacts },
  });
}

async function composeMarkdown(job: ReportJob): Promise<void> {
  const collected = await collectReportSources(job);
  job.citations = collected.citations;
  const designSystem = job.designSystemId
    ? designSystemSelectionSummary({
        requestedDesignSystem: job.designSystemId,
      }).selected
    : null;
  const citations = collected.citations.length
    ? collected.citations
        .map(
          (citation, index) =>
            `[^${index + 1}]: ${citation.label} (${citation.source})`,
        )
        .join('\n')
    : '';
  const sourceLinkPreviews = collected.citations.length
    ? collected.citations
        .filter((c) => c.source && c.source.startsWith('http'))
        .map((citation, index) => `- [${citation.label}](${citation.source})`)
        .join('\n')
    : '';
  const sourceCollection = job.sourceCollectionId
    ? getSourceCollection(job.sourceCollectionId)
    : null;
  const ledger: SourceLedgerEntry[] =
    sourceCollection?.ledger || getSourceLedger(job.id);
  const sourceLedgerSection = ledger.length
    ? `## Source Ledger\n\n${ledger
        .map(
          (entry) =>
            `- ${entry.sourceLabel} (${entry.scope}${
              entry.connectorId ? `/${entry.connectorId}` : ''
            }) — ${entry.sourceUrl || ''} — collected ${entry.collectedAt} — ledger:${entry.id}`,
        )
        .join('\n')}`
    : '## Source Ledger\n\nNo source ledger entries.';
  job.markdown = [
    `# ${job.title}`,
    '',
    `Requested by: ${job.requester}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Request',
    '',
    job.request,
    '',
    ...collected.sections,
    ...designSystemMarkdownSection(designSystem),
    '',
    '## Recommended Follow-Up',
    '',
    '- Review pending approvals and unresolved tasks.',
    '- Confirm whether any generated artifacts should be sent to a channel.',
    '',
    citations
      ? `## Sources\n\n${citations}`
      : '## Sources\n\nNo citations available.',
    '',
    sourceLinkPreviews ? `## Source Links\n\n${sourceLinkPreviews}` : '',
    '',
    sourceLedgerSection,
  ].join('\n');
}

function designSystemMarkdownSection(system: DesignSystem | null): string[] {
  if (!system) return [];
  return [
    '',
    '## Design System',
    '',
    `Selected: ${system.name}`,
    system.description ? `Description: ${system.description}` : '',
    '',
    system.content,
  ].filter((line) => line !== '');
}

async function writeDocx(filePath: string, markdown: string): Promise<void> {
  const doc = new Document({
    sections: [
      {
        children: markdown.split(/\n+/).map(
          (line) =>
            new Paragraph({
              children: [new TextRun(line)],
            }),
        ),
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}

async function writePdf(filePath: string, html: string): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({ path: filePath, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

async function exportArtifacts(job: ReportJob): Promise<void> {
  const dir = path.resolve(
    job.deliverablesDir || path.join(STORE_DIR, 'deliverables'),
  );
  fs.mkdirSync(dir, { recursive: true });
  const base = `${safeFilename(job.title)}-${job.id}`;
  const html = `<!doctype html><meta charset="utf-8"><title>${job.title}</title><pre style="font:14px/1.45 system-ui;white-space:pre-wrap">${job.markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')}</pre>`;
  job.artifacts = [];
  for (const format of job.outputFormats) {
    const filePath = path.join(
      dir,
      `${base}.${format === 'markdown' ? 'md' : format}`,
    );
    if (format === 'markdown') fs.writeFileSync(filePath, `${job.markdown}\n`);
    if (format === 'html') fs.writeFileSync(filePath, html);
    if (format === 'docx') await writeDocx(filePath, job.markdown);
    if (format === 'pdf') await writePdf(filePath, html);
    job.artifacts.push({ format, path: filePath });
  }

  const generatedArtifacts = job.artifacts
    .map((artifact) => `- ${artifact.format}: ${artifact.path}`)
    .join('\n');
  if (generatedArtifacts) {
    const generatedArtifactsSection = `## Generated Artifacts\n\n${generatedArtifacts}`;
    job.markdown = `${job.markdown}\n\n${generatedArtifactsSection}`;
    const markdownArtifact = job.artifacts.find(
      (artifact) => artifact.format === 'markdown',
    );
    if (markdownArtifact) {
      fs.writeFileSync(markdownArtifact.path, `${job.markdown}\n`);
    }
  }
}

export function listReportJobs(): ReportJob[] {
  return readJobs().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getReportJob(id: string): ReportJob | undefined {
  return readJobs().find((job) => job.id === id);
}

export function createReportJob(input: CreateReportJobInput): ReportJob {
  const now = new Date().toISOString();
  const designSystemSelection = designSystemSelectionSummary({
    requestedDesignSystem: input.designSystemId || input.designSystemName,
  });
  if (
    (input.designSystemId || input.designSystemName) &&
    !designSystemSelection.selected
  ) {
    throw new Error('Design system not found');
  }
  const job: ReportJob = {
    id: `report-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    title:
      input.title?.trim() ||
      input.request.trim().slice(0, 90) ||
      'NanoCrab Report',
    request: input.request.trim(),
    requester: input.requester || 'dashboard',
    authorizationContext: input.authorizationContext || {
      actorUsername: input.requester || 'dashboard',
      groupFolder: 'dashboard',
      isMainAgent: false,
    },
    providerProfileId: input.providerProfileId || 'default_reports',
    sourceScopes: input.sourceScopes?.length
      ? input.sourceScopes
      : ['journal', 'memory'],
    outputFormats: input.outputFormats?.length
      ? input.outputFormats
      : ['markdown'],
    designSystemId: designSystemSelection.selected?.id || null,
    deliverablesDir:
      input.deliverablesDir || path.join(STORE_DIR, 'deliverables'),
    requireOutlineApproval: input.requireOutlineApproval !== false,
    requireDeliveryApproval: input.requireDeliveryApproval !== false,
    status:
      input.requireOutlineApproval === false
        ? 'outline_ready'
        : 'awaiting_outline_approval',
    outline: '',
    markdown: '',
    citations: [],
    sourceCollectionId: null,
    artifacts: [],
    createdAt: now,
    updatedAt: now,
    error: null,
  };
  if (!job.request) throw new Error('report request is required');
  job.outline = composeOutline(job);
  upsertJob(job);
  if (job.requireOutlineApproval) {
    ensureReportApproval(job, 'report-outline');
  }
  return job;
}

export async function approveReportOutline(id: string): Promise<ReportJob> {
  const job = getReportJob(id);
  if (!job) throw new Error(`Report job not found: ${id}`);
  if (
    job.requireOutlineApproval &&
    !hasApprovedTarget('report-outline', 'report-job', id)
  ) {
    ensureReportApproval(job, 'report-outline');
    throw new Error('Report outline approval is still pending');
  }
  await composeMarkdown(job);
  await exportArtifacts(job);
  job.status = job.requireDeliveryApproval
    ? 'awaiting_delivery_approval'
    : 'draft_ready';
  job.updatedAt = new Date().toISOString();
  upsertJob(job);
  buildArtifactVaultFromReports({ reports: [job] });
  if (job.requireDeliveryApproval) {
    ensureReportApproval(job, 'report-delivery');
  }
  return job;
}

export function approveReportDelivery(id: string): ReportJob {
  const job = getReportJob(id);
  if (!job) throw new Error(`Report job not found: ${id}`);
  if (
    job.requireDeliveryApproval &&
    !hasApprovedTarget('report-delivery', 'report-job', id)
  ) {
    ensureReportApproval(job, 'report-delivery');
    throw new Error('Report delivery approval is still pending');
  }
  job.status = 'delivered';
  job.updatedAt = new Date().toISOString();
  upsertJob(job);
  return job;
}
