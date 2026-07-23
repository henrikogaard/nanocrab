import { Router, Request, Response } from 'express';

import {
  getGitHubToken,
  githubApi,
  loadCodingRepos,
  listGitHubIssues,
  loadCodingJobs,
  type GitHubIssueSummary,
} from '../../coding-jobs.js';
import { logger } from '../../logger.js';

const router = Router();

interface GitHubPRSummary {
  number: number;
  title: string;
  body: string;
  state: string;
  merged: boolean;
  labels: string[];
  author: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  baseBranch: string;
  draft: boolean;
  reviewStatus: string;
  ciStatus: string;
  changedFiles: number;
  additions: number;
  deletions: number;
}

interface GitHubIssueDetail extends GitHubIssueSummary {
  state: string;
  comments: number;
  createdAt: string;
  closedAt: string | null;
  linkedPRs: Array<{
    number: number;
    title: string;
    htmlUrl: string;
    state: string;
  }>;
  linkedCodingJobs: Array<{
    id: string;
    status: string;
    branch: string;
    prUrl: string | null;
  }>;
}

function safeRepoParam(req: Request): string | null {
  const repo = typeof req.query.repo === 'string' ? req.query.repo : '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return repo;
}

// List registered repos with status
router.get('/repos', (_req: Request, res: Response) => {
  const token = getGitHubToken();
  const repos = loadCodingRepos();
  res.json(
    repos.map((repo) => ({
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      enabled: repo.enabled,
      labels: repo.labels,
      connected: Boolean(token),
    })),
  );
});

// List issues for a repo
router.get('/issues', async (req: Request, res: Response) => {
  const repo = safeRepoParam(req);
  if (!repo) {
    res.status(400).json({ error: 'Valid repo (owner/name) is required' });
    return;
  }

  const labels =
    typeof req.query.labels === 'string' && req.query.labels
      ? req.query.labels
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
      : undefined;
  const assignee =
    typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
  const milestone =
    typeof req.query.milestone === 'string' ? req.query.milestone : undefined;
  const limit =
    typeof req.query.limit === 'string'
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100)
      : 30;

  try {
    const issues = await listGitHubIssues({
      repo,
      labels,
      assignee,
      milestone,
      limit,
    });
    res.json(issues);
  } catch (err) {
    logger.error({ err, repo }, 'GitHub issues list failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not list issues',
    });
  }
});

// Issue detail with linked PRs and coding jobs
router.get('/issues/:number', async (req: Request, res: Response) => {
  const repo = safeRepoParam(req);
  if (!repo) {
    res.status(400).json({ error: 'Valid repo (owner/name) is required' });
    return;
  }

  const issueNumber = parseInt(String(req.params.number), 10);
  if (Number.isNaN(issueNumber)) {
    res.status(400).json({ error: 'Invalid issue number' });
    return;
  }

  const token = getGitHubToken();
  if (!token) {
    res.status(503).json({ error: 'GitHub token is not configured' });
    return;
  }

  try {
    const raw = (await githubApi(`/repos/${repo}/issues/${issueNumber}`)) as {
      number: number;
      title: string;
      body?: string | null;
      state: string;
      html_url: string;
      created_at: string;
      updated_at: string;
      closed_at: string | null;
      comments: number;
      labels?: Array<{ name: string } | string>;
      assignees?: Array<{ login: string }>;
      milestone?: { title?: string | null } | null;
      user?: { login: string };
      pull_request?: unknown;
    };

    if (raw.pull_request) {
      res.status(404).json({ error: 'This is a pull request, not an issue' });
      return;
    }

    // Find linked PRs via timeline events
    let linkedPRs: GitHubIssueDetail['linkedPRs'] = [];
    try {
      const timeline = (await githubApi(
        `/repos/${repo}/issues/${issueNumber}/timeline?per_page=100`,
      )) as Array<{
        event?: string;
        source?: {
          issue?: {
            number?: number;
            title?: string;
            html_url?: string;
            state?: string;
            pull_request?: unknown;
          };
        };
      }>;
      linkedPRs = timeline
        .filter(
          (event) =>
            event.event === 'cross-referenced' &&
            event.source?.issue?.pull_request,
        )
        .map((event) => ({
          number: event.source!.issue!.number!,
          title: event.source!.issue!.title || '',
          htmlUrl: event.source!.issue!.html_url || '',
          state: event.source!.issue!.state || 'open',
        }));
    } catch {
      // Timeline API may fail; non-critical
    }

    // Find linked coding jobs
    const allJobs = loadCodingJobs();
    const linkedCodingJobs = allJobs
      .filter(
        (job) =>
          job.repo.toLowerCase() === repo.toLowerCase() &&
          job.issueNumber === issueNumber,
      )
      .map((job) => ({
        id: job.id,
        status: job.status,
        branch: job.branch,
        prUrl: job.prUrl,
      }));

    const detail: GitHubIssueDetail = {
      number: raw.number,
      title: raw.title,
      body: raw.body || '',
      state: raw.state,
      labels: (raw.labels || []).map((l) =>
        typeof l === 'string' ? l : l.name,
      ),
      assignees: (raw.assignees || []).map((a) => a.login),
      milestone: raw.milestone?.title || null,
      author: raw.user?.login || 'unknown',
      htmlUrl: raw.html_url,
      updatedAt: raw.updated_at,
      createdAt: raw.created_at,
      closedAt: raw.closed_at,
      comments: raw.comments,
      linkedPRs,
      linkedCodingJobs,
    };

    res.json(detail);
  } catch (err) {
    logger.error({ err, repo, issueNumber }, 'GitHub issue detail failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not fetch issue',
    });
  }
});

// List PRs for a repo
router.get('/pulls', async (req: Request, res: Response) => {
  const repo = safeRepoParam(req);
  if (!repo) {
    res.status(400).json({ error: 'Valid repo (owner/name) is required' });
    return;
  }

  const state =
    typeof req.query.state === 'string' &&
    ['open', 'closed', 'all'].includes(req.query.state)
      ? req.query.state
      : 'open';
  const limit =
    typeof req.query.limit === 'string'
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100)
      : 30;

  const token = getGitHubToken();
  if (!token) {
    res.status(503).json({ error: 'GitHub token is not configured' });
    return;
  }

  try {
    const params = new URLSearchParams({
      state,
      per_page: String(limit),
      sort: 'updated',
      direction: 'desc',
    });
    const rawPRs = (await githubApi(
      `/repos/${repo}/pulls?${params.toString()}`,
    )) as Array<{
      number: number;
      title: string;
      body?: string | null;
      state: string;
      merged_at: string | null;
      html_url: string;
      created_at: string;
      updated_at: string;
      draft: boolean;
      labels?: Array<{ name: string } | string>;
      user?: { login: string };
      head?: { ref: string };
      base?: { ref: string };
      changed_files?: number;
      additions?: number;
      deletions?: number;
    }>;

    const prs: GitHubPRSummary[] = rawPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      body: pr.body || '',
      state: pr.state,
      merged: Boolean(pr.merged_at),
      labels: (pr.labels || []).map((l) =>
        typeof l === 'string' ? l : l.name,
      ),
      author: pr.user?.login || 'unknown',
      htmlUrl: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headBranch: pr.head?.ref || '',
      baseBranch: pr.base?.ref || '',
      draft: pr.draft,
      reviewStatus: 'unknown',
      ciStatus: 'unknown',
      changedFiles: pr.changed_files || 0,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
    }));

    res.json(prs);
  } catch (err) {
    logger.error({ err, repo }, 'GitHub PRs list failed');
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Could not list pull requests',
    });
  }
});

// PR detail with CI status and linked coding jobs
router.get('/pulls/:number', async (req: Request, res: Response) => {
  const repo = safeRepoParam(req);
  if (!repo) {
    res.status(400).json({ error: 'Valid repo (owner/name) is required' });
    return;
  }

  const prNumber = parseInt(String(req.params.number), 10);
  if (Number.isNaN(prNumber)) {
    res.status(400).json({ error: 'Invalid PR number' });
    return;
  }

  const token = getGitHubToken();
  if (!token) {
    res.status(503).json({ error: 'GitHub token is not configured' });
    return;
  }

  try {
    const raw = (await githubApi(`/repos/${repo}/pulls/${prNumber}`)) as {
      number: number;
      title: string;
      body?: string | null;
      state: string;
      merged_at: string | null;
      html_url: string;
      created_at: string;
      updated_at: string;
      draft: boolean;
      labels?: Array<{ name: string } | string>;
      user?: { login: string };
      head?: { ref: string; sha: string };
      base?: { ref: string };
      changed_files?: number;
      additions?: number;
      deletions?: number;
      commits?: number;
      review_comments?: number;
    };

    // Fetch CI, reviews, and changed files in parallel
    const [checksResult, reviewsResult, filesResult] = await Promise.allSettled([
      githubApi(
        `/repos/${repo}/commits/${raw.head?.sha}/check-runs?per_page=50`,
      ),
      githubApi(`/repos/${repo}/pulls/${prNumber}/reviews?per_page=20`),
      githubApi(`/repos/${repo}/pulls/${prNumber}/files?per_page=100`),
    ]);

    let ciStatus = 'unknown';
    if (checksResult.status === 'fulfilled') {
      const checks = checksResult.value as {
        check_runs?: Array<{ status: string; conclusion: string | null }>;
      };
      const runs = checks.check_runs || [];
      if (runs.length === 0) {
        ciStatus = 'none';
      } else if (runs.some((r) => r.status !== 'completed')) {
        ciStatus = 'pending';
      } else if (
        runs.every(
          (r) => r.conclusion === 'success' || r.conclusion === 'skipped',
        )
      ) {
        ciStatus = 'success';
      } else {
        ciStatus = 'failure';
      }
    }

    let reviewStatus = 'none';
    if (reviewsResult.status === 'fulfilled') {
      const reviews = reviewsResult.value as Array<{ state: string }>;
      if (reviews.some((r) => r.state === 'APPROVED')) {
        reviewStatus = 'approved';
      } else if (reviews.some((r) => r.state === 'CHANGES_REQUESTED')) {
        reviewStatus = 'changes_requested';
      } else if (reviews.some((r) => r.state === 'COMMENTED')) {
        reviewStatus = 'commented';
      }
    }

    let changedFileList: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
    }> = [];
    if (filesResult.status === 'fulfilled') {
      changedFileList = filesResult.value as Array<{
        filename: string;
        status: string;
        additions: number;
        deletions: number;
      }>;
    }

    // Find linked coding jobs
    const allJobs = loadCodingJobs();
    const linkedCodingJobs = allJobs
      .filter(
        (job) =>
          job.repo.toLowerCase() === repo.toLowerCase() &&
          (job.pullRequestNumber === prNumber ||
            (job.prUrl && job.prUrl.includes(`/pull/${prNumber}`))),
      )
      .map((job) => ({
        id: job.id,
        status: job.status,
        branch: job.branch,
      }));

    res.json({
      number: raw.number,
      title: raw.title,
      body: raw.body || '',
      state: raw.state,
      merged: Boolean(raw.merged_at),
      labels: (raw.labels || []).map((l) =>
        typeof l === 'string' ? l : l.name,
      ),
      author: raw.user?.login || 'unknown',
      htmlUrl: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      headBranch: raw.head?.ref || '',
      baseBranch: raw.base?.ref || '',
      draft: raw.draft,
      ciStatus,
      reviewStatus,
      changedFiles: raw.changed_files || 0,
      additions: raw.additions || 0,
      deletions: raw.deletions || 0,
      commits: raw.commits || 0,
      reviewComments: raw.review_comments || 0,
      changedFileList,
      linkedCodingJobs,
    });
  } catch (err) {
    logger.error({ err, repo, prNumber }, 'GitHub PR detail failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not fetch PR',
    });
  }
});

export default router;
