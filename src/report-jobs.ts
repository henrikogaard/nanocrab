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
import { listJournalEntryRecords, findJournalEvents } from './journal-store.js';
import { listMemoryRecords } from './memory-store.js';
import { ProviderPurpose } from './provider-router.js';
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

export interface ReportJob {
  id: string;
  title: string;
  request: string;
  requester: string;
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
  artifacts: Array<{ format: string; path: string }>;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface CreateReportJobInput {
  title?: string;
  request: string;
  requester?: string;
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
    return JSON.parse(
      fs.readFileSync(REPORT_JOBS_PATH, 'utf-8'),
    ) as ReportJob[];
  } catch {
    return [];
  }
}

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

function collectSources(job: ReportJob): {
  sections: string[];
  citations: Array<{ label: string; source: string }>;
} {
  const sections: string[] = [];
  const citations: Array<{ label: string; source: string }> = [];
  if (job.sourceScopes.includes('journal')) {
    const entries = listJournalEntryRecords({ limit: 10 });
    const events = findJournalEvents({ query: job.request, limit: 10 });
    sections.push(
      `## Journal\n\n${
        entries
          .map((entry) => `### ${entry.date}\n${entry.summary}`)
          .join('\n\n') || 'No journal entries found.'
      }`,
    );
    for (const event of events) {
      citations.push({ label: event.title, source: `journal:${event.id}` });
    }
  }
  if (job.sourceScopes.includes('memory')) {
    const memories = listMemoryRecords({ status: 'approved', limit: 25 });
    sections.push(
      `## Approved Memory\n\n${
        memories.map((memory) => `- ${memory.content}`).join('\n') ||
        'No approved memories found.'
      }`,
    );
    for (const memory of memories.slice(0, 10)) {
      citations.push({
        label: memory.content.slice(0, 80),
        source: `memory:${memory.id}`,
      });
    }
  }
  return { sections, citations };
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

function composeMarkdown(job: ReportJob): void {
  const collected = collectSources(job);
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
  composeMarkdown(job);
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
