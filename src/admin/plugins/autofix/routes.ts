/**
 * GitHub Auto-Fix Pipeline
 *
 * Flow:
 *   1. Register a project (owner/repo + local working directory)
 *   2. GitHub webhook fires on issue created/labeled
 *   3. If issue has trigger label (default: "autofix"), pipeline starts
 *   4. Claude Code clones/pulls the repo, reads the issue, writes a fix
 *   5. Creates a branch, commits, pushes, opens a PR referencing the issue
 *   6. Posts a comment on the issue with the PR link
 *   7. Optionally notifies via bot message (WhatsApp/Telegram/Signal)
 *
 * Also supports:
 *   - Manual trigger from dashboard (pick issue → run)
 *   - PR review automation (review PRs with Claude)
 *   - Result tracking with full output logs
 */
import { Router, Request, Response } from 'express';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from '../../../config.js';
import { readEnvFile } from '../../../env.js';
import {
  DEFAULT_AGENT_MODELS,
  isAgentProvider,
  type AgentProvider,
} from '../../../agent-provider.js';
import {
  inferLegacyRunnerCli,
  validateCodingRuntimeSelection,
} from '../../../agent-runtime-registry.js';
import { probeCodingRunnerReadiness } from '../../../coding-runner-readiness.js';
import type { AgentRuntimeSelection } from '../../../types.js';
import { auditLog } from '../../security.js';
import { getState } from '../../state.js';
import { logger } from '../../../logger.js';
import {
  approveCodingJob,
  approveCodingJobPr,
  cancelCodingJob,
  closeCodingJobPr,
  denyCodingJob,
  getCodingJob,
  listGitHubProjectBoards,
  listGitHubIssues,
  loadCodingJobs,
  loadCodingRepos,
  openCodingJobPr,
  refreshCodingJobCi,
  registerCodingRepo,
  revertCodingJob,
  retryCodingJob,
  startCodingJob,
  type CodingJob,
  type CodingRepo,
  type GitHubIssueSummary,
  type GitHubProjectBoardSummary,
  type StartCodingJobInput,
} from '../../../coding-jobs.js';

const router = Router();
const PROJECTS_PATH = path.join(STORE_DIR, 'autofix-projects.json');
const JOBS_PATH = path.join(STORE_DIR, 'autofix-jobs.json');

export interface Project {
  id: string;
  owner: string;
  repo: string;
  workDir: string;
  triggerLabel: string;
  provider: string;
  model: string;
  runtime: AgentRuntimeSelection;
  notifyJid: string; // bot channel to notify
  autoReview: boolean; // auto-review new PRs
  createPr: boolean;
  maxActiveJobs: number;
  autoPickEnabled: boolean;
  pollIntervalMinutes: number;
  lastAutoPickAt: string | null;
  createdAt: string;
}

interface AutofixJob {
  id: string;
  projectId: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  type: 'fix' | 'review';
  status: 'queued' | 'running' | 'completed' | 'failed';
  branch: string;
  prUrl: string | null;
  output: string;
  model: string;
  startedAt: string;
  completedAt: string | null;
}

const AUTOFIX_ACTIVE_JOB_STATUSES = new Set([
  'queued',
  'investigate',
  'plan',
  'await_approval',
  'implement',
  'test',
  'await_pr_approval',
  'open_pr',
  'ci_running',
]);

function defaultAutofixModel(provider: string): string {
  if (provider in DEFAULT_AGENT_MODELS) {
    return DEFAULT_AGENT_MODELS[provider as AgentProvider];
  }
  return DEFAULT_AGENT_MODELS.claude;
}

function normalizePollIntervalMinutes(input: unknown): number {
  const minutes = Number(input);
  if (!Number.isFinite(minutes) || minutes <= 0) return 15;
  return Math.max(5, Math.floor(minutes));
}

export function normalizeAutofixProject(input: Partial<Project>): Project {
  const owner = String(input.owner || '').trim();
  const repo = String(input.repo || '').trim();
  const maxActiveJobs = Number(input.maxActiveJobs);
  const rawLegacyProvider = String(input.provider || 'claude').trim();
  if (!isAgentProvider(rawLegacyProvider)) {
    throw new Error(
      `Invalid Autofix coding runtime (missing) / ${rawLegacyProvider || '(missing)'} / ${String(input.model || '(missing)')}: unknown provider`,
    );
  }
  const legacyProvider: AgentProvider = rawLegacyProvider;
  const legacyModel =
    String(input.model || '').trim() || defaultAutofixModel(legacyProvider);
  const runtime: AgentRuntimeSelection = input.runtime
    ? {
        cli: input.runtime.cli,
        provider: input.runtime.provider,
        model: String(input.runtime.model || '').trim(),
      }
    : {
        cli: inferLegacyRunnerCli(legacyProvider),
        provider: legacyProvider,
        model: legacyModel,
      };
  try {
    validateCodingRuntimeSelection(runtime);
  } catch (err) {
    throw new Error(
      `Invalid Autofix coding runtime ${runtime.cli || '(missing)'} / ${runtime.provider || '(missing)'} / ${runtime.model || '(missing)'}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  return {
    id: input.id || crypto.randomUUID(),
    owner,
    repo,
    workDir:
      input.workDir ||
      path.join(process.env.HOME || '/tmp', 'repos', `${owner}-${repo}`),
    triggerLabel: input.triggerLabel?.trim() || 'autofix',
    provider: runtime.provider,
    model: runtime.model,
    runtime,
    notifyJid: input.notifyJid || '',
    autoReview: input.autoReview === true,
    createPr: input.createPr !== false,
    maxActiveJobs:
      Number.isFinite(maxActiveJobs) && maxActiveJobs > 0
        ? Math.floor(maxActiveJobs)
        : 1,
    autoPickEnabled: input.autoPickEnabled === true,
    pollIntervalMinutes: normalizePollIntervalMinutes(
      input.pollIntervalMinutes,
    ),
    lastAutoPickAt:
      typeof input.lastAutoPickAt === 'string' && input.lastAutoPickAt.trim()
        ? input.lastAutoPickAt
        : null,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function buildAutofixStartInput(
  project: Project,
  issueNumber: number,
  requestedBy: string,
): StartCodingJobInput {
  return {
    repo: `${project.owner}/${project.repo}`,
    issueNumber,
    actualRuntime: project.runtime,
    createPr: project.createPr,
    requestedBy,
  };
}

async function assertAutofixRuntimeReady(
  runtime: AgentRuntimeSelection,
): Promise<void> {
  validateCodingRuntimeSelection(runtime);
  if (runtime.cli !== 'devin') return;
  const readiness = await probeCodingRunnerReadiness('devin');
  if (readiness.status !== 'healthy') {
    throw new Error(
      `Autofix coding runtime ${runtime.cli} / ${runtime.provider} / ${runtime.model} is unavailable: ${readiness.detail}`,
    );
  }
}

export function hasAutofixCapacity(
  project: Project,
  codingJobs: CodingJob[],
): boolean {
  const repo = `${project.owner}/${project.repo}`;
  const activeCount = codingJobs.filter(
    (job) =>
      job.repo === repo &&
      AUTOFIX_ACTIVE_JOB_STATUSES.has(String(job.status)) &&
      job.type === 'issue',
  ).length;
  return activeCount < project.maxActiveJobs;
}

interface AutofixWorkbenchActiveJob {
  id: string;
  status: string;
  provider: string;
  model: string;
  branch: string;
  prUrl: string | null;
  createdAt: string;
}

export interface AutofixWorkbenchResponse {
  repos: CodingRepo[];
  projects: Project[];
  selectedRepo: string | null;
  issues: Array<
    GitHubIssueSummary & { activeJob: AutofixWorkbenchActiveJob | null }
  >;
  projectBoards: GitHubProjectBoardSummary[];
  projectBoardsError: string | null;
  jobs: CodingJob[];
}

export function buildAutofixWorkbenchResponse(input: {
  repos: CodingRepo[];
  projects: Project[];
  selectedRepo: string | null;
  issues: GitHubIssueSummary[];
  projectBoards: GitHubProjectBoardSummary[];
  projectBoardsError?: string | null;
  jobs: CodingJob[];
}): AutofixWorkbenchResponse {
  const jobsByIssue = new Map<number, CodingJob>();
  for (const job of input.jobs) {
    if (
      job.repo === input.selectedRepo &&
      job.issueNumber != null &&
      AUTOFIX_ACTIVE_JOB_STATUSES.has(job.status)
    ) {
      jobsByIssue.set(job.issueNumber, job);
    }
  }

  return {
    repos: input.repos,
    projects: input.projects,
    selectedRepo: input.selectedRepo,
    projectBoards: input.projectBoards,
    projectBoardsError: input.projectBoardsError || null,
    jobs: input.jobs,
    issues: input.issues.map((issue) => {
      const activeJob = jobsByIssue.get(issue.number);
      return {
        ...issue,
        activeJob: activeJob
          ? {
              id: activeJob.id,
              status: activeJob.status,
              provider: activeJob.provider,
              model: activeJob.model,
              branch: activeJob.branch,
              prUrl: activeJob.prUrl,
              createdAt: activeJob.createdAt,
            }
          : null,
      };
    }),
  };
}

type AutoPickIssueLabel = string | { name?: string };

export interface AutofixAutoPickIssue {
  number: number;
  title?: string;
  labels?: AutoPickIssueLabel[];
  pull_request?: unknown;
}

export interface AutofixAutoPickResult {
  scanned: number;
  started: number;
  skippedCapacity: number;
  skippedDuplicate: number;
  skippedLabel: number;
  skippedNotDue: number;
  errors: number;
}

export interface RunAutofixAutoPickOptions {
  now?: Date;
  projects?: Project[];
  loadProjects?: () => Project[];
  saveProjects?: (projects: Project[]) => void;
  loadCodingJobs?: () => CodingJob[];
  listIssues?: (project: Project) => Promise<AutofixAutoPickIssue[]>;
  startJob?: (input: StartCodingJobInput) => Promise<CodingJob>;
}

function issueLabelNames(issue: AutofixAutoPickIssue): string[] {
  return (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name || ''))
    .filter(Boolean);
}

function issueHasLabel(issue: AutofixAutoPickIssue, label: string): boolean {
  return issueLabelNames(issue).includes(label);
}

function hasActiveIssueJob(
  project: Project,
  issueNumber: number,
  codingJobs: CodingJob[],
): boolean {
  const repo = `${project.owner}/${project.repo}`;
  return codingJobs.some(
    (job) =>
      job.repo === repo &&
      job.type === 'issue' &&
      job.issueNumber === issueNumber &&
      AUTOFIX_ACTIVE_JOB_STATUSES.has(String(job.status)),
  );
}

function autoPickDue(project: Project, now: Date): boolean {
  if (!project.lastAutoPickAt) return true;
  const lastPoll = new Date(project.lastAutoPickAt).getTime();
  if (!Number.isFinite(lastPoll)) return true;
  return now.getTime() - lastPoll >= project.pollIntervalMinutes * 60_000;
}

export async function runAutofixAutoPickOnce(
  options: RunAutofixAutoPickOptions = {},
): Promise<AutofixAutoPickResult> {
  const now = options.now || new Date();
  const load = options.loadProjects || loadProjects;
  const save = options.saveProjects || saveProjects;
  const projects = (options.projects || load()).map((project) =>
    normalizeAutofixProject(project),
  );
  const codingJobs = (options.loadCodingJobs || loadCodingJobs)();
  const listIssues =
    options.listIssues ||
    ((project: Project) =>
      listGitHubIssues({
        repo: `${project.owner}/${project.repo}`,
        labels: [project.triggerLabel],
        limit: 20,
      }));
  const startJob = options.startJob || startCodingJob;
  const result: AutofixAutoPickResult = {
    scanned: 0,
    started: 0,
    skippedCapacity: 0,
    skippedDuplicate: 0,
    skippedLabel: 0,
    skippedNotDue: 0,
    errors: 0,
  };
  let shouldSave = false;

  for (const project of projects) {
    if (!project.autoPickEnabled) continue;
    if (!autoPickDue(project, now)) {
      result.skippedNotDue += 1;
      continue;
    }

    result.scanned += 1;
    try {
      const issues = await listIssues(project);
      for (const issue of issues) {
        if ('pull_request' in issue && issue.pull_request) continue;
        if (!issueHasLabel(issue, project.triggerLabel)) {
          result.skippedLabel += 1;
          continue;
        }
        if (hasActiveIssueJob(project, issue.number, codingJobs)) {
          result.skippedDuplicate += 1;
          continue;
        }
        if (!hasAutofixCapacity(project, codingJobs)) {
          result.skippedCapacity += 1;
          break;
        }

        await assertAutofixRuntimeReady(project.runtime);
        const job = await startJob(
          buildAutofixStartInput(project, issue.number, 'github-auto-pick'),
        );
        codingJobs.push(job);
        result.started += 1;
      }
    } catch (err) {
      result.errors += 1;
      logger.warn(
        { err, repo: `${project.owner}/${project.repo}` },
        'Autofix auto-pick scan failed',
      );
    } finally {
      project.lastAutoPickAt = now.toISOString();
      shouldSave = true;
    }
  }

  if (shouldSave) save(projects);
  return result;
}

let autoPickTimer: ReturnType<typeof setInterval> | null = null;

export function startAutofixAutoPickLoop(intervalMs = 60_000): void {
  if (autoPickTimer) return;
  const run = async () => {
    try {
      const result = await runAutofixAutoPickOnce();
      if (result.scanned > 0 || result.started > 0 || result.errors > 0) {
        logger.info({ ...result }, 'Autofix auto-pick scan completed');
      }
    } catch (err) {
      logger.warn({ err }, 'Autofix auto-pick loop failed');
    }
  };
  autoPickTimer = setInterval(() => {
    void run();
  }, intervalMs);
  autoPickTimer.unref?.();
  void run();
}

export function stopAutofixAutoPickLoop(): void {
  if (!autoPickTimer) return;
  clearInterval(autoPickTimer);
  autoPickTimer = null;
}

function loadProjects(): Project[] {
  try {
    const projects = JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf-8'));
    return Array.isArray(projects)
      ? projects.map((project) => normalizeAutofixProject(project))
      : [];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]): void {
  fs.mkdirSync(path.dirname(PROJECTS_PATH), { recursive: true });
  fs.writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2));
}

function loadJobs(): AutofixJob[] {
  try {
    return JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJobs(jobs: AutofixJob[]): void {
  fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

function getGitHubToken(): string | null {
  const env = readEnvFile(['GITHUB_TOKEN']);
  return env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || null;
}

async function githubApi(path: string, opts: RequestInit = {}): Promise<any> {
  const token = getGitHubToken();
  if (!token) throw new Error('GITHUB_TOKEN not configured');
  const res = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...((opts.headers as Record<string, string>) || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Projects CRUD ---

router.get('/projects', (_req: Request, res: Response) => {
  res.json(loadProjects());
});

router.post('/projects', async (req: Request, res: Response) => {
  const {
    owner,
    repo,
    workDir,
    triggerLabel,
    runtime,
    notifyJid,
    autoReview,
    createPr,
    maxActiveJobs,
    autoPickEnabled,
    pollIntervalMinutes,
  } = req.body;
  if (!owner || !repo) {
    res.status(400).json({ error: 'owner and repo required' });
    return;
  }

  let project: Project;
  try {
    if (!runtime) throw new Error('a complete runtime is required');
    project = normalizeAutofixProject({
      id: crypto.randomUUID(),
      owner,
      repo,
      workDir,
      triggerLabel,
      runtime,
      notifyJid,
      autoReview,
      createPr,
      maxActiveJobs,
      autoPickEnabled,
      pollIntervalMinutes,
    });
    await assertAutofixRuntimeReady(project.runtime);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const projects = loadProjects();
  projects.push(project);
  saveProjects(projects);
  try {
    await registerCodingRepo({
      repo: `${owner}/${repo}`,
      labels: [project.triggerLabel],
    });
  } catch (err) {
    logger.warn(
      { err, repo: `${owner}/${repo}` },
      'Could not register coding repo for autofix project',
    );
  }
  auditLog(req, 'autofix_project_created', `${owner}/${repo}`);
  res.json({ ok: true, project });
});

router.put('/projects/:id', async (req: Request, res: Response) => {
  const projects = loadProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const fields = [
    'workDir',
    'triggerLabel',
    'runtime',
    'notifyJid',
    'autoReview',
    'createPr',
    'maxActiveJobs',
    'autoPickEnabled',
    'pollIntervalMinutes',
  ];
  for (const f of fields) {
    if (req.body[f] !== undefined) (project as any)[f] = req.body[f];
  }
  try {
    Object.assign(project, normalizeAutofixProject(project));
    await assertAutofixRuntimeReady(project.runtime);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  saveProjects(projects);
  res.json({ ok: true });
});

router.delete('/projects/:id', (req: Request, res: Response) => {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  projects.splice(idx, 1);
  saveProjects(projects);
  res.json({ ok: true });
});

// --- Jobs ---

router.get('/jobs', (_req: Request, res: Response) => {
  const codingJobs = loadCodingJobs()
    .filter((job) => job.type === 'issue')
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 30)
    .map((job) => ({
      ...job,
      issueTitle: job.issueTitle || job.prompt,
      output:
        job.output.length > 1200 ? `${job.output.slice(-1200)}` : job.output,
      startedAt: job.createdAt,
    }));
  if (codingJobs.length > 0) {
    res.json(codingJobs);
    return;
  }

  const jobs = loadJobs();
  res.json(
    jobs
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, 30)
      .map((j) => ({
        ...j,
        output: j.output.length > 500 ? j.output.slice(-500) : j.output,
      })),
  );
});

router.get('/jobs/:id', (req: Request, res: Response) => {
  const jobId = String(req.params.id);
  const codingJob = getCodingJob(jobId);
  if (codingJob) {
    res.json({ ...codingJob, startedAt: codingJob.createdAt });
    return;
  }
  const job = loadJobs().find((j) => j.id === jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

function parseQueryLabels(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean);
}

function parseQueryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseQueryIssueNumber(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

router.get('/workbench', async (req: Request, res: Response) => {
  const repos = loadCodingRepos().filter((repo) => repo.enabled);
  const projects = loadProjects();
  const selectedRepo =
    parseQueryString(req.query.repo) ||
    repos[0]?.fullName ||
    (projects[0] ? `${projects[0].owner}/${projects[0].repo}` : null);

  if (!selectedRepo) {
    res.json(
      buildAutofixWorkbenchResponse({
        repos,
        projects,
        selectedRepo: null,
        issues: [],
        projectBoards: [],
        jobs: [],
      }),
    );
    return;
  }

  try {
    const labels =
      req.query.allLabels === 'true' ? [] : parseQueryLabels(req.query.labels);
    const assignee = parseQueryString(req.query.assignee);
    const milestone = parseQueryString(req.query.milestone);
    const issueNumber = parseQueryIssueNumber(req.query.issueNumber);
    const jobs = loadCodingJobs()
      .filter((job) => job.type === 'issue' && job.repo === selectedRepo)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 30);
    const issues = await listGitHubIssues({
      repo: selectedRepo,
      labels,
      assignee,
      milestone,
      issueNumber,
      limit: 50,
    });
    let projectBoards: GitHubProjectBoardSummary[] = [];
    let projectBoardsError: string | null = null;
    try {
      projectBoards = await listGitHubProjectBoards({ repo: selectedRepo });
    } catch (err) {
      projectBoardsError = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err, repo: selectedRepo },
        'Could not load GitHub project boards for Autofix workbench',
      );
    }
    res.json(
      buildAutofixWorkbenchResponse({
        repos,
        projects,
        selectedRepo,
        issues,
        projectBoards,
        projectBoardsError,
        jobs,
      }),
    );
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/workbench/assign', async (req: Request, res: Response) => {
  try {
    const repo = String(req.body.repo || '').trim();
    const issueNumber = Number(req.body.issueNumber);
    if (!repo || !Number.isInteger(issueNumber) || issueNumber <= 0) {
      res.status(400).json({ error: 'repo and issueNumber required' });
      return;
    }

    const project = loadProjects().find(
      (candidate) =>
        `${candidate.owner}/${candidate.repo}`.toLowerCase() ===
        repo.toLowerCase(),
    );
    const runtime = req.body.actualRuntime
      ? normalizeAutofixProject({
          owner: project?.owner || repo.split('/')[0],
          repo: project?.repo || repo.split('/')[1],
          runtime: req.body.actualRuntime,
        }).runtime
      : project?.runtime;
    if (!runtime) throw new Error('a complete coding runtime is required');
    await assertAutofixRuntimeReady(runtime);
    const job = await startCodingJob({
      repo,
      issueNumber,
      actualRuntime: runtime,
      createPr:
        req.body.createPr === undefined
          ? project?.createPr !== false
          : req.body.createPr === true,
      requestedBy: req.user?.username || 'github-workbench',
    });
    auditLog(
      req,
      'github_workbench_coding_job_started',
      `${repo}#${issueNumber}`,
    );
    res.json({ ok: true, jobId: job.id, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/issues', async (req: Request, res: Response) => {
  try {
    const repo = String(req.query.repo || '');
    const labels = parseQueryLabels(req.query.labels);
    const assignee = parseQueryString(req.query.assignee);
    const milestone = parseQueryString(req.query.milestone);
    const issueNumber = parseQueryIssueNumber(req.query.issueNumber);
    const issues = await listGitHubIssues({
      repo,
      labels,
      assignee,
      milestone,
      issueNumber,
    });
    res.json(issues);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/auto-pick/run', async (req: Request, res: Response) => {
  try {
    const result = await runAutofixAutoPickOnce();
    auditLog(req, 'autofix_auto_pick_run', JSON.stringify(result));
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- Run an autofix ---

async function _runAutofix(
  project: Project,
  issueNumber: number,
  issueTitle: string,
  issueBody: string,
  model?: string,
): Promise<AutofixJob> {
  const branch = `autofix/issue-${issueNumber}`;
  const usedModel = model || project.model || 'sonnet';

  const job: AutofixJob = {
    id: crypto.randomUUID(),
    projectId: project.id,
    repo: `${project.owner}/${project.repo}`,
    issueNumber,
    issueTitle,
    issueBody: issueBody.slice(0, 2000),
    type: 'fix',
    status: 'running',
    branch,
    prUrl: null,
    output: '',
    model: usedModel,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  const jobs = loadJobs();
  jobs.push(job);
  saveJobs(jobs);

  // Ensure work directory exists and is up to date
  const workDir = project.workDir;
  if (!fs.existsSync(workDir)) {
    const token = getGitHubToken();
    const cloneUrl = token
      ? `https://${token}@github.com/${project.owner}/${project.repo}.git`
      : `https://github.com/${project.owner}/${project.repo}.git`;
    try {
      execFileSync('git', ['clone', '--depth', '50', cloneUrl, workDir], {
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (err: any) {
      job.status = 'failed';
      job.output = `Clone failed: ${err.message}`;
      job.completedAt = new Date().toISOString();
      saveJobs(jobs);
      return job;
    }
  } else {
    // Pull latest
    try {
      execFileSync('git', ['fetch', 'origin'], {
        cwd: workDir,
        stdio: 'pipe',
        timeout: 30000,
      });
      execFileSync('git', ['checkout', 'main'], {
        cwd: workDir,
        stdio: 'pipe',
      });
      execFileSync('git', ['reset', '--hard', 'origin/main'], {
        cwd: workDir,
        stdio: 'pipe',
      });
    } catch {
      // Try default branch
      try {
        execFileSync('git', ['checkout', 'master'], {
          cwd: workDir,
          stdio: 'pipe',
        });
        execFileSync('git', ['reset', '--hard', 'origin/master'], {
          cwd: workDir,
          stdio: 'pipe',
        });
      } catch {
        // Fall through; the checked-out default branch may not be named master.
      }
    }
  }

  // Create branch
  try {
    execFileSync('git', ['checkout', '-B', branch], {
      cwd: workDir,
      stdio: 'pipe',
    });
  } catch {
    // Branch creation failures are captured later by the git/PR step.
  }

  // Build the prompt
  const prompt = `You are working on the repository ${project.owner}/${project.repo}.

Fix GitHub issue #${issueNumber}: ${issueTitle}

${issueBody}

Instructions:
1. Read the relevant code to understand the codebase
2. Implement a fix for this issue
3. Make minimal, focused changes — only what's needed to fix the issue
4. Do NOT commit — I will handle git operations after you're done
5. If you need to create new files, do so
6. If tests exist, make sure they still pass`;

  // Run Claude Code
  const proc = spawn(
    'claude',
    [
      '-p',
      '--model',
      usedModel,
      '--output-format',
      'text',
      '--dangerously-skip-permissions',
      '--max-budget-usd',
      '5',
      prompt,
    ],
    {
      cwd: workDir,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  proc.stdout?.on('data', (data: Buffer) => {
    job.output += data.toString();
    if (job.output.length > 500000) job.output = job.output.slice(-400000);
  });

  proc.stderr?.on('data', (data: Buffer) => {
    job.output += data.toString();
  });

  proc.on('close', async (code) => {
    if (code !== 0) {
      job.status = 'failed';
      job.output += `\n\nClaude Code exited with code ${code}`;
      job.completedAt = new Date().toISOString();
      const allJobs = loadJobs();
      const idx = allJobs.findIndex((j) => j.id === job.id);
      if (idx >= 0) allJobs[idx] = job;
      saveJobs(allJobs);
      return;
    }

    // Check if any files changed
    try {
      const diffOutput = execFileSync('git', ['diff', '--stat'], {
        cwd: workDir,
        encoding: 'utf-8',
      }).trim();
      const untrackedOutput = execFileSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        { cwd: workDir, encoding: 'utf-8' },
      ).trim();

      if (!diffOutput && !untrackedOutput) {
        job.status = 'completed';
        job.output +=
          '\n\nNo changes made — Claude determined no code changes were needed.';
        job.completedAt = new Date().toISOString();
        const allJobs = loadJobs();
        const idx = allJobs.findIndex((j) => j.id === job.id);
        if (idx >= 0) allJobs[idx] = job;
        saveJobs(allJobs);
        return;
      }

      // Stage, commit, push
      execFileSync('git', ['add', '-A'], { cwd: workDir, stdio: 'pipe' });
      execFileSync(
        'git',
        [
          'commit',
          '-m',
          `fix: ${issueTitle}\n\nResolves #${issueNumber}\n\nAutomated fix by NanoCrab autofix pipeline.`,
        ],
        { cwd: workDir, stdio: 'pipe' },
      );

      const token = getGitHubToken();
      const pushUrl = token
        ? `https://${token}@github.com/${project.owner}/${project.repo}.git`
        : 'origin';
      execFileSync('git', ['push', pushUrl, branch, '--force'], {
        cwd: workDir,
        stdio: 'pipe',
        timeout: 30000,
      });

      // Create PR
      const pr = await githubApi(
        `/repos/${project.owner}/${project.repo}/pulls`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: `fix: ${issueTitle}`,
            body: `## Automated Fix\n\nResolves #${issueNumber}\n\nThis PR was created automatically by the NanoCrab autofix pipeline using Claude Code (${usedModel}).\n\n### Changes\n\`\`\`\n${diffOutput}\n\`\`\``,
            head: branch,
            base: 'main',
          }),
        },
      );

      job.prUrl = pr.html_url;
      job.status = 'completed';
      job.output += `\n\nPR created: ${pr.html_url}`;

      // Comment on the issue
      try {
        await githubApi(
          `/repos/${project.owner}/${project.repo}/issues/${issueNumber}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              body: `🤖 **NanoCrab Autofix** — I've created a PR to fix this issue: ${pr.html_url}\n\nModel: \`${usedModel}\``,
            }),
          },
        );
      } catch {
        // Issue comments are best-effort and should not fail the completed job.
      }

      // Notify via bot if configured
      if (project.notifyJid) {
        try {
          const state = getState();
          await state.sendMessage(
            project.notifyJid,
            `🔧 *Autofix completed*\n\n` +
              `Repo: ${project.owner}/${project.repo}\n` +
              `Issue: #${issueNumber} — ${issueTitle}\n` +
              `PR: ${pr.html_url}\n` +
              `Model: ${usedModel}`,
          );
        } catch {
          // Bot notification is best-effort after the PR has already been created.
        }
      }

      logger.info(
        {
          repo: `${project.owner}/${project.repo}`,
          issue: issueNumber,
          pr: pr.html_url,
        },
        'Autofix completed',
      );
    } catch (err: any) {
      job.status = 'failed';
      job.output += `\n\nGit/PR error: ${err.message}`;
      logger.error({ err: err.message }, 'Autofix git/PR step failed');
    }

    job.completedAt = new Date().toISOString();
    const allJobs = loadJobs();
    const idx = allJobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) allJobs[idx] = job;
    saveJobs(allJobs);
  });

  return job;
}

// Manual trigger from dashboard
router.post('/run', async (req: Request, res: Response) => {
  const { projectId, issueNumber, actualRuntime } = req.body;
  if (!projectId || !issueNumber) {
    res.status(400).json({ error: 'projectId and issueNumber required' });
    return;
  }

  const projects = loadProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Fetch issue details
  try {
    const selectedProject = actualRuntime
      ? normalizeAutofixProject({ ...project, runtime: actualRuntime })
      : project;
    await assertAutofixRuntimeReady(selectedProject.runtime);
    const jobInput = buildAutofixStartInput(
      selectedProject,
      Number(issueNumber),
      req.user?.username || 'autofix-dashboard',
    );
    const job = await startCodingJob(jobInput);
    auditLog(
      req,
      'autofix_triggered',
      `${project.owner}/${project.repo}#${issueNumber}`,
    );
    res.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post(
  '/jobs/:id/approve-implementation',
  (req: Request, res: Response) => {
    try {
      const jobId = String(req.params.id);
      const job = approveCodingJob(
        jobId,
        req.user?.username || 'autofix-dashboard',
      );
      auditLog(req, 'autofix_implementation_approved', job.id);
      res.json({ ok: true, job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.post('/jobs/:id/deny-implementation', (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = denyCodingJob(
      jobId,
      req.user?.username || 'autofix-dashboard',
      typeof req.body?.note === 'string' ? req.body.note : undefined,
    );
    auditLog(req, 'autofix_implementation_denied', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/open-pr', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = await openCodingJobPr(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_pr_opened', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/approve-pr', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    approveCodingJobPr(jobId, req.user?.username || 'autofix-dashboard');
    const job = await openCodingJobPr(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_pr_approved', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/refresh-ci', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = await refreshCodingJobCi(jobId);
    auditLog(req, 'autofix_ci_refreshed', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = await retryCodingJob(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_job_retried', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/cancel', (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = cancelCodingJob(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_job_cancelled', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/revert', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = await revertCodingJob(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_job_revert_requested', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/jobs/:id/close-pr', async (req: Request, res: Response) => {
  try {
    const jobId = String(req.params.id);
    const job = await closeCodingJobPr(
      jobId,
      req.user?.username || 'autofix-dashboard',
    );
    auditLog(req, 'autofix_pr_closed', job.id);
    res.json({ ok: true, job });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// PR review
router.post('/review', async (req: Request, res: Response) => {
  const { projectId, prNumber, model } = req.body;
  if (!projectId || !prNumber) {
    res.status(400).json({ error: 'projectId and prNumber required' });
    return;
  }

  const projects = loadProjects();
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  try {
    const pr = await githubApi(
      `/repos/${project.owner}/${project.repo}/pulls/${prNumber}`,
    );
    const diff = await fetch(
      `https://api.github.com/repos/${project.owner}/${project.repo}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${getGitHubToken()}`,
          Accept: 'application/vnd.github.v3.diff',
        },
      },
    ).then((r) => r.text());

    const usedModel = model || project.model || 'sonnet';
    const prompt = `Review this pull request for ${project.owner}/${project.repo}.

PR #${prNumber}: ${pr.title}

${pr.body || '(no description)'}

Diff:
${diff.slice(0, 30000)}

Provide a concise code review. Focus on:
1. Correctness — does it fix what it claims?
2. Security — any vulnerabilities introduced?
3. Style — consistent with project conventions?
4. Edge cases — anything missed?

Output your review as markdown, ready to post as a GitHub comment.`;

    const proc = spawn(
      'claude',
      ['-p', '--model', usedModel, '--output-format', 'text', prompt],
      {
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      output += d.toString();
    });

    proc.on('close', async (code) => {
      if (code !== 0 || !output.trim()) {
        res
          .status(500)
          .json({ error: 'Review failed', output: output.slice(0, 500) });
        return;
      }

      // Post review as a comment
      try {
        await githubApi(
          `/repos/${project.owner}/${project.repo}/issues/${prNumber}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              body: `## 🤖 NanoCrab Code Review\n\n${output.trim()}\n\n---\n*Reviewed by Claude (${usedModel}) via NanoCrab autofix pipeline*`,
            }),
          },
        );
        res.json({ ok: true, review: output.trim() });
      } catch (err: any) {
        res.json({ ok: true, review: output.trim(), postError: err.message });
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Webhook handler (called from main webhook route) ---

export async function handleAutofixWebhook(payload: any): Promise<void> {
  const action = payload.action;
  const issue = payload.issue;
  const repo = payload.repository;
  const pr = payload.pull_request;

  if (!repo) return;
  const fullName = repo.full_name; // owner/repo
  const [owner, repoName] = fullName.split('/');

  const projects = loadProjects();
  const project = projects.find(
    (p) => p.owner === owner && p.repo === repoName,
  );
  if (!project) return;

  // Issue labeled with trigger label → autofix
  if (action === 'labeled' && issue) {
    const label = payload.label?.name;
    if (label === project.triggerLabel) {
      logger.info(
        { repo: fullName, issue: issue.number, label },
        'Autofix triggered by label',
      );
      try {
        if (!hasAutofixCapacity(project, loadCodingJobs())) {
          logger.info(
            {
              repo: fullName,
              issue: issue.number,
              maxActiveJobs: project.maxActiveJobs,
            },
            'Autofix webhook skipped because project active-job limit is reached',
          );
          return;
        }
        await assertAutofixRuntimeReady(project.runtime);
        await startCodingJob(
          buildAutofixStartInput(project, issue.number, 'github-webhook'),
        );
      } catch (err) {
        logger.warn(
          { err, repo: fullName, issue: issue.number },
          'Autofix webhook skipped coding job',
        );
      }
    }
  }

  // Issue opened with trigger label already set
  if (action === 'opened' && issue) {
    const hasLabel = issue.labels?.some(
      (l: any) => l.name === project.triggerLabel,
    );
    if (hasLabel) {
      logger.info(
        { repo: fullName, issue: issue.number },
        'Autofix triggered by new issue with label',
      );
      try {
        if (!hasAutofixCapacity(project, loadCodingJobs())) {
          logger.info(
            {
              repo: fullName,
              issue: issue.number,
              maxActiveJobs: project.maxActiveJobs,
            },
            'Autofix webhook skipped because project active-job limit is reached',
          );
          return;
        }
        await assertAutofixRuntimeReady(project.runtime);
        await startCodingJob(
          buildAutofixStartInput(project, issue.number, 'github-webhook'),
        );
      } catch (err) {
        logger.warn(
          { err, repo: fullName, issue: issue.number },
          'Autofix webhook skipped coding job',
        );
      }
    }
  }

  // PR opened → auto-review if enabled
  if (
    (action === 'opened' || action === 'synchronize') &&
    pr &&
    project.autoReview
  ) {
    // Don't review our own autofix PRs
    if (pr.head?.ref?.startsWith('autofix/')) return;
    logger.info({ repo: fullName, pr: pr.number }, 'Auto-reviewing PR');

    const usedModel = project.model || 'sonnet';
    const diff = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pr.number}`,
      {
        headers: {
          Authorization: `Bearer ${getGitHubToken()}`,
          Accept: 'application/vnd.github.v3.diff',
        },
      },
    ).then((r) => r.text());

    const prompt = `Review this PR for ${fullName}. PR #${pr.number}: ${pr.title}\n\n${pr.body || ''}\n\nDiff:\n${diff.slice(0, 30000)}\n\nProvide a concise code review in markdown.`;

    const proc = spawn(
      'claude',
      ['-p', '--model', usedModel, '--output-format', 'text', prompt],
      {
        env: { ...process.env, TERM: 'dumb' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let output = '';
    proc.stdout?.on('data', (d: Buffer) => {
      output += d.toString();
    });
    proc.on('close', async () => {
      if (!output.trim()) return;
      try {
        await githubApi(
          `/repos/${owner}/${repoName}/issues/${pr.number}/comments`,
          {
            method: 'POST',
            body: JSON.stringify({
              body: `## 🤖 NanoCrab Code Review\n\n${output.trim()}\n\n---\n*Auto-reviewed by Claude (${usedModel})*`,
            }),
          },
        );
      } catch {
        // PR review comments are best-effort; webhook processing should not retry forever.
      }
    });
  }
}

export default router;
