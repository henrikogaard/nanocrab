/**
 * GitHub Copilot agent integration.
 *
 * Features:
 *   - GitHub OAuth flow (web application flow) with multi-account support
 *   - Trigger Copilot coding agent on issues
 *   - List Copilot-created PRs and their status
 *   - Account management (add/remove/switch)
 *
 * Requires: GitHub OAuth App (client_id + client_secret) configured in .env
 *   GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from '../../../config.js';
import { readEnvFile } from '../../../env.js';
import { auditLog } from '../../security.js';
import { logger } from '../../../logger.js';

const router = Router();
const ACCOUNTS_PATH = path.join(STORE_DIR, 'github-accounts.json');

// Encryption for tokens at rest (AES-256-GCM)
function getEncryptionKey(): Buffer {
  // Derive a stable key from the admin password hash (always present)
  const env = readEnvFile(['ADMIN_PASSWORD_HASH']);
  const seed = env.ADMIN_PASSWORD_HASH || 'nanocrab-default-key';
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex')
  );
}

function decryptToken(encrypted: string): string {
  // Support legacy plaintext tokens (not in iv:tag:data format)
  if (!encrypted.includes(':')) return encrypted;
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(dataHex, 'hex')) + decipher.final('utf-8');
}

interface GitHubAccount {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
  accessToken: string;
  scopes: string[];
  copilotEnabled: boolean;
  addedAt: string;
  lastUsed: string | null;
}

interface CopilotJob {
  id: string;
  accountId: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  status: 'pending' | 'working' | 'completed' | 'failed';
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

const JOBS_PATH = path.join(STORE_DIR, 'copilot-jobs.json');

function loadAccounts(): GitHubAccount[] {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

/** Get the decrypted access token for API calls */
function getToken(account: GitHubAccount): string {
  return decryptToken(account.accessToken);
}

function saveAccounts(accounts: GitHubAccount[]): void {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

function loadJobs(): CopilotJob[] {
  try {
    return JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJobs(jobs: CopilotJob[]): void {
  fs.mkdirSync(path.dirname(JOBS_PATH), { recursive: true });
  fs.writeFileSync(JOBS_PATH, JSON.stringify(jobs, null, 2));
}

function getOAuthConfig(): { clientId: string; clientSecret: string } | null {
  const env = readEnvFile([
    'GITHUB_OAUTH_CLIENT_ID',
    'GITHUB_OAUTH_CLIENT_SECRET',
  ]);
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET)
    return null;
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
  };
}

// --- OAuth Flow ---

// Step 1: Generate OAuth URL for user to visit
router.get('/oauth/url', (_req: Request, res: Response) => {
  const config = getOAuthConfig();
  if (!config) {
    res.status(400).json({
      error:
        'GitHub OAuth not configured. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET in credentials.',
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  // Store state temporarily for CSRF protection
  const statesPath = path.join(STORE_DIR, '.oauth-states.json');
  const states: Record<string, number> = (() => {
    try {
      return JSON.parse(fs.readFileSync(statesPath, 'utf-8'));
    } catch {
      return {};
    }
  })();
  // Clean old states (> 5 min)
  const now = Date.now();
  for (const [k, v] of Object.entries(states)) {
    if (now - v > 300000) delete states[k];
  }
  states[state] = now;
  fs.writeFileSync(statesPath, JSON.stringify(states));

  const scopes = 'repo,read:org,copilot';
  const redirectUri = `${_req.protocol}://${_req.get('host')}/api/copilot/oauth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}`;

  res.json({ url, state });
});

// Step 2: OAuth callback — exchange code for token
router.get('/oauth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query;
  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  // Verify state
  const statesPath = path.join(STORE_DIR, '.oauth-states.json');
  let states: Record<string, number> = {};
  try {
    states = JSON.parse(fs.readFileSync(statesPath, 'utf-8'));
  } catch {
    // intentional
  }
  if (!states[state as string]) {
    res.status(400).send('Invalid state — possible CSRF. Try again.');
    return;
  }
  delete states[state as string];
  fs.writeFileSync(statesPath, JSON.stringify(states));

  const config = getOAuthConfig();
  if (!config) {
    res.status(400).send('OAuth not configured');
    return;
  }

  try {
    // Exchange code for token
    const tokenRes = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
        }),
      },
    );
    const tokenData = (await tokenRes.json()) as any;
    if (tokenData.error) {
      res
        .status(400)
        .send(`OAuth error: ${tokenData.error_description || tokenData.error}`);
      return;
    }

    const accessToken = tokenData.access_token;
    const scopes = (tokenData.scope || '').split(',');

    // Fetch user info
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const user = (await userRes.json()) as any;

    // Check if Copilot is available
    let copilotEnabled = false;
    try {
      const copilotRes = await fetch('https://api.github.com/copilot/usage', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      });
      copilotEnabled = copilotRes.status !== 404;
    } catch {
      // Try another endpoint
      copilotEnabled = scopes.includes('copilot');
    }

    // Save account
    const accounts = loadAccounts();
    const existing = accounts.findIndex((a) => a.login === user.login);
    const account: GitHubAccount = {
      id: existing >= 0 ? accounts[existing].id : crypto.randomUUID(),
      login: user.login,
      name: user.name || user.login,
      avatarUrl: user.avatar_url || '',
      accessToken: encryptToken(accessToken),
      scopes,
      copilotEnabled,
      addedAt:
        existing >= 0 ? accounts[existing].addedAt : new Date().toISOString(),
      lastUsed: null,
    };

    if (existing >= 0) {
      accounts[existing] = account;
    } else {
      accounts.push(account);
    }
    saveAccounts(accounts);

    auditLog(req, 'github_account_added', user.login);
    logger.info(
      { login: user.login, copilotEnabled },
      'GitHub account connected',
    );

    // Redirect back to the agents page
    res.redirect('/#/agents');
  } catch (err) {
    logger.error({ err }, 'OAuth callback failed');
    res.status(500).send('OAuth failed. Check server logs.');
  }
});

// --- Account Management ---

router.get('/accounts', (_req: Request, res: Response) => {
  const accounts = loadAccounts();
  // Return accounts without tokens
  res.json(
    accounts.map((a) => ({
      id: a.id,
      login: a.login,
      name: a.name,
      avatarUrl: a.avatarUrl,
      scopes: a.scopes,
      copilotEnabled: a.copilotEnabled,
      addedAt: a.addedAt,
      lastUsed: a.lastUsed,
    })),
  );
});

router.delete('/accounts/:id', (req: Request, res: Response) => {
  const accounts = loadAccounts();
  const idx = accounts.findIndex((a) => a.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const login = accounts[idx].login;
  accounts.splice(idx, 1);
  saveAccounts(accounts);
  auditLog(req, 'github_account_removed', login);
  res.json({ ok: true });
});

// Refresh account info (re-check Copilot status, update profile)
router.post('/accounts/:id/refresh', async (req: Request, res: Response) => {
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === req.params.id);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${getToken(account)}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!userRes.ok) {
      res
        .status(401)
        .json({ error: 'Token expired or revoked. Re-authenticate.' });
      return;
    }
    const user = (await userRes.json()) as any;
    account.name = user.name || user.login;
    account.avatarUrl = user.avatar_url || '';

    // Re-check Copilot
    try {
      const copilotRes = await fetch('https://api.github.com/copilot/usage', {
        headers: {
          Authorization: `Bearer ${getToken(account)}`,
          Accept: 'application/vnd.github+json',
        },
      });
      account.copilotEnabled = copilotRes.status !== 404;
    } catch {
      // intentional
    }
    saveAccounts(accounts);
    res.json({
      ok: true,
      login: account.login,
      copilotEnabled: account.copilotEnabled,
    });
  } catch (_err) {
    res.status(500).json({ error: 'Refresh failed' });
  }
});

// --- Copilot Coding Agent ---

// List repos the account has access to
router.get('/repos/:accountId', async (req: Request, res: Response) => {
  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === req.params.accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    const reposRes = await fetch(
      'https://api.github.com/user/repos?sort=pushed&per_page=20',
      {
        headers: {
          Authorization: `Bearer ${getToken(account)}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    const repos = (await reposRes.json()) as any[];
    res.json(
      repos.map((r: any) => ({
        fullName: r.full_name,
        name: r.name,
        owner: r.owner?.login,
        private: r.private,
        updatedAt: r.pushed_at,
        openIssues: r.open_issues_count,
      })),
    );
  } catch {
    res.status(500).json({ error: 'Failed to fetch repos' });
  }
});

// List issues for a repo
router.get(
  '/issues/:accountId/:owner/:repo',
  async (req: Request, res: Response) => {
    const accounts = loadAccounts();
    const account = accounts.find((a) => a.id === req.params.accountId);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    try {
      const { owner, repo } = req.params;
      const issuesRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=20`,
        {
          headers: {
            Authorization: `Bearer ${getToken(account)}`,
            Accept: 'application/vnd.github+json',
          },
        },
      );
      const issues = (await issuesRes.json()) as any[];
      res.json(
        issues
          .filter((i: any) => !i.pull_request)
          .map((i: any) => ({
            number: i.number,
            title: i.title,
            labels: i.labels?.map((l: any) => l.name) || [],
            assignees: i.assignees?.map((a: any) => a.login) || [],
            createdAt: i.created_at,
            copilotAssigned:
              i.assignees?.some((a: any) => a.login === 'copilot') || false,
          })),
      );
    } catch {
      res.status(500).json({ error: 'Failed to fetch issues' });
    }
  },
);

// Assign Copilot to an issue (triggers the coding agent)
router.post('/assign', async (req: Request, res: Response) => {
  const { accountId, owner, repo, issueNumber } = req.body;
  if (!accountId || !owner || !repo || !issueNumber) {
    res
      .status(400)
      .json({ error: 'accountId, owner, repo, and issueNumber required' });
    return;
  }

  const accounts = loadAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }

  try {
    // Assign Copilot to the issue
    const assignRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/assignees`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken(account)}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ assignees: ['copilot'] }),
      },
    );

    if (!assignRes.ok) {
      const err = (await assignRes.json()) as any;
      res
        .status(assignRes.status)
        .json({ error: err.message || 'Failed to assign Copilot' });
      return;
    }

    // Get issue title
    const issueRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
      {
        headers: {
          Authorization: `Bearer ${getToken(account)}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    const issue = (await issueRes.json()) as any;

    // Track the job
    const jobs = loadJobs();
    const job: CopilotJob = {
      id: crypto.randomUUID(),
      accountId,
      repo: `${owner}/${repo}`,
      issueNumber,
      issueTitle: issue.title || `#${issueNumber}`,
      status: 'pending',
      prUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    jobs.push(job);
    saveJobs(jobs);

    // Update account last used
    account.lastUsed = new Date().toISOString();
    saveAccounts(accounts);

    auditLog(req, 'copilot_assigned', `${owner}/${repo}#${issueNumber}`);
    logger.info(
      { repo: `${owner}/${repo}`, issue: issueNumber },
      'Copilot assigned to issue',
    );

    res.json({ ok: true, job });
  } catch (err) {
    logger.error({ err }, 'Failed to assign Copilot');
    res.status(500).json({ error: 'Failed to assign Copilot to issue' });
  }
});

// List jobs and check their status
router.get('/jobs', async (_req: Request, res: Response) => {
  const jobs = loadJobs();
  const accounts = loadAccounts();

  // Check status of recent pending/working jobs
  for (const job of jobs.filter(
    (j) => j.status === 'pending' || j.status === 'working',
  )) {
    const account = accounts.find((a) => a.id === job.accountId);
    if (!account) continue;

    try {
      const [owner, repo] = job.repo.split('/');
      // Check if Copilot created a PR for this issue
      const prsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=10`,
        {
          headers: {
            Authorization: `Bearer ${getToken(account)}`,
            Accept: 'application/vnd.github+json',
          },
        },
      );
      const prs = (await prsRes.json()) as any[];
      const relatedPr = prs.find(
        (pr: any) =>
          pr.body?.includes(`#${job.issueNumber}`) ||
          pr.title?.includes(`#${job.issueNumber}`) ||
          pr.head?.ref?.includes(String(job.issueNumber)),
      );

      if (relatedPr) {
        job.status = 'completed';
        job.prUrl = relatedPr.html_url;
        job.updatedAt = new Date().toISOString();
      } else {
        job.status = 'working';
        job.updatedAt = new Date().toISOString();
      }
    } catch {
      // Keep current status
    }
  }

  saveJobs(jobs);
  res.json(
    jobs
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 20),
  );
});

// Delete a job
router.delete('/jobs/:id', (req: Request, res: Response) => {
  const jobs = loadJobs();
  const idx = jobs.findIndex((j) => j.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  jobs.splice(idx, 1);
  saveJobs(jobs);
  res.json({ ok: true });
});

// --- Status ---

router.get('/status', (_req: Request, res: Response) => {
  const config = getOAuthConfig();
  const accounts = loadAccounts();
  const jobs = loadJobs();

  res.json({
    configured: !!config,
    accountCount: accounts.length,
    accounts: accounts.map((a) => ({
      id: a.id,
      login: a.login,
      name: a.name,
      copilotEnabled: a.copilotEnabled,
    })),
    activeJobs: jobs.filter(
      (j) => j.status === 'pending' || j.status === 'working',
    ).length,
    totalJobs: jobs.length,
  });
});

export default router;
