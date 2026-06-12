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
import { createApproval, hasApprovedTarget } from './approvals.js';
import { resolveProviderFallbackForAction } from './provider-router.js';

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
    testSummary: null,
    ciStatus: 'unknown',
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
    CREATE_PR:
      job.createPr && hasApprovedTarget('coding-open-pr', 'coding-job', job.id)
        ? 'true'
        : 'false',
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
  job.status = 'investigate';
  upsertCodingJob(job);

  const repo = getCodingRepo(job.repo);
  if (!repo?.enabled) throw new Error(`Repo ${job.repo} is not registered`);

  const fallback = resolveProviderFallbackForAction({
    purpose: 'default_coding',
    action: 'coding-implementation',
    requester: job.requestedBy,
    correlationId: job.id,
  });
  if (!fallback.approved) {
    job.status = 'await_approval';
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

  job.status = 'implement';
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
  if (!job.createPr) {
    job.status = 'completed';
    job.completedAt = nowIso();
    upsertCodingJob(job);
    return;
  }

  if (!hasApprovedTarget('coding-open-pr', 'coding-job', job.id)) {
    job.status = 'await_pr_approval';
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
  if (!requirePrProviderFallbackApproval(job, job.requestedBy)) {
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

  job.prUrl = pr.html_url || null;
  job.status = 'ci_running';
  job.ciStatus = 'pending';
  updateJobOutput(job, `\n\nPR created: ${job.prUrl}\n`);
  job.status = 'completed';
  job.ciStatus = 'unknown';
  job.completedAt = nowIso();
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
    prUrl: null,
    commitSha: null,
    changedFiles: [],
    testSummary: null,
    ciStatus: 'unknown',
    approvalHistory: [],
    output: '',
    requestedBy: input.requestedBy,
    createdAt: nowIso(),
    completedAt: null,
  };
  upsertCodingJob(job);

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

  return job;
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
  job.status = 'cancelled';
  job.completedAt = nowIso();
  recordJobApproval(job, 'cancel', by);
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
  recordJobApproval(job, 'approve', by);
  if (job.status === 'await_approval') job.status = 'queued';
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
  if (!hasApprovedTarget('coding-open-pr', 'coding-job', job.id)) {
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
    upsertCodingJob(job);
    return job;
  }
  if (!requirePrProviderFallbackApproval(job, by)) {
    return job;
  }

  const repoPath = job.workspace;
  const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
  const diffStat = readTextFile(path.join(metadataDir, 'diff-stat.txt'));
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
  job.status = 'ci_running';
  job.ciStatus = 'pending';
  recordJobApproval(job, 'open-pr', by);
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
