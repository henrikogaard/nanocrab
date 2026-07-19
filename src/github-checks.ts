import { logger } from './logger.js';

export type GitHubCheckState =
  | 'pending'
  | 'success'
  | 'failure'
  | 'error'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'unknown'
  | 'stale'
  | 'attention';

export type GitHubCheckPermission = 'full' | 'checks-only' | 'none';

export interface GitHubCheckRunApiItem {
  id: number;
  name: string;
  status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'pending'
    | 'waiting'
    | 'requested'
    | string;
  conclusion: string | null;
  output?: { title?: string; summary?: string } | null;
  details_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  check_suite?: { id?: number; app?: { name?: string } | null } | null;
}

export interface GitHubCombinedStatusApiItem {
  state: 'pending' | 'success' | 'failure' | 'error' | string;
  statuses: Array<{
    context: string;
    state: 'pending' | 'success' | 'failure' | 'error' | string;
    target_url?: string | null;
    description?: string | null;
    updated_at?: string | null;
  }>;
}

export interface GitHubBranchProtectionApiItem {
  required_status_checks?: {
    contexts?: string[];
    checks?: Array<{ context: string; app_id?: number | null }>;
  } | null;
}

export interface GitHubCheck {
  id: number;
  name: string;
  suite: string | null;
  suiteId: number | null;
  required: boolean | null;
  status: string;
  conclusion: string | null;
  state: GitHubCheckState;
  detailsUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  isStale: boolean;
}

export interface GitHubCheckSuiteSummary {
  id: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  updatedAt: string | null;
}

export interface GitHubCheckStatusResult {
  owner: string;
  repo: string;
  ref: string;
  status: GitHubCheckState;
  overall: GitHubCheckState;
  fetchedAt: string;
  stale: boolean;
  staleReason?: string;
  permission: GitHubCheckPermission;
  rateLimited: boolean;
  retryAfter?: number | null;
  error?: string;
  failureSummary?: string;
  checks: GitHubCheck[];
  suites: GitHubCheckSuiteSummary[];
  requiredChecks: string[];
  optionalChecks: string[];
  failedRequired: string[];
  failedOptional: string[];
}

const GITHUB_API_BASE = 'https://api.github.com';
const STALE_DATA_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_TIMEOUT_MS = 15000;

function isSha(ref: string): boolean {
  return /^[0-9a-f]{40}$/i.test(ref);
}

function resolveBranchName(ref: string, explicitBranch?: string): string | null {
  if (explicitBranch) return explicitBranch;
  const headMatch = ref.match(/^refs\/heads\/(.+)$/);
  if (headMatch) return headMatch[1];
  if (isSha(ref)) return null;
  return ref;
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 403 &&
    response.headers.get('x-ratelimit-remaining') === '0'
  );
}

function parseRetryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

function isCheckStale(
  status: string,
  completedAt: Date | null,
  updatedAt: Date | null,
  now: Date,
): boolean {
  if (status === 'in_progress' || status === 'queued' || status === 'pending') {
    const started = completedAt || updatedAt;
    if (started) {
      return now.getTime() - started.getTime() > STALE_DATA_MS;
    }
    return false;
  }
  const lastUpdate = completedAt || updatedAt;
  if (lastUpdate) {
    return now.getTime() - lastUpdate.getTime() > STALE_DATA_MS;
  }
  return false;
}

function normalizeCheckState(
  status: string,
  conclusion: string | null | undefined,
): GitHubCheckState {
  const s = status.toLowerCase();
  if (s !== 'completed') {
    if (s === 'success' || s === 'failure' || s === 'error') return s;
    return 'pending';
  }
  const c = (conclusion || '').toLowerCase();
  switch (c) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'startup_failure':
      return 'failure';
    case 'neutral':
      return 'neutral';
    case 'skipped':
      return 'skipped';
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'error';
    case 'pending':
      return 'pending';
    default:
      return 'unknown';
  }
}

function isFailingState(state: GitHubCheckState): boolean {
  return state === 'failure' || state === 'error' || state === 'cancelled';
}

function isPassingState(state: GitHubCheckState): boolean {
  return (
    state === 'success' || state === 'skipped' || state === 'neutral'
  );
}

function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Strip any query parameters that could contain tokens or signed URLs.
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[redacted url]';
  }
}

interface RawCheck {
  id: number;
  name: string;
  suite: string | null;
  suiteId: number | null;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  outputTitle: string | null;
  outputSummary: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

function apiUrl(path: string): string {
  return `${GITHUB_API_BASE}${path}`;
}

async function fetchGitHubJson(
  url: string,
  token: string,
  signal: AbortSignal,
): Promise<{ ok: true; response: Response; json: unknown } | { ok: false; response: Response; error: string; rateLimited: boolean; retryAfter: number | null }> {
  try {
    const response = await fetch(url, {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'NanoCrab/1.0',
      },
    });
    if (response.ok) {
      try {
        const json = await response.json();
        return { ok: true, response, json };
      } catch {
        return {
          ok: false,
          response,
          error: `GitHub API returned non-JSON payload (${response.status})`,
          rateLimited: false,
          retryAfter: null,
        };
      }
    }
    if (isRateLimited(response)) {
      return {
        ok: false,
        response,
        error: 'GitHub API rate limit exceeded',
        rateLimited: true,
        retryAfter: parseRetryAfter(response),
      };
    }
    if (response.status === 404) {
      return {
        ok: false,
        response,
        error: 'GitHub resource not found',
        rateLimited: false,
        retryAfter: null,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        response,
        error: 'GitHub API permission denied',
        rateLimited: false,
        retryAfter: null,
      };
    }
    return {
      ok: false,
      response,
      error: `GitHub API returned HTTP ${response.status}`,
      rateLimited: false,
      retryAfter: null,
    };
  } catch (err: unknown) {
    logger.warn({ url, err: err instanceof Error ? err.message : String(err) }, 'GitHub API fetch failed');
    return {
      ok: false,
      response: null as unknown as Response,
      error: 'GitHub API unreachable',
      rateLimited: false,
      retryAfter: null,
    };
  }
}

function extractRequiredContexts(
  protection: GitHubBranchProtectionApiItem | null,
): { contexts: Set<string>; known: boolean } {
  if (!protection) return { contexts: new Set<string>(), known: false };
  const required = new Set<string>();
  const checks = protection.required_status_checks?.checks || [];
  const contexts = protection.required_status_checks?.contexts || [];
  for (const check of checks) {
    if (check.context) required.add(check.context);
  }
  for (const context of contexts) {
    if (context) required.add(context);
  }
  return { contexts: required, known: true };
}

function buildCheckFromRun(run: GitHubCheckRunApiItem): RawCheck {
  return {
    id: run.id,
    name: run.name,
    suite: run.check_suite?.app?.name || 'GitHub Checks',
    suiteId: run.check_suite?.id ?? null,
    status: run.status,
    conclusion: run.conclusion,
    detailsUrl: redactUrl(run.details_url),
    outputTitle: run.output?.title || null,
    outputSummary: run.output?.summary || null,
    startedAt: run.started_at || null,
    completedAt: run.completed_at || null,
    updatedAt: run.completed_at || run.started_at || null,
  };
}

function buildCheckFromStatus(status: {
  context: string;
  state: string;
  target_url?: string | null;
  description?: string | null;
  updated_at?: string | null;
}): RawCheck {
  const state = status.state.toLowerCase();
  return {
    id: 0,
    name: status.context,
    suite: 'Status',
    suiteId: null,
    status: state === 'pending' ? 'in_progress' : 'completed',
    conclusion: state === 'pending' ? null : status.state,
    detailsUrl: redactUrl(status.target_url),
    outputTitle: status.description || null,
    outputSummary: null,
    startedAt: status.updated_at || null,
    completedAt: status.updated_at || null,
    updatedAt: status.updated_at || null,
  };
}

function deduplicateChecks(rawChecks: RawCheck[]): RawCheck[] {
  const seen = new Map<string, RawCheck>();
  for (const check of rawChecks) {
    const existing = seen.get(check.name);
    // Prefer check-runs (id > 0) over legacy status contexts (id === 0).
    if (!existing || check.id > existing.id) {
      seen.set(check.name, check);
    }
  }
  return [...seen.values()];
}

function buildFailureSummary(
  failedRequired: string[],
  failedOptional: string[],
  checks: GitHubCheck[],
): string | undefined {
  if (failedRequired.length === 0 && failedOptional.length === 0) return undefined;
  const summaryParts: string[] = [];
  if (failedRequired.length > 0) {
    summaryParts.push(
      `Required checks failed: ${failedRequired.join(', ')}`,
    );
  }
  if (failedOptional.length > 0) {
    summaryParts.push(
      `Optional checks failed: ${failedOptional.join(', ')}`,
    );
  }
  for (const name of [...failedRequired, ...failedOptional].slice(0, 3)) {
    const check = checks.find((c) => c.name === name);
    if (check?.outputTitle) {
      summaryParts.push(`${name}: ${check.outputTitle}`);
    }
  }
  return summaryParts.join('. ');
}

export interface FetchGitHubCheckStatusOptions {
  branch?: string;
  now?: Date;
  timeoutMs?: number;
}

export async function fetchGitHubCheckStatus(
  owner: string,
  repo: string,
  ref: string,
  token: string,
  options: FetchGitHubCheckStatusOptions = {},
): Promise<GitHubCheckStatusResult> {
  const now = options.now || new Date();
  const fetchedAt = now.toISOString();

  if (!owner || !repo || !ref) {
    return {
      owner,
      repo,
      ref,
      status: 'unknown',
      overall: 'unknown',
      fetchedAt,
      stale: false,
      permission: 'none',
      rateLimited: false,
      error: 'Missing owner, repo, or ref',
      checks: [],
      suites: [],
      requiredChecks: [],
      optionalChecks: [],
      failedRequired: [],
      failedOptional: [],
    };
  }

  if (!token) {
    return {
      owner,
      repo,
      ref,
      status: 'unknown',
      overall: 'unknown',
      fetchedAt,
      stale: false,
      permission: 'none',
      rateLimited: false,
      error: 'GitHub token not configured',
      checks: [],
      suites: [],
      requiredChecks: [],
      optionalChecks: [],
      failedRequired: [],
      failedOptional: [],
    };
  }

  const branch = resolveBranchName(ref, options.branch);
  const signal = AbortSignal.timeout(
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  const checkRunsUrl = apiUrl(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
  );
  const statusUrl = apiUrl(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}/status`,
  );
  const protectionUrl = branch
    ? apiUrl(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}/protection`,
      )
    : null;

  const [checkRunsResult, statusResult, protectionResult] = await Promise.allSettled([
    fetchGitHubJson(checkRunsUrl, token, signal),
    fetchGitHubJson(statusUrl, token, signal),
    protectionUrl ? fetchGitHubJson(protectionUrl, token, signal) : Promise.resolve(null),
  ]);

  const checkRunsOutcome =
    checkRunsResult.status === 'fulfilled'
      ? checkRunsResult.value
      : null;
  const statusOutcome =
    statusResult.status === 'fulfilled' ? statusResult.value : null;
  const protectionOutcome =
    protectionResult && protectionResult.status === 'fulfilled'
      ? protectionResult.value
      : null;

  const errors: string[] = [];
  let rateLimited = false;
  let retryAfter: number | null = null;
  for (const outcome of [checkRunsOutcome, statusOutcome, protectionOutcome]) {
    if (!outcome || outcome.ok) continue;
    errors.push(outcome.error);
    if (outcome.rateLimited) rateLimited = true;
    if (outcome.retryAfter != null && retryAfter == null) {
      retryAfter = outcome.retryAfter;
    }
  }

  let permission: GitHubCheckPermission = 'checks-only';
  if (rateLimited || errors.length >= 2) {
    // If both check APIs failed, we have no useful permission.
    permission = 'none';
  } else if (protectionOutcome && protectionOutcome.ok) {
    permission = 'full';
  }

  let protectionData: GitHubBranchProtectionApiItem | null = null;
  if (protectionOutcome && protectionOutcome.ok) {
    protectionData = (protectionOutcome.json as GitHubBranchProtectionApiItem) || null;
  }

  const required = extractRequiredContexts(protectionData);

  const rawChecks: RawCheck[] = [];

  if (checkRunsOutcome && checkRunsOutcome.ok) {
    const payload = checkRunsOutcome.json as { check_runs?: GitHubCheckRunApiItem[] };
    for (const run of payload.check_runs || []) {
      rawChecks.push(buildCheckFromRun(run));
    }
  }

  if (statusOutcome && statusOutcome.ok) {
    const payload = statusOutcome.json as GitHubCombinedStatusApiItem;
    for (const status of payload.statuses || []) {
      rawChecks.push(buildCheckFromStatus(status));
    }
  }

  const uniqueChecks = deduplicateChecks(rawChecks);

  const checks: GitHubCheck[] = uniqueChecks.map((raw): GitHubCheck => {
    const state = normalizeCheckState(raw.status, raw.conclusion);
    const completedAt = parseIsoDate(raw.completedAt);
    const updatedAt = parseIsoDate(raw.updatedAt);
    const isStale = isCheckStale(raw.status, completedAt, updatedAt, now);
    const requiredValue = required.known
      ? required.contexts.has(raw.name)
      : null;
    return {
      id: raw.id,
      name: raw.name,
      suite: raw.suite,
      suiteId: raw.suiteId,
      required: requiredValue,
      status: raw.status,
      conclusion: raw.conclusion,
      state: isStale ? 'stale' : state,
      detailsUrl: raw.detailsUrl,
      outputTitle: raw.outputTitle,
      outputSummary: raw.outputSummary,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      updatedAt: raw.updatedAt,
      isStale,
    };
  });

  const suiteMap = new Map<number, GitHubCheckSuiteSummary>();
  for (const check of checks) {
    if (!check.suiteId) continue;
    if (!suiteMap.has(check.suiteId)) {
      suiteMap.set(check.suiteId, {
        id: check.suiteId,
        name: check.suite,
        status: check.status,
        conclusion: check.conclusion,
        updatedAt: check.updatedAt,
      });
    }
  }
  const suites = [...suiteMap.values()];

  const requiredChecks = checks
    .filter((c) => c.required === true)
    .map((c) => c.name);
  const optionalChecks = checks
    .filter((c) => c.required !== true)
    .map((c) => c.name);
  const failedRequired = checks
    .filter((c) => c.required === true && isFailingState(c.state))
    .map((c) => c.name);
  const failedOptional = checks
    .filter(
      (c) => (c.required === false || c.required === null) && isFailingState(c.state),
    )
    .map((c) => c.name);

  const staleChecks = checks.filter((c) => c.isStale);
  const stale = staleChecks.length > 0;

  let status: GitHubCheckState;
  if (rateLimited) {
    status = 'error';
  } else if (failedRequired.length > 0) {
    status = 'failure';
  } else if (failedOptional.length > 0) {
    status = 'attention';
  } else if (stale) {
    status = 'stale';
  } else if (checks.some((c) => c.state === 'pending')) {
    status = 'pending';
  } else if (checks.length > 0 && checks.every((c) => isPassingState(c.state))) {
    status = 'success';
  } else if (errors.length > 0) {
    status = 'unknown';
  } else {
    status = 'unknown';
  }

  let overall = status;
  if (overall === 'attention') {
    // Keep the operator-facing attention label for optional-only failures.
    overall = 'attention';
  }

  let staleReason: string | undefined;
  if (stale) {
    const names = staleChecks.map((c) => c.name).slice(0, 3);
    staleReason = `Stale data for ${staleChecks.length} check(s): ${names.join(', ')}`;
  }

  const failureSummary =
    failedRequired.length > 0 || failedOptional.length > 0
      ? buildFailureSummary(failedRequired, failedOptional, checks)
      : undefined;

  const errorMessage =
    errors.length > 0 ? [...new Set(errors)].join('; ') : undefined;

  return {
    owner,
    repo,
    ref,
    status,
    overall,
    fetchedAt,
    stale,
    staleReason,
    permission,
    rateLimited,
    retryAfter,
    error: errorMessage,
    failureSummary,
    checks,
    suites,
    requiredChecks,
    optionalChecks,
    failedRequired,
    failedOptional,
  };
}
