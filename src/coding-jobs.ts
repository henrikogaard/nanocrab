import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  CODING_WORKSPACE_DIR,
  CONTAINER_IMAGE,
  CREDENTIAL_PROXY_PORT,
  DATA_DIR,
  STORE_DIR,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import {
  AgentProvider,
  DEFAULT_AGENT_MODELS,
  getAgentProviderConfig,
  isAgentProvider,
} from './agent-provider.js';
import {
  CONTAINER_HOST_GATEWAY,
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
} from './container-runtime.js';
import { detectAuthMode } from './credential-proxy.js';
import { logger } from './logger.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  hasApprovedTarget,
  reviewApproval,
} from './approvals.js';
import { resolveProviderFallbackForAction } from './provider-router.js';
import { logAuditEvent } from './audit-log.js';
import { evaluatePolicy } from './policy-engine.js';

const CODING_REPOS_PATH = path.join(STORE_DIR, 'coding-repos.json');
const CODING_JOBS_PATH = path.join(STORE_DIR, 'coding-jobs.json');
const CODING_JOB_PROVIDERS = new Set<AgentProvider>([
  'claude',
  'codex',
  'opencode',
]);
type CodingProvider = Extract<AgentProvider, 'claude' | 'codex' | 'opencode'>;

export type CodingJobStatus =
  | 'queued'
  | 'investigate'
  | 'plan'
  | 'await_approval'
  | 'implement'
  | 'test'
  | 'await_pr_approval'
  | 'open_pr'
  | 'ci_running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface CodingJobTransition {
  from: CodingJobStatus;
  to: CodingJobStatus;
  at: string;
  failureReason?: string;
}

export interface CodingRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  labels: string[];
  assignee?: string;
  milestone?: string;
  autoPick?: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone: string | null;
  author: string;
  htmlUrl: string;
  updatedAt: string;
}

export interface CodingJob {
  id: string;
  repo: string;
  type: 'prompt' | 'issue';
  prompt: string;
  issueNumber: number | null;
  issueTitle: string | null;
  provider: CodingProvider;
  model: string;
  status: CodingJobStatus;
  branch: string;
  workspace: string;
  createPr: boolean;
  dryRun: boolean;
  prUrl: string | null;
  commitSha: string | null;
  changedFiles: string[];
  diffSummary: string | null;
  testSummary: string | null;
  ciStatus: 'unknown' | 'pending' | 'success' | 'failure';
  lastCiError: string | null;
  transitionedAt: Partial<Record<CodingJobStatus, string>>;
  transitionHistory: CodingJobTransition[];
  failureReason: string | null;
  approvalHistory: Array<{
    action: string;
    at: string;
    by: string;
    note?: string;
  }>;
  output: string;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface StartCodingJobInput {
  repo: string;
  prompt?: string;
  issueNumber?: number;
  provider?: string;
  model?: string;
  createPr?: boolean;
  dryRun?: boolean;
  branchName?: string;
  requestedBy: string;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function readTextFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function writeJsonFile<T>(filePath: string, value: T): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function nowIso(): string {
  return new Date().toISOString();
}

function getGitHubToken(): string | null {
  const env = readEnvFile(['GITHUB_TOKEN']);
  return process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || null;
}

function assertRepoFullName(fullName: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new Error('repo must be in owner/name format');
  }
}

function repoId(fullName: string): string {
  return fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function repoDirName(fullName: string): string {
  return fullName.replace('/', '__').replace(/[^A-Za-z0-9_.-]/g, '_');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function assertBranchName(branch: string): void {
  if (
    branch.length < 1 ||
    branch.length > 180 ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    throw new Error(`Invalid git branch name: ${branch}`);
  }
}

export function loadCodingRepos(): CodingRepo[] {
  return readJsonFile<CodingRepo[]>(CODING_REPOS_PATH, []);
}

export function saveCodingRepos(repos: CodingRepo[]): void {
  writeJsonFile(CODING_REPOS_PATH, repos);
}

export function loadCodingJobs(): CodingJob[] {
  return readJsonFile<CodingJob[]>(CODING_JOBS_PATH, []).map(ensureJobDefaults);
}

function saveCodingJobs(jobs: CodingJob[]): void {
  writeJsonFile(CODING_JOBS_PATH, jobs);
}

function upsertCodingJob(job: CodingJob): void {
  const jobs = loadCodingJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.push(job);
  saveCodingJobs(jobs);
}

function ensureJobDefaults(job: CodingJob): CodingJob {
  const defaults = {
    commitSha: null,
    changedFiles: [],
    diffSummary: null,
    testSummary: null,
    ciStatus: 'unknown',
    lastCiError: null,
    transitionedAt: {},
    transitionHistory: [],
    failureReason: null,
    approvalHistory: [],
    dryRun: false,
  };
  const normalized = { ...defaults, ...job };
  if (!normalized.transitionedAt[normalized.status]) {
    normalized.transitionedAt[normalized.status] =
      normalized.completedAt || normalized.createdAt || nowIso();
  }
  return normalized;
}

export async function githubApi(
  apiPath: string,
  opts: RequestInit = {},
): Promise<unknown> {
  const token = getGitHubToken();
  if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const response = await fetch(`https://api.github.com${apiPath}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...((opts.headers as Record<string, string>) || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function registerCodingRepo(input: {
  repo: string;
  defaultBranch?: string;
  labels?: string[];
}): Promise<CodingRepo> {
  assertRepoFullName(input.repo);
  const repos = loadCodingRepos();
  const existing = repos.find(
    (repo) => repo.fullName.toLowerCase() === input.repo.toLowerCase(),
  );
  const timestamp = nowIso();
  if (existing) {
    existing.defaultBranch = input.defaultBranch || existing.defaultBranch;
    existing.labels = input.labels || existing.labels;
    existing.enabled = true;
    existing.updatedAt = timestamp;
    saveCodingRepos(repos);
    return existing;
  }

  let defaultBranch = input.defaultBranch || 'main';
  try {
    const repoInfo = (await githubApi(`/repos/${input.repo}`)) as {
      default_branch?: string;
    };
    defaultBranch = repoInfo.default_branch || defaultBranch;
  } catch (err) {
    logger.warn(
      { err, repo: input.repo },
      'Could not read repo default branch',
    );
  }

  const repo: CodingRepo = {
    id: repoId(input.repo),
    fullName: input.repo,
    defaultBranch,
    labels: input.labels || [],
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  repos.push(repo);
  saveCodingRepos(repos);
  return repo;
}

export function getCodingRepo(fullName: string): CodingRepo | undefined {
  return loadCodingRepos().find(
    (repo) => repo.fullName.toLowerCase() === fullName.toLowerCase(),
  );
}

function isMilestoneApiValue(value: string): boolean {
  return value === '*' || value === 'none' || /^\d+$/.test(value);
}

async function resolveMilestoneQueryValue(
  repo: string,
  milestone?: string,
): Promise<string | undefined> {
  const value = milestone?.trim();
  if (!value) return undefined;
  if (isMilestoneApiValue(value)) return value;

  const milestones = (await githubApi(
    `/repos/${repo}/milestones?state=all&per_page=100`,
  )) as Array<{ number?: number; title?: string }>;
  const match = milestones.find((item) => item.title === value);
  return match?.number != null ? String(match.number) : undefined;
}

export async function listGitHubIssues(input: {
  repo: string;
  labels?: string[];
  assignee?: string;
  milestone?: string;
  issueNumber?: number;
  limit?: number;
}): Promise<GitHubIssueSummary[]> {
  assertRepoFullName(input.repo);
  const repo = getCodingRepo(input.repo);
  if (!repo?.enabled) {
    throw new Error(`Repo ${input.repo} is not registered for coding jobs`);
  }

  const labels = input.labels?.length ? input.labels : repo.labels;
  const milestoneQueryValue = input.issueNumber
    ? undefined
    : await resolveMilestoneQueryValue(input.repo, input.milestone);
  const milestoneTitleFilter =
    input.milestone && !isMilestoneApiValue(input.milestone)
      ? input.milestone
      : null;

  const summarizeIssue = (issue: {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    updated_at: string;
    pull_request?: unknown;
    labels?: Array<{ name: string } | string>;
    assignees?: Array<{ login: string }>;
    milestone?: { title?: string | null } | null;
    user?: { login: string };
  }): GitHubIssueSummary | null => {
    if (issue.pull_request) return null;
    const issueLabels = (issue.labels || []).map((label) =>
      typeof label === 'string' ? label : label.name,
    );
    const assignees = (issue.assignees || []).map((assignee) => assignee.login);
    const milestone = issue.milestone?.title || null;
    if (
      labels.length > 0 &&
      !labels.every((label) => issueLabels.includes(label))
    ) {
      return null;
    }
    if (input.assignee && !assignees.includes(input.assignee)) return null;
    if (milestoneTitleFilter && milestone !== milestoneTitleFilter) return null;
    if (input.milestone === 'none' && milestone !== null) return null;
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      labels: issueLabels,
      assignees,
      milestone,
      author: issue.user?.login || 'unknown',
      htmlUrl: issue.html_url,
      updatedAt: issue.updated_at,
    };
  };

  if (input.issueNumber) {
    const issue = (await githubApi(
      `/repos/${input.repo}/issues/${input.issueNumber}`,
    )) as Parameters<typeof summarizeIssue>[0];
    const summary = summarizeIssue(issue);
    return summary ? [summary] : [];
  }

  const params = new URLSearchParams({
    state: 'open',
    per_page: String(Math.min(Math.max(input.limit || 20, 1), 50)),
  });
  if (labels.length > 0) params.set('labels', labels.join(','));
  if (input.assignee) params.set('assignee', input.assignee);
  if (milestoneQueryValue) params.set('milestone', milestoneQueryValue);

  const issues = (await githubApi(
    `/repos/${input.repo}/issues?${params.toString()}`,
  )) as Array<{
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    updated_at: string;
    pull_request?: unknown;
    labels?: Array<{ name: string } | string>;
    assignees?: Array<{ login: string }>;
    milestone?: { title?: string | null } | null;
    user?: { login: string };
  }>;

  return issues
    .map((issue) => summarizeIssue(issue))
    .filter((issue): issue is GitHubIssueSummary => issue !== null);
}

function isCodingProvider(provider: AgentProvider): provider is CodingProvider {
  return CODING_JOB_PROVIDERS.has(provider);
}

function codingProvider(inputProvider?: string): CodingProvider {
  if (inputProvider && isAgentProvider(inputProvider)) {
    if (isCodingProvider(inputProvider)) return inputProvider;
    throw new Error(`${inputProvider} is not a coding-job runtime`);
  }
  const config = getAgentProviderConfig();
  return isCodingProvider(config.provider) ? config.provider : 'claude';
}

function defaultModelForProvider(provider: CodingProvider): string {
  const config = getAgentProviderConfig();
  return config.modelsByProvider[provider] || DEFAULT_AGENT_MODELS[provider];
}

const CODING_JOB_TRANSITIONS: Record<CodingJobStatus, CodingJobStatus[]> = {
  queued: ['investigate', 'cancelled', 'failed'],
  investigate: ['plan', 'cancelled', 'failed'],
  plan: ['await_approval', 'cancelled', 'failed'],
  await_approval: ['implement', 'cancelled', 'failed'],
  implement: ['test', 'cancelled', 'failed'],
  test: ['await_pr_approval', 'completed', 'cancelled', 'failed'],
  await_pr_approval: ['open_pr', 'cancelled', 'failed'],
  open_pr: ['ci_running', 'cancelled', 'failed'],
  ci_running: ['completed', 'cancelled', 'failed'],
  completed: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

function failTransition(job: CodingJob, reason: string): never {
  job.failureReason = reason;
  upsertCodingJob(job);
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'coding.transition',
    resource: job.id,
    decision: 'error',
    correlationId: job.id,
    error: reason,
    context: { status: job.status },
  });
  throw new Error(reason);
}

function applyCodingJobTransition(
  job: CodingJob,
  to: CodingJobStatus,
  failureReason?: string,
): CodingJob {
  const from = job.status;
  if (!CODING_JOB_TRANSITIONS[from]?.includes(to)) {
    return failTransition(
      job,
      `Invalid coding job transition: ${from} -> ${to}`,
    );
  }
  if (
    to === 'implement' &&
    !job.dryRun &&
    !hasApprovedTarget('coding-implement', 'coding-job', job.id)
  ) {
    return failTransition(job, 'Implementation approval is required');
  }
  if (
    to === 'open_pr' &&
    !job.dryRun &&
    !hasApprovedTarget('coding-open-pr', 'coding-job', job.id)
  ) {
    return failTransition(job, 'PR approval is required');
  }

  const at = nowIso();
  job.status = to;
  job.transitionedAt[to] = at;
  job.transitionHistory.push({ from, to, at, failureReason });
  job.failureReason = failureReason || null;
  if (to === 'completed' || to === 'failed' || to === 'cancelled') {
    job.completedAt = at;
  }
  upsertCodingJob(job);
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'coding.transition',
    resource: job.id,
    decision: job.dryRun ? 'simulated' : failureReason ? 'error' : 'allowed',
    correlationId: job.id,
    error: failureReason,
    context: {
      from,
      to,
      repo: job.repo,
      branch: job.branch,
      dryRun: job.dryRun,
    },
  });
  return job;
}

export function transitionCodingJob(
  jobId: string,
  to: CodingJobStatus,
  failureReason?: string,
): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  return applyCodingJobTransition(job, to, failureReason);
}

function updateJobOutput(job: CodingJob, text: string): void {
  job.output += text;
  if (job.output.length > 800000) job.output = job.output.slice(-650000);
  upsertCodingJob(job);
}

function buildCodingPrompt(job: CodingJob): string {
  const prompt = [
    `You are working in the cloned repository ${job.repo}.`,
    job.issueNumber
      ? `Fix GitHub issue #${job.issueNumber}: ${job.issueTitle || ''}`
      : 'Complete the requested coding task.',
    job.prompt,
    'Instructions:',
    '1. Inspect the repository before editing.',
    '2. Make focused changes only.',
    '3. Run relevant tests if the repo makes that practical.',
    '4. Do not commit, push, or create a PR yourself; NanoCrab will handle git after you finish.',
    '5. Leave a concise summary of what changed and any tests run.',
  ].join('\n\n');
  return prompt;
}

function writeDockerEnvFile(env: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join('/tmp', 'nanocrab-coding-env-'));
  const envFilePath = path.join(dir, 'env');
  const lines = Object.entries(env).map(([key, value]) => {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error(`Environment variable ${key} contains a newline`);
    }
    return `${key}=${value}`;
  });
  fs.writeFileSync(envFilePath, `${lines.join('\n')}\n`, { mode: 0o600 });
  return envFilePath;
}

function removeDockerEnvFile(envFilePath?: string): void {
  if (!envFilePath) return;
  try {
    fs.rmSync(path.dirname(envFilePath), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ envFilePath, err }, 'Failed to remove coding env file');
  }
}

function envValue(
  env: Record<string, string | undefined>,
  key: string,
): string | undefined {
  return process.env[key] || env[key];
}

function buildCodingContainerEnv(
  job: CodingJob,
  repo: CodingRepo,
): Record<string, string> {
  assertBranchName(repo.defaultBranch);
  assertBranchName(job.branch);

  const envFileValues = readEnvFile([
    'GITHUB_TOKEN',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'CODING_JOB_MAX_BUDGET_USD',
    'OPENCODE_API_KEY',
  ]);
  const env: Record<string, string> = {
    TZ: TIMEZONE,
    TERM: 'dumb',
    HOME: '/home/node',
    GITHUB_REPO: job.repo,
    DEFAULT_BRANCH: repo.defaultBranch,
    REPO_DIR: repoDirName(job.repo),
    JOB_BRANCH: job.branch,
    JOB_PROVIDER: job.provider,
    JOB_MODEL: job.model,
    CREATE_PR: 'false',
    CODING_JOB_MAX_BUDGET_USD:
      envValue(envFileValues, 'CODING_JOB_MAX_BUDGET_USD') || '5',
    GIT_AUTHOR_NAME:
      envValue(envFileValues, 'GIT_AUTHOR_NAME') || 'NanoCrab Bot',
    GIT_AUTHOR_EMAIL:
      envValue(envFileValues, 'GIT_AUTHOR_EMAIL') || 'nanocrab@localhost',
    DEFAULT_PROVIDER: job.provider,
    DEFAULT_MODEL: job.model,
  };

  const githubToken = getGitHubToken();
  if (githubToken) {
    env.GITHUB_TOKEN = githubToken;
    env.GIT_ASKPASS = '/workspace/coding-job/.nanocrab/git-askpass.sh';
  }
  env.GIT_TERMINAL_PROMPT = '0';

  if (job.provider === 'claude') {
    env.ANTHROPIC_BASE_URL = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}`;
    if (detectAuthMode() === 'api-key') {
      env.ANTHROPIC_API_KEY = 'placeholder';
    } else {
      env.CLAUDE_CODE_OAUTH_TOKEN = 'placeholder';
    }
  }

  const opencodeKey = envValue(envFileValues, 'OPENCODE_API_KEY');
  if (job.provider === 'opencode' && opencodeKey) {
    env.OPENCODE_API_KEY = opencodeKey;
  }

  return env;
}

function writeCodingJobFiles(job: CodingJob, repo: CodingRepo): string {
  const jobRoot = path.dirname(job.workspace);
  const metadataDir = path.join(jobRoot, '.nanocrab');
  fs.mkdirSync(metadataDir, { recursive: true });
  fs.writeFileSync(
    path.join(metadataDir, 'prompt.txt'),
    `${buildCodingPrompt(job)}\n`,
  );
  const commitTitle = job.issueNumber
    ? `fix: ${job.issueTitle || `issue ${job.issueNumber}`}`
    : `chore: ${slug(job.prompt).replace(/-/g, ' ') || 'coding job'}`;
  fs.writeFileSync(
    path.join(metadataDir, 'commit-message.txt'),
    [
      commitTitle,
      '',
      job.issueNumber ? `Resolves #${job.issueNumber}` : '',
      '',
      `Automated by NanoCrab coding job ${job.id}.`,
      '',
    ]
      .filter((line, index, lines) => line || lines[index - 1] !== '')
      .join('\n'),
  );
  fs.writeFileSync(
    path.join(metadataDir, 'git-askpass.sh'),
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*) echo "x-access-token" ;;',
      '  *) printf "%s" "$GITHUB_TOKEN" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(metadataDir, 'run.sh'),
    [
      '#!/bin/bash',
      'set -euo pipefail',
      'cd /workspace/coding-job',
      'chmod 700 .nanocrab/git-askpass.sh 2>/dev/null || true',
      'if [ ! -d "$REPO_DIR/.git" ]; then',
      '  rm -rf "$REPO_DIR"',
      '  git clone --depth 50 "https://github.com/${GITHUB_REPO}.git" "$REPO_DIR"',
      'fi',
      'cd "$REPO_DIR"',
      'git config --global --add safe.directory "$PWD" 2>/dev/null || true',
      'git fetch origin "$DEFAULT_BRANCH" --depth 50',
      'git checkout -B "$DEFAULT_BRANCH" "origin/$DEFAULT_BRANCH"',
      'git checkout -B "$JOB_BRANCH"',
      'PROMPT="$(cat /workspace/coding-job/.nanocrab/prompt.txt)"',
      'case "$JOB_PROVIDER" in',
      '  codex)',
      '    codex --ask-for-approval never exec --model "$JOB_MODEL" --sandbox danger-full-access --cd "$PWD" --skip-git-repo-check --color never "$PROMPT"',
      '    ;;',
      '  opencode)',
      '    opencode run --model "$JOB_MODEL" "$PROMPT"',
      '    ;;',
      '  claude)',
      '    claude -p --model "$JOB_MODEL" --output-format text --dangerously-skip-permissions --max-budget-usd "$CODING_JOB_MAX_BUDGET_USD" "$PROMPT"',
      '    ;;',
      '  *)',
      '    echo "Unsupported coding provider: $JOB_PROVIDER" >&2',
      '    exit 2',
      '    ;;',
      'esac',
      'git diff --stat HEAD > /workspace/coding-job/.nanocrab/diff-stat.txt',
      'git diff --name-only HEAD > /workspace/coding-job/.nanocrab/changed-files.txt',
      'git ls-files --others --exclude-standard > /workspace/coding-job/.nanocrab/untracked.txt',
      'printf "Review job output for tests run by the coding agent.\\n" > /workspace/coding-job/.nanocrab/test-summary.txt',
      '',
    ].join('\n'),
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(metadataDir, 'repo-default-branch.txt'),
    repo.defaultBranch,
  );
  return jobRoot;
}

function codingContainerMounts(job: CodingJob): Array<{
  hostPath: string;
  containerPath: string;
}> {
  const mounts = [
    {
      hostPath: path.dirname(job.workspace),
      containerPath: '/workspace/coding-job',
    },
  ];
  const codexDir = path.join(DATA_DIR, 'codex');
  const opencodeConfigDir = path.join(DATA_DIR, 'opencode', 'config');
  const opencodeDataDir = path.join(DATA_DIR, 'opencode', 'data');
  const claudeDir = path.join(DATA_DIR, 'sessions', job.requestedBy, '.claude');
  for (const dir of [codexDir, opencodeConfigDir, opencodeDataDir, claudeDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  mounts.push({ hostPath: codexDir, containerPath: '/home/node/.codex' });
  mounts.push({
    hostPath: opencodeConfigDir,
    containerPath: '/home/node/.config/opencode',
  });
  mounts.push({
    hostPath: opencodeDataDir,
    containerPath: '/home/node/.local/share/opencode',
  });
  mounts.push({ hostPath: claudeDir, containerPath: '/home/node/.claude' });
  return mounts;
}

function runCodingContainer(job: CodingJob, repo: CodingRepo): Promise<number> {
  const policy = evaluatePolicy({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'coding.implement',
    resource: job.repo,
    dryRun: job.dryRun,
    context: { branch: job.branch, provider: job.provider, model: job.model },
  });
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'coding.implement',
    resource: job.repo,
    decision: job.dryRun ? 'simulated' : 'approved',
    correlationId: job.id,
    context: policy,
  });
  if (policy.decision === 'denied') {
    throw new Error(
      `Coding implementation denied by policy: ${policy.explanation}`,
    );
  }
  const jobRoot = writeCodingJobFiles(job, repo);
  const envFilePath = writeDockerEnvFile(buildCodingContainerEnv(job, repo));
  const safeName = job.id.replace(/[^a-zA-Z0-9_.-]/g, '-');
  const containerName = `nanocrab-code-${safeName}`;
  const args: string[] = ['run', '--rm', '--name', containerName];
  args.push(...hostGatewayArgs());

  const hostUid = process.getuid?.();
  const hostGid = process.getgid?.();
  if (hostUid != null && hostUid !== 0 && hostUid !== 1000) {
    args.push('--user', `${hostUid}:${hostGid}`);
  }

  for (const mount of codingContainerMounts(job)) {
    args.push('-v', `${mount.hostPath}:${mount.containerPath}`);
  }
  args.push('--env-file', envFilePath);
  args.push(
    '--memory',
    process.env.CODING_JOB_CONTAINER_MEMORY_LIMIT ||
      process.env.CONTAINER_MEMORY_LIMIT ||
      '4g',
  );
  args.push(
    '--cpus',
    process.env.CODING_JOB_CONTAINER_CPUS ||
      process.env.CONTAINER_CPU_LIMIT ||
      '2',
  );
  args.push('--entrypoint', '/bin/bash');
  args.push(CONTAINER_IMAGE);
  args.push('/workspace/coding-job/.nanocrab/run.sh');

  updateJobOutput(
    job,
    `\n\nStarting coding container ${containerName} with workspace ${jobRoot}\n`,
  );
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'container.spawn',
    resource: job.repo,
    decision: 'allowed',
    correlationId: job.id,
    context: {
      containerName,
      workspace: jobRoot,
      mounts: codingContainerMounts(job).map((mount) => mount.containerPath),
    },
  });

  return new Promise((resolve, reject) => {
    const proc = spawn(CONTAINER_RUNTIME_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.on('data', (data: Buffer) => {
      updateJobOutput(job, data.toString());
    });
    proc.stderr?.on('data', (data: Buffer) => {
      updateJobOutput(job, data.toString());
    });
    proc.on('error', (err) => {
      removeDockerEnvFile(envFilePath);
      reject(err);
    });
    proc.on('close', (code) => {
      removeDockerEnvFile(envFilePath);
      resolve(code ?? 1);
    });
  });
}

function requirePrProviderFallbackApproval(
  job: CodingJob,
  requester: string,
): boolean {
  const fallback = resolveProviderFallbackForAction({
    purpose: 'default_coding',
    action: 'pr-creation',
    requester,
    correlationId: job.id,
  });
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'provider.fallback',
    resource: job.repo,
    decision: fallback.approved ? 'approved' : 'requires_approval',
    correlationId: job.id,
    context: {
      action: 'pr-creation',
      requester,
      ...(fallback.approved
        ? { provider: fallback.provider, model: fallback.model }
        : { reason: fallback.reason, approvalId: fallback.approvalId }),
    },
  });
  if (fallback.approved) return true;
  job.status = 'await_pr_approval';
  updateJobOutput(
    job,
    `\n\nProvider fallback for PR creation is awaiting approval: ${fallback.reason}${fallback.approvalId ? ` (${fallback.approvalId})` : ''}\n`,
  );
  upsertCodingJob(job);
  return false;
}

async function runCodingJob(job: CodingJob): Promise<void> {
  const repo = getCodingRepo(job.repo);
  if (!repo?.enabled) throw new Error(`Repo ${job.repo} is not registered`);

  if (job.status === 'queued') {
    applyCodingJobTransition(job, 'investigate');
    updateJobOutput(job, '\n\nInvestigating repository and issue context.\n');
  }

  if (job.status === 'investigate') {
    applyCodingJobTransition(job, 'plan');
    updateJobOutput(
      job,
      [
        '\n\nImplementation plan:',
        `- Prepare isolated workspace for ${job.repo}.`,
        job.issueNumber
          ? `- Fix GitHub issue #${job.issueNumber}: ${job.issueTitle || 'untitled issue'}.`
          : '- Complete the requested coding task.',
        '- Run the coding provider in a local workspace and capture diff/test output.',
        job.createPr
          ? '- Wait for PR approval before committing, pushing, and opening a pull request.'
          : '- Keep changes local for dashboard review.',
        '',
      ].join('\n'),
    );
  }

  if (job.status === 'plan') {
    applyCodingJobTransition(job, 'await_approval');
  }

  if (job.dryRun) {
    const policy = evaluatePolicy({
      actor: job.requestedBy,
      actorId: job.id,
      actionType: 'coding.implement',
      resource: job.repo,
      dryRun: true,
      context: { branch: job.branch, createPr: job.createPr },
    });
    if (policy.decision === 'denied') {
      throw new Error(`Dry-run denied by policy: ${policy.explanation}`);
    }
    updateJobOutput(
      job,
      [
        '\n\nDry-run simulation:',
        `- Classified implementation as ${policy.risk} risk.`,
        '- Skipped container spawn and external repository writes.',
        job.createPr
          ? '- Simulated pull request creation without GitHub API calls.'
          : '',
        '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
    logAuditEvent({
      actor: job.requestedBy,
      actorId: job.id,
      actionType: 'coding.implement',
      resource: job.repo,
      decision: 'simulated',
      correlationId: job.id,
      context: policy,
    });
    applyCodingJobTransition(job, 'implement');
    applyCodingJobTransition(job, 'test');
    job.diffSummary = 'Dry-run only; no files were modified.';
    job.testSummary = 'Dry-run simulation; tests were not executed.';
    job.changedFiles = [];
    if (job.createPr) {
      logAuditEvent({
        actor: job.requestedBy,
        actorId: job.id,
        actionType: 'coding.open_pr',
        resource: job.repo,
        decision: 'simulated',
        correlationId: job.id,
        context: { branch: job.branch, dryRun: true },
      });
    }
    applyCodingJobTransition(job, 'completed');
    upsertCodingJob(job);
    return;
  }

  const fallback = resolveProviderFallbackForAction({
    purpose: 'default_coding',
    action: 'coding-implementation',
    requester: job.requestedBy,
    correlationId: job.id,
  });
  logAuditEvent({
    actor: job.requestedBy,
    actorId: job.id,
    actionType: 'provider.fallback',
    resource: job.repo,
    decision: fallback.approved ? 'approved' : 'requires_approval',
    correlationId: job.id,
    context: {
      action: 'coding-implementation',
      ...(fallback.approved
        ? { provider: fallback.provider, model: fallback.model }
        : { reason: fallback.reason, approvalId: fallback.approvalId }),
    },
  });
  if (!fallback.approved) {
    updateJobOutput(
      job,
      `\n\nProvider fallback is awaiting approval: ${fallback.reason}${fallback.approvalId ? ` (${fallback.approvalId})` : ''}\n`,
    );
    upsertCodingJob(job);
    return;
  }
  if (fallback.provider && fallback.provider !== job.provider) {
    if (!isCodingProvider(fallback.provider)) {
      throw new Error(`${fallback.provider} is not a coding-job runtime`);
    }
    updateJobOutput(
      job,
      `\n\nUsing approved provider fallback ${job.provider}/${job.model} -> ${fallback.provider}/${fallback.model}\n`,
    );
    job.provider = fallback.provider;
    job.model = fallback.model;
    upsertCodingJob(job);
  }

  if (
    job.status === 'await_approval' &&
    !hasApprovedTarget('coding-implement', 'coding-job', job.id)
  ) {
    const pending = findPendingApprovalForTarget(
      'coding-implement',
      'coding-job',
      job.id,
    );
    if (!pending) {
      createApproval({
        kind: 'coding-implement',
        title: `Approve implementation for ${job.repo}`,
        summary: `Approve running a coding agent for ${job.repo} on branch ${job.branch}.\n\n${job.issueNumber ? `Issue #${job.issueNumber}: ${job.issueTitle || ''}` : job.prompt.slice(0, 1000)}`,
        risk: 'high',
        requester: job.requestedBy,
        targetType: 'coding-job',
        targetId: job.id,
        payload: { jobId: job.id, repo: job.repo, branch: job.branch },
      });
    }
    updateJobOutput(job, '\n\nImplementation is awaiting approval.\n');
    upsertCodingJob(job);
    return;
  }

  if (job.status === 'await_approval') {
    applyCodingJobTransition(job, 'implement');
  }
  const exitCode = await runCodingContainer(job, repo);
  if (exitCode !== 0) {
    throw new Error(
      `${job.provider} coding container exited with code ${exitCode}`,
    );
  }
  applyCodingJobTransition(job, 'test');

  const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
  const diffStat = readTextFile(path.join(metadataDir, 'diff-stat.txt'));
  const changedFiles = readTextFile(
    path.join(metadataDir, 'changed-files.txt'),
  );
  const untracked = readTextFile(path.join(metadataDir, 'untracked.txt'));
  const testSummary = readTextFile(path.join(metadataDir, 'test-summary.txt'));
  if (!diffStat && !untracked) {
    updateJobOutput(job, '\n\nNo repository changes were produced.\n');
    applyCodingJobTransition(job, 'completed');
    upsertCodingJob(job);
    return;
  }

  updateJobOutput(
    job,
    `\n\nDiff stat:\n${diffStat || '(untracked files only)'}\n`,
  );
  job.diffSummary = diffStat || '(untracked files only)';
  job.changedFiles = Array.from(
    new Set(
      [
        ...changedFiles.split('\n'),
        ...untracked.split('\n'),
        ...diffStat.split('\n').map((line) => line.split('|')[0]?.trim()),
      ].filter(Boolean),
    ),
  );
  job.testSummary =
    testSummary || 'See job output for tests run by the coding agent.';
  if (!job.createPr) {
    applyCodingJobTransition(job, 'completed');
    upsertCodingJob(job);
    return;
  }

  if (job.status === 'test') {
    applyCodingJobTransition(job, 'await_pr_approval');
  }
  if (!hasApprovedTarget('coding-open-pr', 'coding-job', job.id)) {
    const pending = findPendingApprovalForTarget(
      'coding-open-pr',
      'coding-job',
      job.id,
    );
    if (!pending) {
      createApproval({
        kind: 'coding-open-pr',
        title: `Open PR for ${job.repo}`,
        summary: `Approve opening a pull request for ${job.branch}.\n\n${diffStat}`,
        risk: 'high',
        requester: job.requestedBy,
        targetType: 'coding-job',
        targetId: job.id,
        payload: { jobId: job.id, repo: job.repo, branch: job.branch },
      });
    }
    upsertCodingJob(job);
    updateJobOutput(job, '\n\nPR creation is awaiting approval.\n');
    return;
  }
  updateJobOutput(
    job,
    '\n\nPR approval is recorded. Use Open PR to publish.\n',
  );
  upsertCodingJob(job);
}

export async function startCodingJob(
  input: StartCodingJobInput,
): Promise<CodingJob> {
  assertRepoFullName(input.repo);
  const repo = getCodingRepo(input.repo);
  if (!repo?.enabled) {
    throw new Error(`Repo ${input.repo} is not registered for coding jobs`);
  }

  const provider = codingProvider(input.provider);
  const model = input.model || defaultModelForProvider(provider);
  let prompt = input.prompt || '';
  let issueTitle: string | null = null;
  let issueNumber = input.issueNumber || null;

  if (issueNumber) {
    const issue = (await githubApi(
      `/repos/${input.repo}/issues/${issueNumber}`,
    )) as {
      title: string;
      body?: string | null;
      pull_request?: unknown;
    };
    if (issue.pull_request)
      throw new Error(`#${issueNumber} is a pull request`);
    issueTitle = issue.title;
    prompt = [
      prompt,
      `Issue title: ${issue.title}`,
      `Issue body:\n${issue.body || '(no body)'}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (!prompt.trim()) throw new Error('prompt or issueNumber is required');

  const id = `code-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const branch =
    input.branchName ||
    `nanocrab/${issueNumber ? `issue-${issueNumber}` : slug(prompt) || 'task'}-${id.slice(-8)}`;
  assertBranchName(branch);
  if (input.createPr === true && !getGitHubToken()) {
    throw new Error('GITHUB_TOKEN is required to create pull requests');
  }
  const workspace = path.join(
    CODING_WORKSPACE_DIR,
    'jobs',
    id,
    repoDirName(input.repo),
  );
  const job: CodingJob = {
    id,
    repo: input.repo,
    type: issueNumber ? 'issue' : 'prompt',
    prompt,
    issueNumber,
    issueTitle,
    provider,
    model,
    status: 'queued',
    branch,
    workspace,
    createPr: input.createPr === true,
    dryRun: input.dryRun === true,
    prUrl: null,
    commitSha: null,
    changedFiles: [],
    diffSummary: null,
    testSummary: null,
    ciStatus: 'unknown',
    lastCiError: null,
    transitionedAt: { queued: nowIso() },
    transitionHistory: [],
    failureReason: null,
    approvalHistory: [],
    output: '',
    requestedBy: input.requestedBy,
    createdAt: nowIso(),
    completedAt: null,
  };
  upsertCodingJob(job);

  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      const failureReason = err instanceof Error ? err.message : String(err);
      applyCodingJobTransition(job, 'failed', failureReason);
      updateJobOutput(job, `\n\nCoding job failed: ${failureReason}\n`);
      logger.error({ err, jobId: job.id }, 'Coding job failed');
    });
  });

  return job;
}

export async function pickGitHubIssue(input: {
  repo: string;
  labels?: string[];
  provider?: string;
  model?: string;
  assignee?: string;
  milestone?: string;
  issueNumber?: number;
  createPr?: boolean;
  requestedBy: string;
}): Promise<{ issue: GitHubIssueSummary; job: CodingJob } | null> {
  const issues = await listGitHubIssues({
    repo: input.repo,
    labels: input.labels,
    assignee: input.assignee,
    milestone: input.milestone,
    issueNumber: input.issueNumber,
    limit: 10,
  });
  if (issues.length === 0) return null;
  const issue = issues[0];
  const job = await startCodingJob({
    repo: input.repo,
    issueNumber: issue.number,
    provider: input.provider,
    model: input.model,
    createPr: input.createPr,
    requestedBy: input.requestedBy,
  });
  return { issue, job };
}

export function getCodingJob(jobId: string): CodingJob | undefined {
  return loadCodingJobs().find((job) => job.id === jobId);
}

function recordJobApproval(
  job: CodingJob,
  action: string,
  by: string,
  note?: string,
): void {
  job.approvalHistory.push({ action, by, at: nowIso(), note });
}

export function cancelCodingJob(jobId: string, by = 'dashboard'): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  recordJobApproval(job, 'cancel', by);
  applyCodingJobTransition(job, 'cancelled');
  upsertCodingJob(job);
  return job;
}

export async function retryCodingJob(
  jobId: string,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (job.status !== 'failed' && job.status !== 'cancelled') {
    throw new Error(`Cannot retry coding job from ${job.status}`);
  }
  applyCodingJobTransition(job, 'queued');
  job.completedAt = null;
  job.output += '\n\nRetry requested.\n';
  recordJobApproval(job, 'retry', by);
  upsertCodingJob(job);
  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      const failureReason = err instanceof Error ? err.message : String(err);
      applyCodingJobTransition(job, 'failed', failureReason);
      updateJobOutput(job, `\n\nCoding job failed: ${failureReason}\n`);
    });
  });
  return job;
}

export function approveCodingJob(jobId: string, by = 'dashboard'): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (
    [
      'implement',
      'test',
      'await_pr_approval',
      'open_pr',
      'ci_running',
    ].includes(job.status)
  ) {
    return job;
  }
  if (job.status !== 'await_approval') {
    throw new Error(`Cannot approve implementation from ${job.status}`);
  }
  const pending = findPendingApprovalForTarget(
    'coding-implement',
    'coding-job',
    job.id,
  );
  if (pending) {
    reviewApproval(pending.id, 'approved', by);
  } else if (!hasApprovedTarget('coding-implement', 'coding-job', job.id)) {
    const approval = createApproval({
      kind: 'coding-implement',
      title: `Approve implementation for ${job.repo}`,
      summary: `Approve running a coding agent for ${job.repo} on branch ${job.branch}.`,
      risk: 'high',
      requester: by,
      targetType: 'coding-job',
      targetId: job.id,
      payload: { jobId: job.id, repo: job.repo, branch: job.branch },
    });
    reviewApproval(approval.id, 'approved', by);
  }
  recordJobApproval(job, 'approve-implementation', by);
  applyCodingJobTransition(job, 'implement');
  setImmediate(() => {
    const latest = getCodingJob(job.id);
    if (!latest) return;
    void runCodingJob(latest).catch((err) => {
      const failureReason = err instanceof Error ? err.message : String(err);
      applyCodingJobTransition(latest, 'failed', failureReason);
      updateJobOutput(latest, `\n\nCoding job failed: ${failureReason}\n`);
    });
  });
  return job;
}

export function denyCodingJob(
  jobId: string,
  by = 'dashboard',
  note?: string,
): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (job.status !== 'await_approval') {
    throw new Error(`Cannot deny implementation from ${job.status}`);
  }
  const pending = findPendingApprovalForTarget(
    'coding-implement',
    'coding-job',
    job.id,
  );
  if (pending) reviewApproval(pending.id, 'denied', by, note);
  recordJobApproval(job, 'deny-implementation', by, note);
  applyCodingJobTransition(job, 'cancelled', note || 'Implementation denied');
  upsertCodingJob(job);
  return job;
}

export function approveCodingJobPr(jobId: string, by = 'dashboard'): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (job.status !== 'await_pr_approval') {
    throw new Error(`Cannot approve PR from ${job.status}`);
  }
  const pending = findPendingApprovalForTarget(
    'coding-open-pr',
    'coding-job',
    job.id,
  );
  if (pending) {
    reviewApproval(pending.id, 'approved', by);
  } else if (!hasApprovedTarget('coding-open-pr', 'coding-job', job.id)) {
    const approval = createApproval({
      kind: 'coding-open-pr',
      title: `Open PR for ${job.repo}`,
      summary: `Approve committing, pushing, and opening a pull request for ${job.branch}.`,
      risk: 'high',
      requester: by,
      targetType: 'coding-job',
      targetId: job.id,
      payload: { jobId: job.id, repo: job.repo, branch: job.branch },
    });
    reviewApproval(approval.id, 'approved', by);
  }
  recordJobApproval(job, 'approve-pr', by);
  upsertCodingJob(job);
  return job;
}

export async function openCodingJobPr(
  jobId: string,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  const repo = getCodingRepo(job.repo);
  if (!repo) throw new Error(`Repo not found: ${job.repo}`);
  if (job.status !== 'await_pr_approval') {
    throw new Error(`Cannot open PR from ${job.status}`);
  }
  if (job.dryRun) {
    logAuditEvent({
      actor: by,
      actorId: job.id,
      actionType: 'coding.open_pr',
      resource: job.repo,
      decision: 'simulated',
      correlationId: job.id,
      context: { branch: job.branch },
    });
    applyCodingJobTransition(job, 'completed');
    upsertCodingJob(job);
    return job;
  }
  if (!hasApprovedTarget('coding-open-pr', 'coding-job', job.id)) {
    const pending = findPendingApprovalForTarget(
      'coding-open-pr',
      'coding-job',
      job.id,
    );
    if (!pending) {
      createApproval({
        kind: 'coding-open-pr',
        title: `Open PR for ${job.repo}`,
        summary: `Approve opening a pull request for branch ${job.branch}.`,
        risk: 'high',
        requester: by,
        targetType: 'coding-job',
        targetId: job.id,
        payload: { jobId: job.id, repo: job.repo, branch: job.branch },
      });
    }
    job.failureReason = 'PR approval is required';
    upsertCodingJob(job);
    throw new Error('PR approval is required');
  }
  if (!requirePrProviderFallbackApproval(job, by)) {
    return job;
  }
  const policy = evaluatePolicy({
    actor: by,
    actorId: job.id,
    actionType: 'coding.open_pr',
    resource: job.repo,
    context: { branch: job.branch, changedFiles: job.changedFiles },
  });
  logAuditEvent({
    actor: by,
    actorId: job.id,
    actionType: 'coding.open_pr',
    resource: job.repo,
    decision: policy.decision === 'denied' ? 'denied' : 'approved',
    correlationId: job.id,
    context: policy,
  });
  if (policy.decision === 'denied') {
    throw new Error(`PR creation denied by policy: ${policy.explanation}`);
  }
  applyCodingJobTransition(job, 'open_pr');

  try {
    const repoPath = job.workspace;
    const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
    const diffStat = readTextFile(path.join(metadataDir, 'diff-stat.txt'));
    const changedFiles = readTextFile(
      path.join(metadataDir, 'changed-files.txt'),
    );
    const untracked = readTextFile(path.join(metadataDir, 'untracked.txt'));
    const testSummary = readTextFile(
      path.join(metadataDir, 'test-summary.txt'),
    );
    const commitMessage =
      readTextFile(path.join(metadataDir, 'commit-message.txt')) ||
      `chore: NanoCrab coding job ${job.id}`;
    const { execFileSync } = await import('child_process');
    execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', commitMessage], {
      cwd: repoPath,
      stdio: 'pipe',
    });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();
    execFileSync(
      'git',
      [
        'push',
        'origin',
        `${job.branch}:refs/heads/${job.branch}`,
        '--force-with-lease',
      ],
      {
        cwd: repoPath,
        stdio: 'pipe',
      },
    );
    const pr = (await githubApi(`/repos/${job.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: job.issueNumber
          ? `fix: ${job.issueTitle || `issue ${job.issueNumber}`}`
          : `chore: ${slug(job.prompt).replace(/-/g, ' ') || 'coding job'}`,
        body: [
          '## NanoCrab Coding Job',
          '',
          job.issueNumber ? `Resolves #${job.issueNumber}` : '',
          '',
          `Job: \`${job.id}\``,
          `Provider: \`${job.provider}/${job.model}\``,
          '',
          '### Changes',
          '```',
          diffStat,
          '```',
        ]
          .filter(Boolean)
          .join('\n'),
        head: job.branch,
        base: repo.defaultBranch,
      }),
    })) as { html_url?: string };
    job.commitSha = sha;
    job.prUrl = pr.html_url || null;
    job.diffSummary = diffStat || job.diffSummary;
    job.changedFiles = Array.from(
      new Set(
        [
          ...changedFiles.split('\n'),
          ...untracked.split('\n'),
          ...(job.changedFiles || []),
        ].filter(Boolean),
      ),
    );
    job.testSummary = testSummary || job.testSummary;
    applyCodingJobTransition(job, 'ci_running');
    job.ciStatus = 'pending';
    recordJobApproval(job, 'open-pr', by);
    upsertCodingJob(job);
    return job;
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    applyCodingJobTransition(job, 'failed', failureReason);
    updateJobOutput(job, `\n\nPR creation failed: ${failureReason}\n`);
    throw err;
  }
}

function summarizeCiError(statusPayload: {
  state?: string;
  statuses?: Array<{
    state?: string;
    context?: string;
    description?: string | null;
    target_url?: string | null;
  }>;
}): string | null {
  const failingStatus = (statusPayload.statuses || []).find((status) =>
    ['failure', 'error'].includes(String(status.state || '').toLowerCase()),
  );
  if (!failingStatus) {
    if (['failure', 'error'].includes(String(statusPayload.state || ''))) {
      return 'CI reported failure';
    }
    return null;
  }
  const context = failingStatus.context || 'CI';
  const description = failingStatus.description || failingStatus.state || '';
  return `${context}: ${description}`.trim();
}

function summarizeCheckRunError(
  checkRuns: GitHubCheckRunSummary[],
): string | null {
  const failingRun = checkRuns.find((run) =>
    [
      'failure',
      'timed_out',
      'cancelled',
      'action_required',
      'startup_failure',
    ].includes(run.conclusion || ''),
  );
  if (!failingRun) return null;
  return `${failingRun.name || 'GitHub Actions'}: ${failingRun.conclusion}`;
}

interface GitHubCheckRunSummary {
  name?: string;
  status?: string;
  conclusion?: string | null;
  html_url?: string | null;
}

function evaluateCheckRuns(checkRuns: GitHubCheckRunSummary[]): {
  status: 'pending' | 'success' | 'failure' | 'none';
  error: string | null;
} {
  if (checkRuns.length === 0) return { status: 'none', error: null };
  const failed = summarizeCheckRunError(checkRuns);
  if (failed) return { status: 'failure', error: failed };
  const pending = checkRuns.some(
    (run) =>
      run.status !== 'completed' ||
      (run.status === 'completed' && !run.conclusion),
  );
  if (pending) return { status: 'pending', error: null };
  return { status: 'success', error: null };
}

export async function refreshCodingJobCi(jobId: string): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (!job.commitSha) {
    throw new Error(`Coding job ${jobId} has no commit SHA for CI lookup`);
  }
  if (job.status !== 'ci_running' && job.status !== 'completed') {
    throw new Error(`Cannot refresh CI from ${job.status}`);
  }

  const statusPayload = (await githubApi(
    `/repos/${job.repo}/commits/${job.commitSha}/status`,
  )) as {
    state?: 'pending' | 'success' | 'failure' | 'error';
    statuses?: Array<{
      state?: string;
      context?: string;
      description?: string | null;
      target_url?: string | null;
    }>;
  };
  const checkRunsPayload = (await githubApi(
    `/repos/${job.repo}/commits/${job.commitSha}/check-runs?per_page=100`,
  )) as {
    check_runs?: GitHubCheckRunSummary[];
  };
  const checkRunResult = evaluateCheckRuns(
    Array.isArray(checkRunsPayload.check_runs)
      ? checkRunsPayload.check_runs
      : [],
  );
  const state = statusPayload.state || 'pending';
  const statusCount = Array.isArray(statusPayload.statuses)
    ? statusPayload.statuses.length
    : 0;
  if (state === 'failure' || state === 'error') {
    job.ciStatus = 'failure';
    job.lastCiError = summarizeCiError(statusPayload);
  } else if (checkRunResult.status === 'failure') {
    job.ciStatus = 'failure';
    job.lastCiError = checkRunResult.error;
  } else if (
    (state === 'pending' && statusCount > 0) ||
    checkRunResult.status === 'pending'
  ) {
    job.ciStatus = 'pending';
    job.lastCiError = null;
  } else if (state === 'success' || checkRunResult.status === 'success') {
    job.ciStatus = 'success';
    job.lastCiError = null;
  } else {
    job.ciStatus = 'pending';
    job.lastCiError = null;
  }

  if (
    job.status === 'ci_running' &&
    (job.ciStatus === 'success' || job.ciStatus === 'failure')
  ) {
    applyCodingJobTransition(job, 'completed');
  } else {
    upsertCodingJob(job);
  }
  return job;
}

export async function revertCodingJob(
  jobId: string,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (!hasApprovedTarget('coding-revert', 'coding-job', job.id)) {
    createApproval({
      kind: 'coding-revert',
      title: `Revert coding job ${job.id}`,
      summary: `Approve deleting/reverting branch ${job.branch} for ${job.repo}.`,
      risk: 'high',
      requester: by,
      targetType: 'coding-job',
      targetId: job.id,
      payload: { jobId: job.id, repo: job.repo, branch: job.branch },
    });
    upsertCodingJob(job);
    return job;
  }
  try {
    const { execFileSync } = await import('child_process');
    execFileSync('git', ['push', 'origin', `:${job.branch}`], {
      cwd: job.workspace,
      stdio: 'pipe',
    });
  } catch {
    // Branch may not exist remotely yet.
  }
  recordJobApproval(job, 'revert', by);
  job.status = 'cancelled';
  job.completedAt = nowIso();
  upsertCodingJob(job);
  return job;
}

export async function closeCodingJobPr(
  jobId: string,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (!job.prUrl) return job;
  const match = job.prUrl.match(/\/pull\/(\d+)/);
  if (match) {
    await githubApi(`/repos/${job.repo}/pulls/${match[1]}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    });
  }
  recordJobApproval(job, 'close-pr', by);
  upsertCodingJob(job);
  return job;
}
