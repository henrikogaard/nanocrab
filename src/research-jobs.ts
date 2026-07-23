import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { redactAuditValue } from './audit-log.js';
import { notebookLmMockTransport } from './notebooklm-runtime-adapter.js';
import { STORE_DIR } from './config.js';

export const NOTEBOOKLM_CONNECTOR_ID = 'notebooklm-enterprise';
export const NOTEBOOKLM_CONTRACT_VERSION = 'enterprise-mcp-v1';

export const NOTEBOOKLM_CAPABILITIES = [
  'create-notebook',
  'add-source',
  'list-notebooks',
  'retrieve-notebook',
  'share-notebook',
  'link-output',
] as const;

export type NotebookLmCapability = (typeof NOTEBOOKLM_CAPABILITIES)[number];

export interface NotebookLmConfig {
  enabled: boolean;
  provider: 'google-enterprise';
  projectId: string;
  contractVersion: typeof NOTEBOOKLM_CONTRACT_VERSION;
  connectorId: typeof NOTEBOOKLM_CONNECTOR_ID;
  serverName: string;
  credentialProxyRoute: string;
  allowedOperations: NotebookLmCapability[];
  notes: string;
}

export type NotebookLmReadinessStatus = 'ready' | 'attention' | 'blocked';

export interface NotebookLmReadiness {
  status: NotebookLmReadinessStatus;
  configured: boolean;
  connectorId: typeof NOTEBOOKLM_CONNECTOR_ID;
  provider: 'google-enterprise';
  contractVersion: typeof NOTEBOOKLM_CONTRACT_VERSION;
  capabilities: NotebookLmCapability[];
  missing: string[];
  detail: string;
}

export interface NotebookLmProvenance {
  connectorId: typeof NOTEBOOKLM_CONNECTOR_ID;
  operation: NotebookLmCapability;
  status: 'requested' | 'approved' | 'blocked' | 'completed';
  sourceRefs: string[];
  recordedAt: string;
}

export interface NotebookLmOperationResult {
  connectorId: typeof NOTEBOOKLM_CONNECTOR_ID;
  operation: NotebookLmCapability;
  status: 'requires_approval' | 'blocked';
  executed: false;
  researchJobId: string | null;
  reason: string;
}

export interface ResearchJob {
  id: string;
  query: string;
  urls: string[];
  requester: string;
  projectId?: string | null;
  runId?: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed';
  notesPath: string | null;
  screenshots: string[];
  sourceLedgerPath?: string | null;
  notebookLmProvenance?: NotebookLmProvenance | null;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

const RESEARCH_JOBS_PATH = path.join(STORE_DIR, 'research-jobs.json');
const NOTEBOOKLM_CONFIG_PATH = path.join(STORE_DIR, 'notebooklm-config.json');

const DEFAULT_NOTEBOOKLM_CONFIG: NotebookLmConfig = {
  enabled: false,
  provider: 'google-enterprise',
  projectId: '',
  contractVersion: NOTEBOOKLM_CONTRACT_VERSION,
  connectorId: NOTEBOOKLM_CONNECTOR_ID,
  serverName: NOTEBOOKLM_CONNECTOR_ID,
  credentialProxyRoute: 'notebooklm.enterprise',
  allowedOperations: [...NOTEBOOKLM_CAPABILITIES],
  notes:
    'NotebookLM support is official/Enterprise-only. Consumer scraping is intentionally not included.',
};

function normalizeNotes(value: unknown): string {
  const redacted = redactAuditValue(typeof value === 'string' ? value : '');
  return String(redacted).slice(0, 2000);
}

function validateIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(trimmed)) {
    throw new Error(`${label} must be a non-secret identifier`);
  }
  return trimmed;
}

function normalizeOperations(value: unknown): NotebookLmCapability[] {
  if (!Array.isArray(value)) return [...NOTEBOOKLM_CAPABILITIES];
  return NOTEBOOKLM_CAPABILITIES.filter((operation) =>
    value.some((candidate) => candidate === operation),
  );
}

function readJobs(): ResearchJob[] {
  try {
    return JSON.parse(
      fs.readFileSync(RESEARCH_JOBS_PATH, 'utf-8'),
    ) as ResearchJob[];
  } catch {
    return [];
  }
}

function writeJobs(jobs: ResearchJob[]): void {
  fs.mkdirSync(path.dirname(RESEARCH_JOBS_PATH), { recursive: true });
  fs.writeFileSync(RESEARCH_JOBS_PATH, `${JSON.stringify(jobs, null, 2)}\n`);
}

function upsertJob(job: ResearchJob): void {
  const jobs = readJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  writeJobs(jobs);
}

export function loadNotebookLmConfig(): NotebookLmConfig {
  try {
    const raw = JSON.parse(
      fs.readFileSync(NOTEBOOKLM_CONFIG_PATH, 'utf-8'),
    ) as Partial<NotebookLmConfig> | null;
    return normalizeNotebookLmConfig(raw || {});
  } catch {
    return { ...DEFAULT_NOTEBOOKLM_CONFIG };
  }
}

function normalizeNotebookLmConfig(
  config: Partial<NotebookLmConfig>,
): NotebookLmConfig {
  if (config.provider && config.provider !== 'google-enterprise') {
    throw new Error('NotebookLM connector is Enterprise-only');
  }
  if (
    config.contractVersion &&
    config.contractVersion !== NOTEBOOKLM_CONTRACT_VERSION
  ) {
    throw new Error(
      `Unsupported NotebookLM contract: ${config.contractVersion}`,
    );
  }
  const serverName = validateIdentifier(
    config.serverName || DEFAULT_NOTEBOOKLM_CONFIG.serverName,
    'serverName',
  );
  const credentialProxyRoute = validateIdentifier(
    config.credentialProxyRoute ||
      DEFAULT_NOTEBOOKLM_CONFIG.credentialProxyRoute,
    'credentialProxyRoute',
  );
  const projectId = String(config.projectId || '').trim();
  if (projectId.length > 100 || /\s/.test(projectId)) {
    throw new Error('projectId must be a non-secret identifier');
  }
  return {
    ...DEFAULT_NOTEBOOKLM_CONFIG,
    enabled: config.enabled === true,
    projectId,
    serverName,
    credentialProxyRoute,
    allowedOperations: normalizeOperations(config.allowedOperations),
    notes:
      config.notes === undefined
        ? DEFAULT_NOTEBOOKLM_CONFIG.notes
        : normalizeNotes(config.notes),
  };
}

export function saveNotebookLmConfig(
  config: Partial<NotebookLmConfig>,
): NotebookLmConfig {
  const next = normalizeNotebookLmConfig({
    ...loadNotebookLmConfig(),
    ...config,
  });
  fs.mkdirSync(path.dirname(NOTEBOOKLM_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(
    NOTEBOOKLM_CONFIG_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
}

export function getNotebookLmCapabilities(
  config = loadNotebookLmConfig(),
): NotebookLmCapability[] {
  return NOTEBOOKLM_CAPABILITIES.filter((operation) =>
    config.allowedOperations.includes(operation),
  );
}

export function getNotebookLmReadiness(
  config = loadNotebookLmConfig(),
): NotebookLmReadiness {
  const missing: string[] = [];
  if (!config.enabled) missing.push('enabled');
  if (!config.projectId) missing.push('projectId');
  if (!config.serverName) missing.push('serverName');
  if (!config.credentialProxyRoute) missing.push('credentialProxyRoute');
  const capabilities = getNotebookLmCapabilities(config);
  if (capabilities.length === 0) missing.push('allowedOperations');

  if (missing.length > 0) {
    return {
      status: 'blocked',
      configured: false,
      connectorId: NOTEBOOKLM_CONNECTOR_ID,
      provider: 'google-enterprise',
      contractVersion: NOTEBOOKLM_CONTRACT_VERSION,
      capabilities,
      missing,
      detail:
        'NotebookLM Enterprise is disabled or missing its non-secret contract metadata.',
    };
  }

  return {
    status: 'attention',
    configured: true,
    connectorId: NOTEBOOKLM_CONNECTOR_ID,
    provider: 'google-enterprise',
    contractVersion: NOTEBOOKLM_CONTRACT_VERSION,
    capabilities,
    missing: [],
    detail:
      'Enterprise contract declared. Runtime adapter and credential-proxy verification are required before any external call.',
  };
}

export function requestNotebookLmOperation(input: {
  operation: NotebookLmCapability;
  approved?: boolean;
  researchJobId?: string;
  config?: NotebookLmConfig;
}): NotebookLmOperationResult {
  const config = input.config || loadNotebookLmConfig();
  const readiness = getNotebookLmReadiness(config);
  const base = {
    connectorId: NOTEBOOKLM_CONNECTOR_ID as typeof NOTEBOOKLM_CONNECTOR_ID,
    operation: input.operation,
    executed: false as const,
    researchJobId: input.researchJobId || null,
  };
  if (!readiness.capabilities.includes(input.operation)) {
    return {
      ...base,
      status: 'blocked',
      reason: `NotebookLM operation is not allowed: ${input.operation}`,
    };
  }
  if (!readiness.configured) {
    return {
      ...base,
      status: 'blocked',
      reason: readiness.detail,
    };
  }
  if (input.researchJobId) {
    linkResearchJobToNotebookLm(input.researchJobId, {
      operation: input.operation,
      status: input.approved ? 'approved' : 'requested',
      sourceRefs: [],
    });
  }
  if (!input.approved) {
    return {
      ...base,
      status: 'requires_approval',
      reason:
        'NotebookLM Enterprise operations require explicit owner approval.',
    };
  }
  return {
    ...base,
    status: 'blocked',
    reason:
      notebookLmMockTransport.execute(
        input.operation,
        {},
        { approved: true, researchJobId: input.researchJobId },
      ).reason || 'Mock transport completed; no external call was made.',
  };
}

export function listResearchJobs(): ResearchJob[] {
  return readJobs().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getResearchJob(id: string): ResearchJob | undefined {
  return readJobs().find((job) => job.id === id);
}

export function createResearchJob(input: {
  query: string;
  urls?: string[];
  requester?: string;
  projectId?: string;
  runId?: string;
  screenshots?: string[];
  sourceLedgerPath?: string;
  autoRun?: boolean;
}): ResearchJob {
  const now = new Date().toISOString();
  const id = `research-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const job: ResearchJob = {
    id,
    query: input.query.trim(),
    urls: input.urls || [],
    requester: input.requester || 'dashboard',
    projectId: input.projectId || null,
    runId: input.runId || null,
    status: 'queued',
    notesPath: null,
    screenshots: input.screenshots || [],
    sourceLedgerPath: input.sourceLedgerPath || null,
    notebookLmProvenance: null,
    createdAt: now,
    completedAt: null,
    error: null,
  };
  if (!job.query) throw new Error('query is required');
  upsertJob(job);
  if (input.autoRun !== false) {
    setImmediate(() => {
      void runResearchJob(job).catch((err) => {
        job.status = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
        job.completedAt = new Date().toISOString();
        upsertJob(job);
      });
    });
  }
  return job;
}

export function updateResearchJobMetadata(
  id: string,
  patch: Partial<
    Pick<
      ResearchJob,
      | 'projectId'
      | 'runId'
      | 'notesPath'
      | 'screenshots'
      | 'sourceLedgerPath'
      | 'notebookLmProvenance'
    >
  >,
): ResearchJob | undefined {
  const job = getResearchJob(id);
  if (!job) return undefined;
  const updated = { ...job, ...patch };
  upsertJob(updated);
  return updated;
}

export function linkResearchJobToNotebookLm(
  id: string,
  input: {
    operation: NotebookLmCapability;
    status: NotebookLmProvenance['status'];
    sourceRefs?: string[];
  },
): ResearchJob | undefined {
  return updateResearchJobMetadata(id, {
    notebookLmProvenance: {
      connectorId: NOTEBOOKLM_CONNECTOR_ID,
      operation: input.operation,
      status: input.status,
      sourceRefs: (input.sourceRefs || []).map(String).slice(0, 50),
      recordedAt: new Date().toISOString(),
    },
  });
}

async function runResearchJob(job: ResearchJob): Promise<void> {
  job.status = 'running';
  upsertJob(job);
  const dir = path.join(STORE_DIR, 'research', job.id);
  fs.mkdirSync(dir, { recursive: true });
  const notes: string[] = [`# Research: ${job.query}`, ''];
  if (job.urls.length > 0) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      for (const url of job.urls.slice(0, 10)) {
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const title = await page.title();
        const text = await page
          .locator('body')
          .innerText({ timeout: 8000 })
          .catch(() => '');
        const screenshot = path.join(dir, `${job.screenshots.length + 1}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        job.screenshots.push(screenshot);
        notes.push(
          `## ${title || url}`,
          '',
          `Source: ${url}`,
          '',
          text.slice(0, 4000),
          '',
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } else {
    notes.push(
      'No URLs were supplied. Use this job as a research note shell or rerun with sources.',
    );
  }
  const notesPath = path.join(dir, 'notes.md');
  fs.writeFileSync(notesPath, `${notes.join('\n')}\n`);
  job.notesPath = notesPath;
  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  upsertJob(job);
}
