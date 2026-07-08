import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export interface NotebookLmConfig {
  enabled: boolean;
  provider: 'google-enterprise';
  projectId: string;
  notes: string;
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
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

const RESEARCH_JOBS_PATH = path.join(STORE_DIR, 'research-jobs.json');
const NOTEBOOKLM_CONFIG_PATH = path.join(STORE_DIR, 'notebooklm-config.json');

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
    return {
      enabled: false,
      provider: 'google-enterprise',
      projectId: '',
      notes: '',
      ...JSON.parse(fs.readFileSync(NOTEBOOKLM_CONFIG_PATH, 'utf-8')),
    };
  } catch {
    return {
      enabled: false,
      provider: 'google-enterprise',
      projectId: '',
      notes:
        'NotebookLM support is official/Enterprise-only. Consumer scraping is intentionally not included.',
    };
  }
}

export function saveNotebookLmConfig(
  config: Partial<NotebookLmConfig>,
): NotebookLmConfig {
  const next: NotebookLmConfig = {
    ...loadNotebookLmConfig(),
    ...config,
    provider: 'google-enterprise',
  };
  fs.mkdirSync(path.dirname(NOTEBOOKLM_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(
    NOTEBOOKLM_CONFIG_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
  );
  return next;
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
      'projectId' | 'runId' | 'notesPath' | 'screenshots' | 'sourceLedgerPath'
    >
  >,
): ResearchJob | undefined {
  const job = getResearchJob(id);
  if (!job) return undefined;
  const updated = { ...job, ...patch };
  upsertJob(updated);
  return updated;
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
