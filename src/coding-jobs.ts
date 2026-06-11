import { execFileSync, spawn } from 'child_process';
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
import { dryRunLabel, isDryRunMode } from './dry-run.js';
import {
  createApproval,
  hasApprovedTarget,
  reviewApproval,
} from './approvals.js';
import { evaluateActionPolicy } from './action-policy.js';

const CODING_REPOS_PATH = path.join(STORE_DIR, 'coding-repos.json');
const CODING_JOBS_PATH = path.join(STORE_DIR, 'coding-jobs.json');
const CODING_JOB_PROVIDERS = new Set<AgentProvider>([
  'claude',
  'codex',
  'opencode',
]);
type CodingProvider = Extract<AgentProvider, 'claude' | 'codex' | 'opencode'>;

export interface CodingRepo {
  id: string;
  fullName: string;
  defaultBranch: string;
  labels: string[];
  assignee?: string;
  milestone?: string;
  autoPick?: boolean;
  defaultProvider?: CodingProvider;
  defaultModel?: string;
  codingRules?: string;
  trustedForPr?: boolean;
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
  status:
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
  branch: string;
  workspace: string;
  createPr: boolean;
  prUrl: string | null;
  commitSha: string | null;
  changedFiles: string[];
  testSummary: string | null;
  ciStatus: 'unknown' | 'pending' | 'success' | 'failure';
  investigationSummary: string | null;
  implementationPlan: string | null;
  timeline: CodingJobTimelineEvent[];
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

export interface CodingJobTimelineEvent {
  id: string;
  kind: 'status' | 'approval' | 'container' | 'diff' | 'pr' | 'ci' | 'note';
  title: string;
  detail?: string;
  at: string;
}

export interface CodingJobTimelineItem extends CodingJobTimelineEvent {
  jobId: string;
  repo: string;
  status: CodingJob['status'];
  issueNumber: number | null;
  issueTitle: string | null;
  prUrl: string | null;
  ciStatus: CodingJob['ciStatus'];
}

export interface StartCodingJobInput {
  repo: string;
  prompt?: string;
  issueNumber?: number;
  provider?: string;
  model?: string;
  createPr?: boolean;
  branchName?: string;
  requestedBy: string;
}

interface IssuePlanInput {
  repo: CodingRepo;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
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
    testSummary: null,
    ciStatus: 'unknown',
    investigationSummary: null,
    implementationPlan: null,
    timeline: [],
    approvalHistory: [],
  };
  return { ...defaults, ...job };
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
  assignee?: string;
  milestone?: string;
  defaultProvider?: string;
  defaultModel?: string;
  codingRules?: string;
  trustedForPr?: boolean;
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
    existing.assignee =
      typeof input.assignee === 'string' && input.assignee.trim()
        ? input.assignee.trim()
        : existing.assignee;
    existing.milestone =
      typeof input.milestone === 'string' && input.milestone.trim()
        ? input.milestone.trim()
        : existing.milestone;
    existing.defaultProvider = resolveRepoDefaultProvider(
      input.defaultProvider,
      existing.defaultProvider,
    );
    existing.defaultModel =
      typeof input.defaultModel === 'string' && input.defaultModel.trim()
        ? input.defaultModel.trim()
        : existing.defaultModel;
    existing.codingRules =
      typeof input.codingRules === 'string'
        ? input.codingRules.trim()
        : existing.codingRules;
    existing.trustedForPr =
      typeof input.trustedForPr === 'boolean'
        ? input.trustedForPr
        : existing.trustedForPr;
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
    assignee:
      typeof input.assignee === 'string' && input.assignee.trim()
        ? input.assignee.trim()
        : undefined,
    milestone:
      typeof input.milestone === 'string' && input.milestone.trim()
        ? input.milestone.trim()
        : undefined,
    defaultProvider: resolveRepoDefaultProvider(input.defaultProvider),
    defaultModel:
      typeof input.defaultModel === 'string' && input.defaultModel.trim()
        ? input.defaultModel.trim()
        : undefined,
    codingRules:
      typeof input.codingRules === 'string' && input.codingRules.trim()
        ? input.codingRules.trim()
        : undefined,
    trustedForPr: input.trustedForPr === true,
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

export async function listGitHubIssues(input: {
  repo: string;
  labels?: string[];
  assignee?: string;
  limit?: number;
}): Promise<GitHubIssueSummary[]> {
  assertRepoFullName(input.repo);
  const repo = getCodingRepo(input.repo);
  if (!repo?.enabled) {
    throw new Error(`Repo ${input.repo} is not registered for coding jobs`);
  }

  const params = new URLSearchParams({
    state: 'open',
    per_page: String(Math.min(Math.max(input.limit || 20, 1), 50)),
  });
  const labels = input.labels?.length ? input.labels : repo.labels;
  if (labels.length > 0) params.set('labels', labels.join(','));
  if (input.assignee) params.set('assignee', input.assignee);

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
    user?: { login: string };
  }>;

  return issues
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body || '',
      labels: (issue.labels || []).map((label) =>
        typeof label === 'string' ? label : label.name,
      ),
      assignees: (issue.assignees || []).map((assignee) => assignee.login),
      author: issue.user?.login || 'unknown',
      htmlUrl: issue.html_url,
      updatedAt: issue.updated_at,
    }));
}

function isCodingProvider(provider: AgentProvider): provider is CodingProvider {
  return CODING_JOB_PROVIDERS.has(provider);
}

function resolveRepoDefaultProvider(
  inputProvider?: string,
  fallback?: CodingProvider,
): CodingProvider | undefined {
  if (!inputProvider) return fallback;
  if (isAgentProvider(inputProvider) && isCodingProvider(inputProvider)) {
    return inputProvider;
  }
  return fallback;
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

function canOpenPr(job: CodingJob, repo: CodingRepo): boolean {
  return (
    repo.trustedForPr === true ||
    hasApprovedTarget('coding-open-pr', 'coding-job', job.id)
  );
}

function updateJobOutput(job: CodingJob, text: string): void {
  job.output += text;
  if (job.output.length > 800000) job.output = job.output.slice(-650000);
  upsertCodingJob(job);
}

function addJobTimelineEvent(
  job: CodingJob,
  kind: CodingJobTimelineEvent['kind'],
  title: string,
  detail?: string,
): void {
  job.timeline.push({
    id: `event-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    kind,
    title,
    detail,
    at: nowIso(),
  });
}

function extractAcceptanceCriteria(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\[[ xX]\]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+\[[ xX]\]\s+/, '').trim())
    .slice(0, 12);
}

function buildIssueInvestigationPlan(input: IssuePlanInput): {
  summary: string;
  plan: string;
} {
  const acceptance = extractAcceptanceCriteria(input.issueBody);
  const planLines = [
    `Investigate ${input.repo.fullName} issue #${input.issueNumber}: ${input.issueTitle}`,
    '',
    'Implementation plan:',
    '1. Inspect the relevant code paths and existing tests before editing.',
    '2. Make the smallest focused change that satisfies the issue scope.',
    acceptance.length
      ? `3. Verify these acceptance criteria: ${acceptance.join('; ')}.`
      : '3. Add or update focused tests for the changed behavior where practical.',
    '4. Run the targeted test command for the touched area, then broader checks if the blast radius is shared.',
    input.repo.codingRules
      ? `5. Apply repo rules: ${input.repo.codingRules}`
      : '',
  ].filter(Boolean);
  const summaryParts = [
    `Issue #${input.issueNumber} is ready for implementation approval.`,
    acceptance.length
      ? `${acceptance.length} acceptance item${acceptance.length === 1 ? '' : 's'} detected.`
      : 'No checklist-style acceptance criteria detected.',
    input.repo.codingRules ? 'Repo coding rules are present.' : '',
  ].filter(Boolean);
  return {
    summary: summaryParts.join(' '),
    plan: planLines.join('\n'),
  };
}

function buildCodingPrompt(job: CodingJob, repo?: CodingRepo): string {
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
    repo?.codingRules ? `Repo coding rules:\n${repo.codingRules}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
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
    CREATE_PR: job.createPr && canOpenPr(job, repo) ? 'true' : 'false',
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
    `${buildCodingPrompt(job, repo)}\n`,
  );
  if (job.implementationPlan) {
    fs.writeFileSync(
      path.join(metadataDir, 'implementation-plan.md'),
      `${job.implementationPlan.trim()}\n`,
    );
  }
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
      'git ls-files --others --exclude-standard > /workspace/coding-job/.nanocrab/untracked.txt',
      'if [ "$CREATE_PR" = "true" ] && { [ -s /workspace/coding-job/.nanocrab/diff-stat.txt ] || [ -s /workspace/coding-job/.nanocrab/untracked.txt ]; }; then',
      '  git config user.name "$GIT_AUTHOR_NAME"',
      '  git config user.email "$GIT_AUTHOR_EMAIL"',
      '  git add -A',
      '  git commit -F /workspace/coding-job/.nanocrab/commit-message.txt',
      '  git push origin "$JOB_BRANCH:refs/heads/$JOB_BRANCH" --force-with-lease',
      'fi',
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
  addJobTimelineEvent(
    job,
    'container',
    'Coding container started',
    containerName,
  );
  upsertCodingJob(job);

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

async function runCodingJob(job: CodingJob): Promise<void> {
  if (isDryRunMode()) {
    job.status = 'completed';
    job.completedAt = nowIso();
    const detail = dryRunLabel('coding job implementation');
    updateJobOutput(job, `\n\n${detail}\n`);
    addJobTimelineEvent(job, 'note', 'Dry-run implementation skipped', detail);
    upsertCodingJob(job);
    return;
  }

  job.status = 'investigate';
  addJobTimelineEvent(job, 'status', 'Investigation started');
  upsertCodingJob(job);

  const repo = getCodingRepo(job.repo);
  if (!repo?.enabled) throw new Error(`Repo ${job.repo} is not registered`);

  job.status = 'implement';
  addJobTimelineEvent(job, 'status', 'Implementation started');
  upsertCodingJob(job);
  const exitCode = await runCodingContainer(job, repo);
  if (exitCode !== 0) {
    throw new Error(
      `${job.provider} coding container exited with code ${exitCode}`,
    );
  }

  const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
  const diffStat = readTextFile(path.join(metadataDir, 'diff-stat.txt'));
  const untracked = readTextFile(path.join(metadataDir, 'untracked.txt'));
  if (!diffStat && !untracked) {
    updateJobOutput(job, '\n\nNo repository changes were produced.\n');
    job.status = 'completed';
    job.completedAt = nowIso();
    addJobTimelineEvent(job, 'status', 'Completed without changes');
    upsertCodingJob(job);
    return;
  }

  updateJobOutput(
    job,
    `\n\nDiff stat:\n${diffStat || '(untracked files only)'}\n`,
  );
  job.changedFiles = diffStat
    .split('\n')
    .map((line) => line.split('|')[0]?.trim())
    .filter(Boolean);
  job.testSummary = 'See job output for tests run by the coding agent.';
  addJobTimelineEvent(job, 'diff', 'Repository changes detected', diffStat);
  if (!job.createPr) {
    job.status = 'completed';
    job.completedAt = nowIso();
    addJobTimelineEvent(job, 'status', 'Completed with local changes');
    upsertCodingJob(job);
    return;
  }

  if (!canOpenPr(job, repo)) {
    job.status = 'await_pr_approval';
    addJobTimelineEvent(job, 'approval', 'PR approval requested', diffStat);
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
    upsertCodingJob(job);
    updateJobOutput(job, '\n\nPR creation is awaiting approval.\n');
    return;
  }

  const commitTitle = job.issueNumber
    ? `fix: ${job.issueTitle || `issue ${job.issueNumber}`}`
    : `chore: ${slug(job.prompt).replace(/-/g, ' ') || 'coding job'}`;

  const pr = (await githubApi(`/repos/${job.repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: commitTitle,
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

  try {
    job.commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: job.workspace,
      encoding: 'utf-8',
    }).trim();
  } catch (err) {
    logger.warn({ err, jobId: job.id }, 'Could not read coding job commit SHA');
  }
  job.prUrl = pr.html_url || null;
  job.status = 'ci_running';
  job.ciStatus = 'pending';
  addJobTimelineEvent(job, 'pr', 'Pull request created', job.prUrl || '');
  updateJobOutput(job, `\n\nPR created: ${job.prUrl}\n`);
  job.status = 'completed';
  job.ciStatus = 'unknown';
  job.completedAt = nowIso();
  addJobTimelineEvent(job, 'status', 'Completed after PR creation');
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

  const provider = codingProvider(input.provider || repo.defaultProvider);
  const model =
    input.model || repo.defaultModel || defaultModelForProvider(provider);
  const dryRun = isDryRunMode();
  let prompt = input.prompt || '';
  let issueTitle: string | null = null;
  let issueNumber = input.issueNumber || null;
  let issueBody = '';

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
    issueBody = issue.body || '';
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
    prUrl: null,
    commitSha: null,
    changedFiles: [],
    testSummary: null,
    ciStatus: 'unknown',
    investigationSummary: null,
    implementationPlan: null,
    timeline: [],
    approvalHistory: [],
    output: '',
    requestedBy: input.requestedBy,
    createdAt: nowIso(),
    completedAt: null,
  };
  addJobTimelineEvent(job, 'status', 'Coding job created');
  if (issueNumber) {
    job.status = 'plan';
    addJobTimelineEvent(job, 'status', 'Issue investigation started');
    const plan = buildIssueInvestigationPlan({
      repo,
      issueNumber,
      issueTitle: issueTitle || `Issue ${issueNumber}`,
      issueBody,
    });
    job.investigationSummary = plan.summary;
    job.implementationPlan = plan.plan;
    job.output += `Investigation summary:\n${plan.summary}\n\n${plan.plan}\n`;
    addJobTimelineEvent(job, 'note', 'Implementation plan prepared', plan.plan);
    const decision = evaluateActionPolicy({
      action: 'coding-implement',
      toolPolicy: 'approval-required',
      approved: hasApprovedTarget('coding-implement', 'coding-job', id),
      dryRun,
      targetType: 'coding-job',
      targetId: id,
      payload: { jobId: id, repo: input.repo, issueNumber },
    });
    if (decision.dryRun) {
      job.status = 'completed';
      job.completedAt = nowIso();
      const detail = dryRunLabel('coding issue implementation');
      job.output += `\n${detail}\n`;
      addJobTimelineEvent(
        job,
        'note',
        'Dry-run approval request skipped',
        detail,
      );
    } else if (decision.decision === 'approval-required') {
      job.status = 'await_approval';
      addJobTimelineEvent(
        job,
        'approval',
        'Implementation approval requested',
        `Issue #${issueNumber}`,
      );
      createApproval({
        kind: 'coding-implement',
        title: `Implement ${input.repo} issue #${issueNumber}`,
        summary: [
          `Approve implementation for ${input.repo} issue #${issueNumber}: ${issueTitle || 'Untitled issue'}.`,
          '',
          plan.plan,
        ].join('\n'),
        risk: decision.risk,
        requester: input.requestedBy,
        targetType: 'coding-job',
        targetId: id,
        payload: { jobId: id, repo: input.repo, issueNumber },
      });
    }
  }
  if (dryRun && job.status === 'queued') {
    job.status = 'completed';
    job.completedAt = nowIso();
    const detail = dryRunLabel('coding job implementation');
    job.output += `${detail}\n`;
    addJobTimelineEvent(job, 'note', 'Dry-run implementation skipped', detail);
  }
  writeCodingJobFiles(job, repo);
  upsertCodingJob(job);

  if (job.status === 'queued') {
    queueCodingJobRun(job);
  }

  return job;
}

function queueCodingJobRun(job: CodingJob): void {
  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      job.status = 'failed';
      job.completedAt = nowIso();
      updateJobOutput(
        job,
        `\n\nCoding job failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      logger.error({ err, jobId: job.id }, 'Coding job failed');
    });
  });
}

export async function pickGitHubIssue(input: {
  repo: string;
  labels?: string[];
  provider?: string;
  model?: string;
  createPr?: boolean;
  requestedBy: string;
}): Promise<{ issue: GitHubIssueSummary; job: CodingJob } | null> {
  const issues = await listGitHubIssues({
    repo: input.repo,
    labels: input.labels,
    limit: 10,
  });
  if (issues.length === 0) return null;
  const issue = issues[0];
  const repo = getCodingRepo(input.repo);
  if (repo?.assignee && !issue.assignees.includes(repo.assignee)) {
    await githubApi(`/repos/${input.repo}/issues/${issue.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignees: [repo.assignee] }),
    });
    issue.assignees = Array.from(new Set([...issue.assignees, repo.assignee]));
  }
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

export function listCodingJobTimeline(limit = 50): CodingJobTimelineItem[] {
  return loadCodingJobs()
    .flatMap((job) =>
      job.timeline.map((event) => ({
        ...event,
        jobId: job.id,
        repo: job.repo,
        status: job.status,
        issueNumber: job.issueNumber,
        issueTitle: job.issueTitle,
        prUrl: job.prUrl,
        ciStatus: job.ciStatus,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, Math.min(Math.max(limit, 1), 200));
}

export function getCodingJobCockpitSummary(): {
  total: number;
  active: number;
  waitingApproval: number;
  failed: number;
  withPr: number;
  ciPending: number;
  ciFailure: number;
} {
  const jobs = loadCodingJobs();
  return {
    total: jobs.length,
    active: jobs.filter((job) =>
      [
        'queued',
        'investigate',
        'plan',
        'implement',
        'test',
        'open_pr',
      ].includes(job.status),
    ).length,
    waitingApproval: jobs.filter((job) =>
      ['await_approval', 'await_pr_approval'].includes(job.status),
    ).length,
    failed: jobs.filter((job) => job.status === 'failed').length,
    withPr: jobs.filter((job) => Boolean(job.prUrl)).length,
    ciPending: jobs.filter((job) => job.ciStatus === 'pending').length,
    ciFailure: jobs.filter((job) => job.ciStatus === 'failure').length,
  };
}

function recordJobApproval(
  job: CodingJob,
  action: string,
  by: string,
  note?: string,
): void {
  job.approvalHistory.push({ action, by, at: nowIso(), note });
  addJobTimelineEvent(
    job,
    'approval',
    `Coding job ${action}`,
    note ? `${by}: ${note}` : by,
  );
}

export function cancelCodingJob(jobId: string, by = 'dashboard'): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  job.status = 'cancelled';
  job.completedAt = nowIso();
  recordJobApproval(job, 'cancel', by);
  addJobTimelineEvent(job, 'status', 'Coding job cancelled');
  upsertCodingJob(job);
  return job;
}

export async function retryCodingJob(
  jobId: string,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  job.status = 'queued';
  job.completedAt = null;
  job.output += '\n\nRetry requested.\n';
  recordJobApproval(job, 'retry', by);
  addJobTimelineEvent(job, 'status', 'Retry queued');
  upsertCodingJob(job);
  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      job.status = 'failed';
      job.completedAt = nowIso();
      updateJobOutput(
        job,
        `\n\nCoding job failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
  });
  return job;
}

export function approveCodingJob(jobId: string, by = 'dashboard'): CodingJob {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (!hasApprovedTarget('coding-implement', 'coding-job', job.id)) {
    const approval = createApproval({
      kind: 'coding-implement',
      title: `Implement ${job.repo}`,
      summary: `Approve implementation for coding job ${job.id}.`,
      risk: 'high',
      requester: by,
      targetType: 'coding-job',
      targetId: job.id,
      payload: {
        jobId: job.id,
        repo: job.repo,
        issueNumber: job.issueNumber,
      },
    });
    if (approval.status === 'pending') {
      reviewApproval(approval.id, 'approved', by);
    }
  }
  recordJobApproval(job, 'approve', by);
  if (job.status === 'await_approval') {
    job.status = 'queued';
    addJobTimelineEvent(job, 'status', 'Implementation approved and queued');
    queueCodingJobRun(job);
  }
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
  if (isDryRunMode()) {
    job.status = 'completed';
    job.completedAt = nowIso();
    const detail = dryRunLabel('pull request creation');
    updateJobOutput(job, `\n\n${detail}\n`);
    addJobTimelineEvent(job, 'note', 'Dry-run PR creation skipped', detail);
    upsertCodingJob(job);
    return job;
  }
  if (!canOpenPr(job, repo)) {
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
    job.status = 'await_pr_approval';
    addJobTimelineEvent(job, 'approval', 'PR approval requested');
    upsertCodingJob(job);
    return job;
  }

  const repoPath = job.workspace;
  const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
  const diffStat = readTextFile(path.join(metadataDir, 'diff-stat.txt'));
  const commitMessage =
    readTextFile(path.join(metadataDir, 'commit-message.txt')) ||
    `chore: NanoCrab coding job ${job.id}`;
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
  job.status = 'ci_running';
  job.ciStatus = 'pending';
  recordJobApproval(job, 'open-pr', by);
  addJobTimelineEvent(job, 'pr', 'Pull request opened', job.prUrl || '');
  upsertCodingJob(job);
  return job;
}

export async function refreshCodingJobCi(jobId: string): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (!job.commitSha) {
    job.ciStatus = 'unknown';
    job.testSummary = job.testSummary || 'No commit SHA available for CI.';
    addJobTimelineEvent(job, 'ci', 'CI refresh skipped', job.testSummary);
    upsertCodingJob(job);
    return job;
  }

  const status = (await githubApi(
    `/repos/${job.repo}/commits/${encodeURIComponent(job.commitSha)}/status`,
  )) as {
    state?: 'pending' | 'success' | 'failure' | 'error';
    statuses?: Array<{ context?: string; description?: string }>;
  };
  let checkRuns: Array<{
    name?: string;
    status?: string;
    conclusion?: string | null;
    output?: { summary?: string | null; title?: string | null };
  }> = [];
  try {
    const checks = (await githubApi(
      `/repos/${job.repo}/commits/${encodeURIComponent(job.commitSha)}/check-runs`,
    )) as {
      check_runs?: typeof checkRuns;
    };
    checkRuns = checks.check_runs || [];
  } catch (err) {
    logger.warn({ err, jobId: job.id }, 'GitHub check-runs refresh failed');
  }

  const checkFailure = checkRuns.some((run) =>
    ['failure', 'timed_out', 'cancelled', 'action_required'].includes(
      run.conclusion || '',
    ),
  );
  const checkPending = checkRuns.some((run) =>
    ['queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(
      run.status || '',
    ),
  );
  const checkSuccess =
    checkRuns.length > 0 &&
    checkRuns.every(
      (run) => run.status === 'completed' && run.conclusion === 'success',
    );
  job.ciStatus = checkFailure
    ? 'failure'
    : checkPending
      ? 'pending'
      : checkSuccess && status.state !== 'failure' && status.state !== 'error'
        ? 'success'
        : status.state === 'success'
          ? 'success'
          : status.state === 'failure' || status.state === 'error'
            ? 'failure'
            : status.state === 'pending'
              ? 'pending'
              : 'unknown';
  const contexts = (status.statuses || [])
    .map((item) =>
      [item.context || 'status', item.description || status.state || 'unknown']
        .filter(Boolean)
        .join(': '),
    )
    .filter(Boolean);
  const checks = checkRuns.map((run) =>
    [
      run.name || 'check',
      run.conclusion || run.status || 'unknown',
      run.output?.title || run.output?.summary || '',
    ]
      .filter(Boolean)
      .join(': '),
  );
  job.testSummary =
    [...contexts, ...checks].join('; ') ||
    `GitHub status: ${status.state || 'unknown'}`;
  addJobTimelineEvent(job, 'ci', `CI status: ${job.ciStatus}`, job.testSummary);
  if (job.status === 'ci_running' && job.ciStatus !== 'pending') {
    job.status = 'completed';
    job.completedAt = nowIso();
    addJobTimelineEvent(job, 'status', 'CI completed');
  }
  upsertCodingJob(job);
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
