import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'node:os';
import path from 'path';
import { fileURLToPath } from 'node:url';

import {
  CODING_WORKSPACE_DIR,
  CODING_JOB_RUNNER_TIMEOUT_MS,
  CONTAINER_IMAGE,
  CREDENTIAL_PROXY_PORT,
  DATA_DIR,
  DEVIN_CREDENTIAL_PATH,
  STORE_DIR,
  TIMEZONE,
} from './config.js';
import { readEnvFile } from './env.js';
import {
  AgentProvider,
  DEFAULT_AGENT_MODELS,
  codingProviderUnavailableReason,
  getAgentProviderConfig,
  isAgentProvider,
  isCodingCapableProvider,
} from './agent-provider.js';
import type {
  AgentCliId,
  AgentRuntimeHealth,
  AgentRuntimeSelection,
} from './types.js';
import {
  DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
  getVerifiedDevinAliases,
  getVerifiedDevinRuntimeContext,
  inferLegacyRunnerCli,
  isDevinSandboxAuthHandoffAvailable,
  resolveDevinCliModelAlias,
  validateCodingRuntimeSelection,
} from './agent-runtime-registry.js';
import type {
  CodingExecutionAttempt,
  CodingRunnerAdapter,
  CodingRunnerResult,
} from './coding-runners/types.js';
import { createProductionDevinHostRunner } from './coding-runners/devin-host.js';
import { codingProcessRegistry } from './coding-runners/process-registry.js';
import {
  HostGitCancelledError,
  HostGitTimeoutError,
  runHostGit,
} from './coding-runners/host-git.js';
import { probeCodingRunnerReadiness } from './coding-runner-readiness.js';
import {
  collectCodingWorkspaceEvidence,
  deleteCodingWorkspaceBranch,
  publishCodingWorkspace,
  prepareCodingWorkspace,
  type CodingWorkspacePublicationInput,
  type CodingWorkspaceEvidence,
  type CodingWorkspaceInput,
  type PreparedCodingWorkspace,
} from './coding-workspace.js';
import {
  CONTAINER_HOST_GATEWAY,
  CONTAINER_RUNTIME_BIN,
  hostGatewayArgs,
} from './container-runtime.js';
import { detectAuthMode } from './credential-proxy.js';
import { logger } from './logger.js';
import { buildMistralVibeShellBlock } from './mistral-vibe-adapter.js';
import {
  createApproval,
  findPendingApprovalForTarget,
  hasApprovedTarget,
  reviewApproval,
} from './approvals.js';
import { resolveProviderFallbackForAction } from './provider-router.js';
import { logAuditEvent } from './audit-log.js';
import { evaluatePolicy } from './policy-engine.js';
import { buildRepoRulesContext } from './repo-preferences.js';
import type { PipelineStageKind } from './control-plane/types.js';
import type { StageRunEvidence } from './control-plane/run-evidence.js';
import { validateCleanupPreconditions } from './control-plane/run-evidence.js';
import {
  registerContainerProcess,
  cancelContainerProcess,
} from './container-runner.js';

export interface CodingJobExecutionDependencies {
  createAttemptId(): string;
  probeReadiness(cli: AgentCliId): Promise<AgentRuntimeHealth>;
  prepareWorkspace(
    input: CodingWorkspaceInput,
  ): Promise<PreparedCodingWorkspace>;
  collectWorkspaceEvidence(workspace: string): Promise<CodingWorkspaceEvidence>;
  publishWorkspace(
    input: CodingWorkspacePublicationInput,
  ): Promise<{ commitSha: string }>;
  deleteWorkspaceBranch(input: {
    workspace: string;
    repo: string;
    branch: string;
    token: string;
    jobId?: string;
    attemptId?: string;
  }): Promise<void>;
  devinRunner: CodingRunnerAdapter;
  /** True only when the host sandbox has a credential handoff it can safely expose. */
  devinSandboxAuthHandoffAvailable(): boolean;
  runContainer(
    job: CodingJob,
    repo: CodingRepo,
    attemptId: string,
  ): Promise<number>;
  now(): string;
}

export { validateStageCompletion } from './control-plane/run-evidence.js';
export type { StageRunEvidence } from './control-plane/run-evidence.js';

const CODING_REPOS_PATH = path.join(STORE_DIR, 'coding-repos.json');
const CODING_JOBS_PATH = path.join(STORE_DIR, 'coding-jobs.json');
const CODING_JOB_PROVIDERS = new Set<AgentProvider>([
  'claude',
  'codex',
  'opencode',
  'pi',
  'mistral',
  'openrouter',
  'ollama',
  'openai-compatible',
]);
type CodingProvider = Extract<
  AgentProvider,
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'pi'
  | 'mistral'
  | 'openrouter'
  | 'ollama'
  | 'openai-compatible'
>;

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

export interface GitHubProjectBoardSummary {
  type: 'project_v2' | 'classic_project';
  number: number | null;
  title: string;
  url: string;
  description: string;
  updatedAt: string;
  closed: boolean;
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
  investigationSummary?: string | null;
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
  agentProfileId: string | null;
  sourceSubscriptionId: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  decisionId?: string | null;
  actualRuntime?: AgentRuntimeSelection | null;
  runnerCli: AgentCliId;
  activeAttemptId: string | null;
  executionAttempts: CodingExecutionAttempt[];
  runId?: string | null;
  stageKind?: PipelineStageKind | null;
  stageEvidence?: StageRunEvidence | null;
  pushed?: boolean;
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
  agentProfileId?: string | null;
  sourceSubscriptionId?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  decisionId?: string | null;
  actualRuntime?: AgentRuntimeSelection | null;
  runId?: string | null;
  stageKind?: PipelineStageKind | null;
  stageEvidence?: StageRunEvidence | null;
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

export function getGitHubToken(): string | null {
  const env = readEnvFile(['GITHUB_TOKEN']);
  return process.env.GITHUB_TOKEN || env.GITHUB_TOKEN || null;
}

function assertRepoFullName(fullName: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new Error('repo must be in owner/name format');
  }
}

function splitRepoFullName(fullName: string): { owner: string; name: string } {
  assertRepoFullName(fullName);
  const [owner, name] = fullName.split('/');
  return { owner, name };
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
    agentProfileId: null,
    sourceSubscriptionId: null,
    pipelineId: null,
    stageId: null,
    decisionId: null,
    actualRuntime: null,
    runId: null,
    stageKind: null,
    stageEvidence: null,
    pushed: false,
  };
  const normalized = {
    ...defaults,
    ...job,
    runnerCli: job.runnerCli ?? inferLegacyRunnerCli(job.provider),
    activeAttemptId: job.activeAttemptId ?? null,
    executionAttempts: [...(job.executionAttempts ?? [])],
  };
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

export async function githubGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = getGitHubToken();
  if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub GraphQL ${response.status}: ${body.slice(0, 500)}`);
  }
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL: ${payload.errors
        .map((error) => error.message || 'unknown error')
        .join('; ')}`,
    );
  }
  if (!payload.data) throw new Error('GitHub GraphQL returned no data');
  return payload.data;
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
    if (input.assignee !== undefined) existing.assignee = input.assignee;
    if (input.milestone !== undefined) existing.milestone = input.milestone;
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
    ...(input.assignee ? { assignee: input.assignee } : {}),
    ...(input.milestone ? { milestone: input.milestone } : {}),
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

  const labels = input.labels !== undefined ? input.labels : repo.labels;
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

export async function listGitHubProjectBoards(input: {
  repo: string;
  limit?: number;
}): Promise<GitHubProjectBoardSummary[]> {
  assertRepoFullName(input.repo);
  const repo = getCodingRepo(input.repo);
  if (!repo?.enabled) {
    throw new Error(`Repo ${input.repo} is not registered for coding jobs`);
  }

  const { owner, name } = splitRepoFullName(input.repo);
  const limit = Math.min(Math.max(input.limit || 20, 1), 50);
  const data = await githubGraphql<{
    repository?: {
      projectsV2?: {
        nodes?: Array<{
          number?: number | null;
          title?: string | null;
          url?: string | null;
          shortDescription?: string | null;
          updatedAt?: string | null;
          closed?: boolean | null;
        } | null>;
      } | null;
      projects?: {
        nodes?: Array<{
          name?: string | null;
          url?: string | null;
          body?: string | null;
          updatedAt?: string | null;
          state?: string | null;
        } | null>;
      } | null;
    } | null;
  }>(
    `query NanoCrabGitHubProjects($owner: String!, $name: String!, $limit: Int!) {
      repository(owner: $owner, name: $name) {
        projectsV2(first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            number
            title
            url
            shortDescription
            updatedAt
            closed
          }
        }
        projects(first: $limit, states: OPEN) {
          nodes {
            name
            url
            body
            updatedAt
            state
          }
        }
      }
    }`,
    { owner, name, limit },
  );

  const repository = data.repository;
  if (!repository) return [];
  const projectV2 = (repository.projectsV2?.nodes || [])
    .filter((board): board is NonNullable<typeof board> => Boolean(board))
    .filter((board) => Boolean(board.title && board.url))
    .map(
      (board): GitHubProjectBoardSummary => ({
        type: 'project_v2',
        number: typeof board.number === 'number' ? board.number : null,
        title: board.title || '',
        url: board.url || '',
        description: board.shortDescription || '',
        updatedAt: board.updatedAt || '',
        closed: board.closed === true,
      }),
    );
  const classic = (repository.projects?.nodes || [])
    .filter((board): board is NonNullable<typeof board> => Boolean(board))
    .filter((board) => Boolean(board.name && board.url))
    .map(
      (board): GitHubProjectBoardSummary => ({
        type: 'classic_project',
        number: null,
        title: board.name || '',
        url: board.url || '',
        description: board.body || '',
        updatedAt: board.updatedAt || '',
        closed: board.state ? board.state !== 'OPEN' : false,
      }),
    );
  return [...projectV2, ...classic];
}

function isCodingProvider(
  provider: AgentProvider,
  model?: string,
): provider is CodingProvider {
  return (
    CODING_JOB_PROVIDERS.has(provider) &&
    isCodingCapableProvider(provider, model)
  );
}

function codingProvider(
  inputProvider?: string,
  inputModel?: string,
): CodingProvider {
  if (inputProvider && isAgentProvider(inputProvider)) {
    if (isCodingProvider(inputProvider, inputModel)) return inputProvider;
    throw new Error(
      codingProviderUnavailableReason(inputProvider, inputModel) ||
        `${inputProvider} is not a coding-job runtime`,
    );
  }
  const config = getAgentProviderConfig();
  const model =
    config.modelsByProvider[config.provider] ||
    DEFAULT_AGENT_MODELS[config.provider];
  return isCodingProvider(config.provider, model) ? config.provider : 'claude';
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

  if (to === 'completed') {
    void import('./learning-loop.js')
      .then(({ deriveLearningFromRun }) => {
        deriveLearningFromRun(job.id, job.requestedBy || 'system');
      })
      .catch((err) => {
        logger.error(
          { err, jobId: job.id },
          'Failed to derive learning proposal from coding job',
        );
      });
  }

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

export function buildCodingPrompt(job: CodingJob): string {
  const repoRules = buildRepoRulesContext(job.repo);
  const prompt = [
    `You are working in the cloned repository ${job.repo}.`,
    job.issueNumber
      ? `Fix GitHub issue #${job.issueNumber}: ${job.issueTitle || ''}`
      : 'Complete the requested coding task.',
    job.prompt,
    repoRules || '',
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
    'CODING_JOB_MAX_TURNS',
    'OPENCODE_API_KEY',
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'OLLAMA_BASE_URL',
    'OPENAI_COMPATIBLE_API_KEY',
    'OPENAI_COMPATIBLE_BASE_URL',
    'DEFAULT_OPENAI_COMPATIBLE_BASE_URL',
    'PI_PROVIDER',
    'MISTRAL_API_KEY',
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
    CODING_JOB_MAX_TURNS:
      envValue(envFileValues, 'CODING_JOB_MAX_TURNS') || '30',
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
  if (job.provider === 'openrouter') {
    const openrouterKey = envValue(envFileValues, 'OPENROUTER_API_KEY');
    if (openrouterKey) {
      env.OPENROUTER_API_KEY = 'placeholder';
      env.AGENT_PROVIDER_API_KEY = 'placeholder';
    }
    const openrouterProxyUrl = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/openrouter`;
    env.OPENROUTER_BASE_URL = openrouterProxyUrl;
    env.AGENT_PROVIDER_BASE_URL = openrouterProxyUrl;
  }
  if (job.provider === 'ollama') {
    env.OLLAMA_BASE_URL =
      envValue(envFileValues, 'OLLAMA_BASE_URL') ||
      'http://host.docker.internal:11434/v1';
  }
  if (job.provider === 'openai-compatible') {
    const customBaseUrl =
      envValue(envFileValues, 'OPENAI_COMPATIBLE_BASE_URL') ||
      envValue(envFileValues, 'DEFAULT_OPENAI_COMPATIBLE_BASE_URL');
    if (customBaseUrl) {
      const customProxyUrl = `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/openai-compatible`;
      env.OPENAI_COMPATIBLE_BASE_URL = customProxyUrl;
      env.AGENT_PROVIDER_BASE_URL = customProxyUrl;
      if (envValue(envFileValues, 'OPENAI_COMPATIBLE_API_KEY')) {
        env.OPENAI_COMPATIBLE_API_KEY = 'placeholder';
        env.AGENT_PROVIDER_API_KEY = 'placeholder';
      }
      const modelId = job.model.replace(/^openai-compatible\//, '');
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        model: `openai-compatible/${modelId}`,
        share: 'disabled',
        autoupdate: 'notify',
        provider: {
          'openai-compatible': {
            npm: '@ai-sdk/openai-compatible',
            name: 'Custom OpenAI-Compatible',
            options: {
              apiKey: env.OPENAI_COMPATIBLE_API_KEY
                ? '{env:OPENAI_COMPATIBLE_API_KEY}'
                : undefined,
              baseURL: '{env:OPENAI_COMPATIBLE_BASE_URL}',
            },
            models: {
              [modelId]: { name: modelId },
            },
          },
        },
      });
    }
  }

  if (job.provider === 'pi') {
    const openrouterKey = envValue(envFileValues, 'OPENROUTER_API_KEY');
    if (openrouterKey) {
      env.OPENROUTER_API_KEY = 'placeholder';
    }
    env.PI_PROVIDER = 'openrouter';
    env.PI_CODING_AGENT_DIR = '/workspace/coding-job/.nanocrab/pi-agent';
  }

  if (job.provider === 'mistral') {
    env.MISTRAL_API_KEY = 'placeholder';
    env.VIBE_HOME = '/workspace/coding-job/.nanocrab/vibe-home';
  }

  return env;
}

function buildProxyProviderUrl(provider: string): string {
  return `http://${CONTAINER_HOST_GATEWAY}:${CREDENTIAL_PROXY_PORT}/__nanocrab/providers/${provider}`;
}

function writeVibeConfig(metadataDir: string, job: CodingJob): void {
  const vibeDir = path.join(metadataDir, 'vibe-home');
  fs.mkdirSync(vibeDir, { recursive: true });
  fs.writeFileSync(
    path.join(vibeDir, 'config.toml'),
    [
      'active_model = "nanocrab"',
      '',
      '[[providers]]',
      'name = "mistral"',
      `api_base = "${buildProxyProviderUrl('mistral')}"`,
      'api_key_env_var = "MISTRAL_API_KEY"',
      '',
      '[[models]]',
      `name = "${job.model.replace(/"/g, '\\"')}"`,
      'provider = "mistral"',
      'alias = "nanocrab"',
      '',
    ].join('\n'),
  );
}

function writePiConfig(metadataDir: string): void {
  const piDir = path.join(metadataDir, 'pi-agent');
  fs.mkdirSync(piDir, { recursive: true });
  fs.writeFileSync(
    path.join(piDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          openrouter: {
            baseUrl: buildProxyProviderUrl('openrouter'),
            apiKey: 'OPENROUTER_API_KEY',
          },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(piDir, 'auth.json'), '{}');
}

function writeCodingJobFiles(job: CodingJob, repo: CodingRepo): string {
  const jobRoot = path.dirname(job.workspace);
  const metadataDir = path.join(jobRoot, '.nanocrab');
  fs.mkdirSync(metadataDir, { recursive: true });
  if (job.provider === 'mistral') writeVibeConfig(metadataDir, job);
  if (job.provider === 'pi') writePiConfig(metadataDir);
  const mistralVibeShellBlock = buildMistralVibeShellBlock({
    prompt: '"$PROMPT"',
    maxTurns: '"$CODING_JOB_MAX_TURNS"',
    maxPrice: '"$CODING_JOB_MAX_BUDGET_USD"',
  });
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
      '  openrouter)',
      '    opencode run --model "$JOB_MODEL" "$PROMPT"',
      '    ;;',
      '  ollama)',
      '    OLLAMA_JOB_MODEL="$JOB_MODEL"',
      '    case "$OLLAMA_JOB_MODEL" in',
      '      ollama/*) ;;',
      '      *) OLLAMA_JOB_MODEL="ollama/$OLLAMA_JOB_MODEL" ;;',
      '    esac',
      '    opencode run --model "$OLLAMA_JOB_MODEL" "$PROMPT"',
      '    ;;',
      '  openai-compatible)',
      '    OPENAI_COMPATIBLE_JOB_MODEL="$JOB_MODEL"',
      '    case "$OPENAI_COMPATIBLE_JOB_MODEL" in',
      '      openai-compatible/*) ;;',
      '      *) OPENAI_COMPATIBLE_JOB_MODEL="openai-compatible/$OPENAI_COMPATIBLE_JOB_MODEL" ;;',
      '    esac',
      '    opencode run --model "$OPENAI_COMPATIBLE_JOB_MODEL" "$PROMPT"',
      '    ;;',
      '  claude)',
      '    claude -p --model "$JOB_MODEL" --output-format text --dangerously-skip-permissions --max-budget-usd "$CODING_JOB_MAX_BUDGET_USD" "$PROMPT"',
      '    ;;',
      '  pi)',
      '    PI_PROVIDER=openrouter',
      '    PI_CODING_AGENT_DIR=/workspace/coding-job/.nanocrab/pi-agent',
      '    OPENROUTER_API_KEY=placeholder',
      '    case "$JOB_MODEL" in',
      '      gemini-2.5-pro) PI_JOB_MODEL="google/gemini-2.5-pro" ;;',
      '      claude-sonnet-4-6) PI_JOB_MODEL="anthropic/claude-sonnet-4-6" ;;',
      '      gpt-5.4) PI_JOB_MODEL="openai/gpt-5.4" ;;',
      '      *) PI_JOB_MODEL="$JOB_MODEL" ;;',
      '    esac',
      '    pi -p "$PROMPT" --mode json --model "$PI_JOB_MODEL" --provider openrouter --no-session',
      '    ;;',
      '  mistral)',
      '    VIBE_HOME=/workspace/coding-job/.nanocrab/vibe-home',
      '    MISTRAL_API_KEY=placeholder',
      ...mistralVibeShellBlock.map((line) => `    ${line}`),
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

function runCodingContainer(
  job: CodingJob,
  repo: CodingRepo,
  attemptId: string,
): Promise<number> {
  const appendAttemptOutput = (text: string): void => {
    const current = getCodingJob(job.id);
    if (current?.activeAttemptId === attemptId) updateJobOutput(current, text);
  };
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

  appendAttemptOutput(
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
      detached: true,
    });
    registerContainerProcess(job.id, proc, containerName, attemptId);
    proc.stdout?.on('data', (data: Buffer) => {
      appendAttemptOutput(data.toString());
    });
    proc.stderr?.on('data', (data: Buffer) => {
      appendAttemptOutput(data.toString());
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

function authorizeCodingImplementation(job: CodingJob): void {
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
    decision:
      policy.decision === 'denied'
        ? 'denied'
        : job.dryRun
          ? 'simulated'
          : 'approved',
    correlationId: job.id,
    context: policy,
  });
  if (policy.decision === 'denied') {
    throw new Error(
      `Coding implementation denied by policy: ${policy.explanation}`,
    );
  }
}

const CODING_SECRET_KEYS = [
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENCODE_API_KEY',
  'OPENROUTER_API_KEY',
  'MISTRAL_API_KEY',
  'OLLAMA_API_KEY',
  'AGENT_PROVIDER_API_KEY',
  'NANOCRAB_API_KEY',
] as const;

let productionDevinRunner: CodingRunnerAdapter | null = null;
let codingJobExecutionOverrides: Partial<CodingJobExecutionDependencies> | null =
  null;

function configuredKnownSecrets(): string[] {
  const env = readEnvFile([...CODING_SECRET_KEYS]);
  return [
    ...new Set(
      CODING_SECRET_KEYS.map((key) => process.env[key] || env[key]).filter(
        (value): value is string => Boolean(value && value.length >= 8),
      ),
    ),
  ];
}

function getProductionDevinRunner(): CodingRunnerAdapter {
  if (productionDevinRunner) return productionDevinRunner;
  if (!DEVIN_CREDENTIAL_PATH) {
    throw new Error('DEVIN_CREDENTIAL_PATH is not configured');
  }
  const home = process.env.HOME || os.homedir();
  productionDevinRunner = createProductionDevinHostRunner({
    spawn,
    registry: codingProcessRegistry,
    timers: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
    environmentSource: process.env,
    knownSecrets: configuredKnownSecrets(),
    authHandoffAvailable: isDevinSandboxAuthHandoffAvailable,
    realpath: (value) => fs.promises.realpath(value),
    getVerifiedRuntimeContext: getVerifiedDevinRuntimeContext,
    commandBrokerModulePath: path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      'coding-runners',
      'command-broker.js',
    ),
    devinCredentialPath: DEVIN_CREDENTIAL_PATH,
    home,
    nanocrabConfigRoot: path.join(home, '.config', 'nanocrab'),
    signalProcessGroup: (pid, signal) => process.kill(pid, signal),
  });
  return productionDevinRunner;
}

const productionDevinRunnerProxy: CodingRunnerAdapter = {
  run: (input) => getProductionDevinRunner().run(input),
  cancel: (jobId, attemptId) =>
    DEVIN_CREDENTIAL_PATH
      ? getProductionDevinRunner().cancel(jobId, attemptId)
      : false,
};

const runGit = runHostGit;

function productionCodingJobExecutionDependencies(): CodingJobExecutionDependencies {
  return {
    createAttemptId: () => crypto.randomUUID(),
    probeReadiness: probeCodingRunnerReadiness,
    prepareWorkspace: (input) =>
      prepareCodingWorkspace(input, {
        git: runGit,
        realpath: (value) => fs.promises.realpath(value),
        lstat: (value) => fs.promises.lstat(value),
        mkdir: fs.promises.mkdir,
        githubToken: getGitHubToken(),
      }),
    collectWorkspaceEvidence: (workspace) =>
      collectCodingWorkspaceEvidence(workspace, { git: runGit }),
    publishWorkspace: (input) => publishCodingWorkspace(input, { git: runGit }),
    deleteWorkspaceBranch: (input) =>
      deleteCodingWorkspaceBranch(input, { git: runGit }),
    devinRunner: productionDevinRunnerProxy,
    devinSandboxAuthHandoffAvailable: isDevinSandboxAuthHandoffAvailable,
    runContainer: runCodingContainer,
    now: nowIso,
  };
}

function codingJobExecutionDependencies(): CodingJobExecutionDependencies {
  return {
    ...productionCodingJobExecutionDependencies(),
    ...(codingJobExecutionOverrides || {}),
  };
}

export function configureCodingJobExecutionForTests(
  overrides: Partial<CodingJobExecutionDependencies> | null,
): void {
  codingJobExecutionOverrides = overrides
    ? { ...(codingJobExecutionOverrides || {}), ...overrides }
    : null;
}

function sanitizeAttemptDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  return Array.from(detail)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? ' ' : character;
    })
    .join('')
    .trim()
    .slice(0, 2_000);
}

function terminalizeAttempt(
  jobId: string,
  attemptId: string,
  state: CodingExecutionAttempt['state'],
  detail?: string,
): CodingJob | null {
  const latest = getCodingJob(jobId);
  if (!latest || latest.activeAttemptId !== attemptId) return null;
  const attempt = latest.executionAttempts.find(
    (item) => item.id === attemptId,
  );
  if (
    !attempt ||
    attempt.state === 'succeeded' ||
    attempt.state === 'failed' ||
    attempt.state === 'timed_out' ||
    attempt.state === 'cancelled'
  ) {
    return null;
  }
  attempt.state = state;
  attempt.completedAt = codingJobExecutionDependencies().now();
  const safeDetail = sanitizeAttemptDetail(detail);
  if (safeDetail) attempt.detail = safeDetail;
  else delete attempt.detail;
  latest.activeAttemptId = null;
  upsertCodingJob(latest);
  return latest;
}

function runningAttempt(jobId: string, attemptId: string): CodingJob | null {
  const latest = getCodingJob(jobId);
  if (!latest || latest.activeAttemptId !== attemptId) return null;
  const attempt = latest.executionAttempts.find(
    (item) => item.id === attemptId,
  );
  if (!attempt || attempt.state !== 'preparing') return null;
  attempt.state = 'running';
  upsertCodingJob(latest);
  return latest;
}

function runnerFailureMessage(
  job: CodingJob,
  result: CodingRunnerResult,
): string {
  return (
    sanitizeAttemptDetail(result.detail) ||
    `${job.runnerCli} coding runner ${result.state}`
  );
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
    sourceProvider: job.provider,
    sourceModel: job.model,
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

interface StaleCodingAttemptResult {
  kind: 'stale_attempt';
  jobId: string;
  attemptId: string;
}

function staleAttemptResult(
  jobId: string,
  attemptId: string,
): StaleCodingAttemptResult {
  return { kind: 'stale_attempt', jobId, attemptId };
}

async function runCodingJob(
  job: CodingJob,
): Promise<void | StaleCodingAttemptResult> {
  const current = getCodingJob(job.id) || job;
  if (current.status === 'cancelled') {
    updateJobOutput(current, '\n\nCoding job cancelled.\n');
    return;
  }
  Object.assign(job, current);

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
      logAuditEvent({
        actor: job.requestedBy,
        actorId: job.id,
        actionType: 'coding.implement',
        resource: job.repo,
        decision: 'denied',
        correlationId: job.id,
        context: policy,
      });
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
    sourceProvider: job.provider,
    sourceModel: job.model,
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
    if (!isCodingProvider(fallback.provider, fallback.model)) {
      throw new Error(
        codingProviderUnavailableReason(fallback.provider, fallback.model) ||
          `${fallback.provider} is not a coding-job runtime`,
      );
    }
  }

  const runtimeChanged =
    fallback.provider !== job.provider || fallback.model !== job.model;
  if (job.actualRuntime && runtimeChanged) {
    let decision = findPendingApprovalForTarget(
      'provider-fallback',
      'coding-job',
      job.id,
    );
    if (!decision) {
      decision = createApproval({
        kind: 'provider-fallback',
        title: `Select fallback coding runtime for ${job.repo}`,
        summary: `Choose and approve a complete CLI, provider, and model runtime to replace ${job.actualRuntime.cli}/${job.actualRuntime.provider}/${job.actualRuntime.model} with provider ${fallback.provider} and model ${fallback.model}.`,
        risk: 'high',
        requester: job.requestedBy,
        targetType: 'coding-job',
        targetId: job.id,
        correlationId: job.id,
        payload: {
          jobId: job.id,
          sourceRuntime: job.actualRuntime,
          proposedProvider: fallback.provider,
          proposedModel: fallback.model,
        },
      });
    }
    updateJobOutput(
      job,
      `\n\nProvider fallback must include an owner-approved CLI, provider, and model; a control-plane decision is required (${decision.id}).\n`,
    );
    upsertCodingJob(job);
    return;
  }
  const selectedRuntime = job.actualRuntime || {
    cli: runtimeChanged
      ? inferLegacyRunnerCli(fallback.provider)
      : job.runnerCli,
    provider: fallback.provider,
    model: fallback.model,
  };
  validateCodingRuntimeSelection(selectedRuntime);
  if (runtimeChanged) {
    updateJobOutput(
      job,
      `\n\nUsing approved runtime ${job.runnerCli}/${job.provider}/${job.model} -> ${selectedRuntime.cli}/${selectedRuntime.provider}/${selectedRuntime.model}\n`,
    );
  }
  job.actualRuntime = selectedRuntime;
  job.runnerCli = selectedRuntime.cli;
  job.provider = selectedRuntime.provider as CodingProvider;
  job.model = selectedRuntime.model;
  upsertCodingJob(job);

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
  authorizeCodingImplementation(job);
  const deps = codingJobExecutionDependencies();
  if (job.runnerCli === 'devin' && !deps.devinSandboxAuthHandoffAvailable()) {
    throw new Error(DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL);
  }
  const readiness = await deps.probeReadiness(job.runnerCli);
  if (readiness.status !== 'healthy') throw new Error(readiness.detail);

  const priorAttempts = [...job.executionAttempts];
  const isFirstRun = priorAttempts.length === 0;
  const attemptId = deps.createAttemptId();
  job.executionAttempts.push({
    id: attemptId,
    state: 'preparing',
    startedAt: deps.now(),
    completedAt: null,
  });
  job.activeAttemptId = attemptId;
  upsertCodingJob(job);

  let runnerResult: CodingRunnerResult;
  let hostEvidence: CodingWorkspaceEvidence | null = null;
  try {
    const prepared = await deps.prepareWorkspace({
      jobId: job.id,
      attemptId,
      repo: job.repo,
      defaultBranch: repo.defaultBranch,
      branch: job.branch,
      workspace: job.workspace,
      isFirstRun,
    });
    writeCodingJobFiles(job, repo);
    if (!runningAttempt(job.id, attemptId)) {
      return staleAttemptResult(job.id, attemptId);
    }
    if (job.runnerCli === 'devin') {
      const advertisedAliases = getVerifiedDevinAliases();
      const modelAlias = resolveDevinCliModelAlias(
        selectedRuntime,
        undefined,
        advertisedAliases.size > 0 ? advertisedAliases : undefined,
      );
      runnerResult = await deps.devinRunner.run({
        jobId: job.id,
        attemptId,
        cli: 'devin',
        model: modelAlias,
        stageKind: job.stageKind || null,
        workspace: prepared.workspace,
        promptFile: path.join(prepared.metadataDir, 'prompt.txt'),
        timeoutMs: CODING_JOB_RUNNER_TIMEOUT_MS,
        onOutput: (chunk) => {
          const currentAttempt = getCodingJob(job.id);
          if (currentAttempt?.activeAttemptId === attemptId) {
            updateJobOutput(currentAttempt, chunk.text);
          }
        },
      });
      if (runnerResult.state === 'succeeded') {
        hostEvidence = await deps.collectWorkspaceEvidence(prepared.workspace);
      }
    } else {
      const exitCode = await deps.runContainer(job, repo, attemptId);
      runnerResult = {
        attemptId,
        state: exitCode === 0 ? 'succeeded' : 'failed',
        exitCode,
        signal: null,
        ...(exitCode === 0
          ? {}
          : {
              detail: `${job.provider} coding container exited with code ${exitCode}`,
            }),
      };
    }
  } catch (error) {
    if (error instanceof HostGitTimeoutError) {
      if (
        !terminalizeAttempt(
          job.id,
          attemptId,
          'timed_out',
          'Host Git operation timed out',
        )
      ) {
        return staleAttemptResult(job.id, attemptId);
      }
      throw error;
    }
    if (error instanceof HostGitCancelledError) {
      const current = getCodingJob(job.id);
      if (current?.activeAttemptId === attemptId) {
        if (
          !terminalizeAttempt(
            job.id,
            attemptId,
            'cancelled',
            'Cancelled by owner',
          )
        ) {
          return staleAttemptResult(job.id, attemptId);
        }
      }
      return staleAttemptResult(job.id, attemptId);
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (!terminalizeAttempt(job.id, attemptId, 'failed', detail)) {
      return staleAttemptResult(job.id, attemptId);
    }
    throw error;
  }

  if (runnerResult.attemptId !== attemptId) {
    const detail = 'Coding runner returned a mismatched attempt identifier';
    if (!terminalizeAttempt(job.id, attemptId, 'failed', detail)) {
      return staleAttemptResult(job.id, attemptId);
    }
    throw new Error(detail);
  }
  const refreshedBeforeTerminal = getCodingJob(job.id);
  if (refreshedBeforeTerminal?.activeAttemptId !== attemptId) {
    return staleAttemptResult(job.id, attemptId);
  }
  if (runnerResult.state !== 'succeeded') {
    const failureReason = runnerFailureMessage(job, runnerResult);
    const refreshed = terminalizeAttempt(
      job.id,
      attemptId,
      runnerResult.state,
      failureReason,
    );
    if (!refreshed) return staleAttemptResult(job.id, attemptId);
    if (runnerResult.state === 'cancelled') {
      if (refreshed.status !== 'cancelled') {
        applyCodingJobTransition(refreshed, 'cancelled', failureReason);
      }
      return;
    }
    throw new Error(failureReason);
  }
  const refreshed = terminalizeAttempt(job.id, attemptId, 'succeeded');
  if (!refreshed) return staleAttemptResult(job.id, attemptId);
  if (refreshed.status === 'cancelled') return;
  Object.assign(job, refreshed);
  applyCodingJobTransition(job, 'test');

  const metadataDir = path.join(path.dirname(job.workspace), '.nanocrab');
  const diffStat =
    hostEvidence?.diffStat ||
    (hostEvidence ? '' : readTextFile(path.join(metadataDir, 'diff-stat.txt')));
  const changedFiles = hostEvidence
    ? hostEvidence.changedFiles
    : readTextFile(path.join(metadataDir, 'changed-files.txt'))
        .split('\n')
        .filter(Boolean);
  const untracked = hostEvidence
    ? hostEvidence.untrackedFiles
    : readTextFile(path.join(metadataDir, 'untracked.txt'))
        .split('\n')
        .filter(Boolean);
  const testSummary = hostEvidence
    ? hostEvidence.testEvidence.summary
    : readTextFile(path.join(metadataDir, 'test-summary.txt'));
  if (hostEvidence) job.testSummary = testSummary;
  if (!diffStat && untracked.length === 0) {
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
        ...changedFiles,
        ...untracked,
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

  const actualRuntime = input.actualRuntime || null;
  if (actualRuntime) validateCodingRuntimeSelection(actualRuntime);
  const requestedProvider =
    actualRuntime?.provider ||
    (input.provider && isAgentProvider(input.provider)
      ? input.provider
      : undefined);
  const requestedModel =
    actualRuntime?.model ||
    input.model ||
    (requestedProvider
      ? getAgentProviderConfig().modelsByProvider[requestedProvider] ||
        DEFAULT_AGENT_MODELS[requestedProvider]
      : undefined);
  const provider = codingProvider(requestedProvider, requestedModel);
  const model = requestedModel || defaultModelForProvider(provider);
  let prompt = input.prompt || '';
  let issueTitle: string | null = null;
  const issueNumber = input.issueNumber || null;

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
    agentProfileId: input.agentProfileId || null,
    sourceSubscriptionId: input.sourceSubscriptionId || null,
    pipelineId: input.pipelineId || null,
    stageId: input.stageId || null,
    decisionId: input.decisionId || null,
    actualRuntime,
    runnerCli: actualRuntime?.cli ?? inferLegacyRunnerCli(provider),
    activeAttemptId: null,
    executionAttempts: [],
    runId: input.runId || id,
    stageKind: input.stageKind || null,
    stageEvidence: input.stageEvidence || null,
    pushed: false,
    createdAt: nowIso(),
    completedAt: null,
  };
  upsertCodingJob(job);

  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      const failureReason = err instanceof Error ? err.message : String(err);
      const latest = getCodingJob(job.id) || job;
      if (latest.status === 'cancelled') {
        updateJobOutput(latest, '\n\nCoding job cancelled.\n');
        return;
      }
      applyCodingJobTransition(latest, 'failed', failureReason);
      updateJobOutput(latest, `\n\nCoding job failed: ${failureReason}\n`);
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
  actualRuntime?: AgentRuntimeSelection | null;
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
    actualRuntime: input.actualRuntime,
    createPr: input.createPr,
    requestedBy: input.requestedBy,
  });
  return { issue, job };
}

export function getCodingJob(jobId: string): CodingJob | undefined {
  return loadCodingJobs().find((job) => job.id === jobId);
}

export interface CodingJobTimelineItem {
  id: string;
  jobId: string;
  at: string;
  kind: string;
  title: string;
  detail: string | null;
  repo: string;
  status: CodingJobStatus;
  issueNumber: number | null;
  prUrl: string | null;
  ciStatus: CodingJob['ciStatus'];
}

export function listCodingJobTimeline(limit = 100): CodingJobTimelineItem[] {
  return loadCodingJobs()
    .flatMap((job) =>
      job.transitionHistory.map((transition, index) => ({
        id: `${transition.at}-${index}`,
        jobId: job.id,
        at: transition.at,
        kind: transition.to,
        title: `${job.repo}: ${transition.from} -> ${transition.to}`,
        detail: transition.failureReason || null,
        repo: job.repo,
        status: job.status,
        issueNumber: job.issueNumber,
        prUrl: job.prUrl,
        ciStatus: job.ciStatus,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, Math.min(Math.max(limit, 0), 500));
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
  let job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);

  const attemptId = job.activeAttemptId;
  if (attemptId) {
    const hostGitLease = codingProcessRegistry.get(job.id, attemptId);
    if (hostGitLease) {
      codingProcessRegistry.terminate(hostGitLease, 'cancelled');
    }
    if (job.runnerCli === 'devin') {
      codingJobExecutionDependencies().devinRunner.cancel(job.id, attemptId);
    } else {
      cancelContainerProcess(job.id, 'cancel coding job', attemptId);
    }
    job =
      terminalizeAttempt(
        job.id,
        attemptId,
        'cancelled',
        'Cancelled by owner',
      ) || job;
  }
  codingProcessRegistry.terminateAll(job.id, 'cancelled');
  recordJobApproval(job, 'cancel', by);

  // Deny ALL pending approvals for this job to prevent contradictory state
  // This includes: coding-implement, coding-open-pr, provider-fallback, coding-revert
  const approvalKinds = [
    'coding-implement',
    'coding-open-pr',
    'provider-fallback',
    'coding-revert',
  ] as const;
  for (const kind of approvalKinds) {
    const pendingApproval = findPendingApprovalForTarget(
      kind,
      'coding-job',
      job.id,
    );
    if (pendingApproval) {
      reviewApproval(pendingApproval.id, 'denied', by, 'Job was cancelled');
    }
  }

  applyCodingJobTransition(job, 'cancelled');
  upsertCodingJob(job);
  return job;
}

export function cleanupCodingJob(jobId: string): {
  ok: boolean;
  reason?: string;
} {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);

  const runActive = ![
    'completed',
    'failed',
    'cancelled',
    'await_approval',
    'await_pr_approval',
  ].includes(job.status);
  const decisionPending =
    job.status === 'await_approval' || job.status === 'await_pr_approval';

  return validateCleanupPreconditions({
    runActive,
    decisionPending,
    pushed: job.pushed || job.prUrl != null,
    prUrl: job.prUrl,
  });
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
  if (
    job.activeAttemptId ||
    job.executionAttempts.some((attempt) =>
      ['preparing', 'running'].includes(attempt.state),
    )
  ) {
    throw new Error('Cannot retry coding job while an attempt is active');
  }
  applyCodingJobTransition(job, 'queued');
  job.completedAt = null;
  job.output += '\n\nRetry requested.\n';
  recordJobApproval(job, 'retry', by);
  upsertCodingJob(job);
  setImmediate(() => {
    void runCodingJob(job).catch((err) => {
      const failureReason = err instanceof Error ? err.message : String(err);
      const latest = getCodingJob(job.id) || job;
      if (latest.status === 'cancelled') {
        updateJobOutput(latest, '\n\nCoding job cancelled.\n');
        return;
      }
      applyCodingJobTransition(latest, 'failed', failureReason);
      updateJobOutput(latest, `\n\nCoding job failed: ${failureReason}\n`);
    });
  });
  return job;
}

export async function approveCodingJobRuntimeFallback(
  jobId: string,
  runtime: AgentRuntimeSelection,
  by = 'dashboard',
): Promise<CodingJob> {
  const job = getCodingJob(jobId);
  if (!job) throw new Error(`Coding job not found: ${jobId}`);
  if (job.status !== 'await_approval' || !job.actualRuntime) {
    throw new Error(`Cannot approve runtime fallback from ${job.status}`);
  }
  const pending = findPendingApprovalForTarget(
    'provider-fallback',
    'coding-job',
    job.id,
  );
  if (!pending) throw new Error('Runtime fallback decision is not pending');
  const proposedProvider = pending.payload.proposedProvider;
  const proposedModel = pending.payload.proposedModel;
  if (
    runtime.provider !== proposedProvider ||
    runtime.model !== proposedModel
  ) {
    throw new Error('Runtime fallback does not match the pending proposal');
  }
  const sourceRuntime = pending.payload.sourceRuntime;
  if (
    !sourceRuntime ||
    typeof sourceRuntime !== 'object' ||
    (sourceRuntime as AgentRuntimeSelection).cli !== job.actualRuntime.cli ||
    (sourceRuntime as AgentRuntimeSelection).provider !==
      job.actualRuntime.provider ||
    (sourceRuntime as AgentRuntimeSelection).model !== job.actualRuntime.model
  ) {
    throw new Error('Runtime fallback source no longer matches the coding job');
  }
  if (!isCodingProvider(runtime.provider, runtime.model)) {
    throw new Error(
      codingProviderUnavailableReason(runtime.provider, runtime.model) ||
        `${runtime.provider} is not a coding-job runtime`,
    );
  }
  validateCodingRuntimeSelection(runtime);
  if (runtime.cli === 'devin') {
    let readiness: AgentRuntimeHealth;
    try {
      readiness = await codingJobExecutionDependencies().probeReadiness(
        runtime.cli,
      );
    } catch (err) {
      throw new Error(
        `Coding runtime ${runtime.cli} / ${runtime.provider} / ${runtime.model} readiness check failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (readiness.status !== 'healthy') {
      throw new Error(
        `Coding runtime ${runtime.cli} / ${runtime.provider} / ${runtime.model} is unavailable: ${readiness.detail}`,
      );
    }
  }
  reviewApproval(pending.id, 'approved', by);
  const previous = job.actualRuntime;
  job.actualRuntime = { ...runtime };
  job.runnerCli = runtime.cli;
  job.provider = runtime.provider as CodingProvider;
  job.model = runtime.model;
  recordJobApproval(job, 'approve-runtime-fallback', by);
  updateJobOutput(
    job,
    `\n\nOwner approved runtime fallback ${previous.cli}/${previous.provider}/${previous.model} -> ${runtime.cli}/${runtime.provider}/${runtime.model}.\n`,
  );
  setImmediate(() => {
    const latest = getCodingJob(job.id);
    if (!latest) return;
    void runCodingJob(latest).catch((error) => {
      const failureReason =
        error instanceof Error ? error.message : String(error);
      const failed = getCodingJob(job.id) || latest;
      if (failed.status === 'cancelled') return;
      applyCodingJobTransition(failed, 'failed', failureReason);
      updateJobOutput(failed, `\n\nCoding job failed: ${failureReason}\n`);
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
      const failed = getCodingJob(job.id) || latest;
      if (failed.status === 'cancelled') {
        updateJobOutput(failed, '\n\nCoding job cancelled.\n');
        return;
      }
      applyCodingJobTransition(failed, 'failed', failureReason);
      updateJobOutput(failed, `\n\nCoding job failed: ${failureReason}\n`);
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
  const publicationLease = job.transitionHistory.length;
  const ownsPublication = (): boolean => {
    const current = getCodingJob(job.id);
    return Boolean(
      current &&
      current.status === 'open_pr' &&
      current.activeAttemptId === null &&
      current.transitionHistory.length === publicationLease,
    );
  };
  const assertPublicationOwnership = (): void => {
    if (!ownsPublication()) {
      throw new Error('Coding job publication ownership was lost');
    }
  };

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
    const token = getGitHubToken();
    if (!token) throw new Error('GITHUB_TOKEN is not configured');
    const { commitSha: sha } =
      await codingJobExecutionDependencies().publishWorkspace({
        workspace: repoPath,
        repo: job.repo,
        branch: job.branch,
        commitMessage,
        token,
        assertOwnership: assertPublicationOwnership,
        jobId: job.id,
      });
    assertPublicationOwnership();
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
    assertPublicationOwnership();
    job.commitSha = sha;
    job.prUrl = pr.html_url || null;
    job.pushed = true;
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
    if (err instanceof HostGitCancelledError) {
      const current = getCodingJob(job.id);
      if (current && current.status === 'cancelled') return current;
    }
    const failureReason = err instanceof Error ? err.message : String(err);
    const current = getCodingJob(job.id);
    if (!ownsPublication() || !current) throw err;
    applyCodingJobTransition(current, 'failed', failureReason);
    updateJobOutput(current, `\n\nPR creation failed: ${failureReason}\n`);
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
    const token = getGitHubToken();
    if (token) {
      await codingJobExecutionDependencies().deleteWorkspaceBranch({
        workspace: job.workspace,
        repo: job.repo,
        branch: job.branch,
        token,
        jobId: job.id,
      });
    }
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
  job.prUrl = null;
  recordJobApproval(job, 'close-pr', by);
  upsertCodingJob(job);
  return job;
}
