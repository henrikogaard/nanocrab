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
import { auditLog } from '../../security.js';
import { getState } from '../../state.js';
import { logger } from '../../../logger.js';
import {
  approveCodingJob,
  approveCodingJobPr,
  cancelCodingJob,
  denyCodingJob,
  getCodingJob,
  listGitHubIssues,
  loadCodingJobs,
  openCodingJobPr,
  refreshCodingJobCi,
  registerCodingRepo,
  retryCodingJob,
  startCodingJob,
} from '../../../coding-jobs.js';

const router = Router();
const PROJECTS_PATH = path.join(STORE_DIR, 'autofix-projects.json');
const JOBS_PATH = path.join(STORE_DIR, 'autofix-jobs.json');

interface Project {
  id: string;
  owner: string;
  repo: string;
  workDir: string;
  triggerLabel: string;
  model: string;
  notifyJid: string; // bot channel to notify
  autoReview: boolean; // auto-review new PRs
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

function loadProjects(): Project[] {
  try {
    return JSON.parse(fs.readFileSync(PROJECTS_PATH, 'utf-8'));
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
  const { owner, repo, workDir, triggerLabel, model, notifyJid, autoReview } =
    req.body;
  if (!owner || !repo) {
    res.status(400).json({ error: 'owner and repo required' });
    return;
  }

  const project: Project = {
    id: crypto.randomUUID(),
    owner,
    repo,
    workDir:
      workDir ||
      path.join(process.env.HOME || '/tmp', 'repos', `${owner}-${repo}`),
    triggerLabel: triggerLabel || 'autofix',
    model: model || 'sonnet',
    notifyJid: notifyJid || '',
    autoReview: autoReview || false,
    createdAt: new Date().toISOString(),
  };

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

router.put('/projects/:id', (req: Request, res: Response) => {
  const projects = loadProjects();
  const project = projects.find((p) => p.id === req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  const fields = [
    'workDir',
    'triggerLabel',
    'model',
    'notifyJid',
    'autoReview',
  ];
  for (const f of fields) {
    if (req.body[f] !== undefined) (project as any)[f] = req.body[f];
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

router.get('/issues', async (req: Request, res: Response) => {
  try {
    const repo = String(req.query.repo || '');
    const labels =
      typeof req.query.labels === 'string' && req.query.labels.trim()
        ? req.query.labels
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean)
        : undefined;
    const assignee =
      typeof req.query.assignee === 'string' && req.query.assignee.trim()
        ? req.query.assignee.trim()
        : undefined;
    const milestone =
      typeof req.query.milestone === 'string' && req.query.milestone.trim()
        ? req.query.milestone.trim()
        : undefined;
    const issueNumber =
      typeof req.query.issueNumber === 'string' && req.query.issueNumber.trim()
        ? Number(req.query.issueNumber)
        : undefined;
    const issues = await listGitHubIssues({
      repo,
      labels,
      assignee,
      milestone,
      issueNumber:
        issueNumber && Number.isInteger(issueNumber) ? issueNumber : undefined,
    });
    res.json(issues);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// --- Run an autofix ---

async function runAutofix(
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
      } catch {}
    }
  }

  // Create branch
  try {
    execFileSync('git', ['checkout', '-B', branch], {
      cwd: workDir,
      stdio: 'pipe',
    });
  } catch {}

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
      } catch {}

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
        } catch {}
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
  const { projectId, issueNumber, model } = req.body;
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
    const job = await startCodingJob({
      repo: `${project.owner}/${project.repo}`,
      issueNumber: Number(issueNumber),
      provider: 'claude',
      model: typeof model === 'string' && model.trim() ? model : undefined,
      createPr: true,
      requestedBy: req.user?.username || 'autofix-dashboard',
    });
    auditLog(
      req,
      'autofix_triggered',
      `${project.owner}/${project.repo}#${issueNumber}`,
    );
    res.json({ ok: true, jobId: job.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
        await startCodingJob({
          repo: fullName,
          issueNumber: issue.number,
          provider: 'claude',
          createPr: true,
          requestedBy: 'github-webhook',
        });
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
        await startCodingJob({
          repo: fullName,
          issueNumber: issue.number,
          provider: 'claude',
          createPr: true,
          requestedBy: 'github-webhook',
        });
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
      } catch {}
    });
  }
}

export default router;
