import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { DATA_DIR, STORE_DIR } from './config.js';
import { getGitHubToken, loadCodingRepos } from './coding-jobs.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface Workspace {
  id: string;
  repo: string;
  branch: string;
  path: string;
  ownerType: 'agent' | 'job' | 'manual';
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'cleaning';
}

export interface CreateWorkspaceInput {
  repo: string;
  branch?: string;
  ownerType?: 'agent' | 'job' | 'manual';
  ownerId?: string;
  ttlMinutes?: number;
}

const WORKSPACES_DIR = path.resolve(DATA_DIR, 'workspaces');
const WORKSPACES_DB_PATH = path.join(STORE_DIR, 'workspaces.json');
const DEFAULT_TTL_MINUTES = 120;
const MAX_CONCURRENT_WORKSPACES = 20;
const GIT_TIMEOUT_MS = 60_000;

function readWorkspaces(): Workspace[] {
  try {
    return JSON.parse(
      fs.readFileSync(WORKSPACES_DB_PATH, 'utf-8'),
    ) as Workspace[];
  } catch {
    return [];
  }
}

function writeWorkspaces(workspaces: Workspace[]): void {
  fs.mkdirSync(path.dirname(WORKSPACES_DB_PATH), { recursive: true });
  fs.writeFileSync(
    WORKSPACES_DB_PATH,
    JSON.stringify(workspaces, null, 2) + '\n',
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function assertSafeRepo(repo: string): void {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('repo must be in owner/name format');
  }
}

function assertSafeBranch(branch: string): void {
  if (!/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..')) {
    throw new Error('branch contains invalid characters');
  }
}

const REPOS_DIR = path.resolve(WORKSPACES_DIR, 'repos');

async function resolveRepoPath(repo: string): Promise<string> {
  // Verify repo is registered for coding
  const repos = loadCodingRepos();
  const codingRepo = repos.find(
    (r) => r.fullName.toLowerCase() === repo.toLowerCase(),
  );
  if (!codingRepo) {
    throw new Error(`Repo ${repo} is not registered for coding jobs`);
  }

  // Maintain a shared clone under data/workspaces/repos/{slug}
  const repoDirName = repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const clonePath = path.resolve(REPOS_DIR, repoDirName);

  if (fs.existsSync(path.join(clonePath, '.git'))) {
    if (fs.lstatSync(clonePath).isSymbolicLink()) {
      throw new Error('Registered repository clone must not be a symlink');
    }
    // Fetch latest to keep the clone current
    try {
      await runGitWithCredential('git', ['fetch', '--prune'], {
        cwd: clonePath,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch {
      // Non-critical — worktree can still be created from existing refs
    }
    return clonePath;
  }

  // Clone the repo
  fs.mkdirSync(REPOS_DIR, { recursive: true });
  const cloneUrl = `https://github.com/${repo}.git`;

  try {
    await runGitWithCredential(
      'git',
      ['clone', '--no-checkout', cloneUrl, clonePath],
      { timeout: GIT_TIMEOUT_MS },
    );
  } catch (err) {
    throw new Error(
      `Failed to clone ${repo}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return clonePath;
}

async function runGitWithCredential(
  command: string,
  args: string[],
  options: { cwd?: string; timeout: number },
): Promise<{ stdout: string; stderr: string }> {
  const token = getGitHubToken();
  const askpassPath = path.join(
    fs.mkdtempSync(path.join('/tmp', 'nanocrab-git-')),
    'askpass.sh',
  );
  fs.writeFileSync(
    askpassPath,
    '#!/bin/sh\nprintf "%s" "$NANOCRAB_GIT_TOKEN"\n',
    { mode: 0o700 },
  );
  try {
    const result = await execFileAsync(command, args, {
      ...options,
      env: {
        ...process.env,
        ...(token
          ? {
              GIT_ASKPASS: askpassPath,
              GIT_TERMINAL_PROMPT: '0',
              NANOCRAB_GIT_TOKEN: token,
            }
          : { GIT_TERMINAL_PROMPT: '0' }),
      },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    fs.rmSync(path.dirname(askpassPath), { recursive: true, force: true });
  }
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  assertSafeRepo(input.repo);
  const branch =
    input.branch || `nanocrab/ws-${crypto.randomUUID().slice(0, 8)}`;
  assertSafeBranch(branch);

  const workspaces = readWorkspaces();
  const activeCount = workspaces.filter((w) => w.status === 'active').length;
  if (activeCount >= MAX_CONCURRENT_WORKSPACES) {
    throw new Error(
      `Maximum concurrent workspaces (${MAX_CONCURRENT_WORKSPACES}) reached. Clean up expired workspaces first.`,
    );
  }

  const repoPath = await resolveRepoPath(input.repo);
  const id = crypto.randomUUID().slice(0, 8);

  const workspacePath = path.resolve(WORKSPACES_DIR, id);

  // Validate no path escaping
  if (!workspacePath.startsWith(WORKSPACES_DIR)) {
    throw new Error('Invalid workspace path');
  }

  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });

  // Create the worktree
  try {
    await execFileAsync(
      'git',
      ['worktree', 'add', '-b', branch, workspacePath],
      { cwd: repoPath, timeout: GIT_TIMEOUT_MS },
    );
  } catch (err) {
    // If branch already exists, try without -b
    try {
      await execFileAsync('git', ['worktree', 'add', workspacePath, branch], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch (retryErr) {
      throw new Error(
        `Failed to create worktree: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
  }

  const ttlMinutes = Math.min(
    Math.max(input.ttlMinutes || DEFAULT_TTL_MINUTES, 5),
    1440, // max 24h
  );
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000);

  const workspace: Workspace = {
    id,
    repo: input.repo,
    branch,
    path: workspacePath,
    ownerType: input.ownerType || 'manual',
    ownerId: input.ownerId || 'admin',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active',
  };

  workspaces.push(workspace);
  writeWorkspaces(workspaces);

  logger.info(
    { id, repo: input.repo, branch, path: workspacePath },
    'Workspace created',
  );
  return workspace;
}

export function listWorkspaces(): Workspace[] {
  const workspaces = readWorkspaces();
  const now = Date.now();
  let changed = false;

  for (const ws of workspaces) {
    if (ws.status === 'active' && new Date(ws.expiresAt).getTime() < now) {
      ws.status = 'expired';
      changed = true;
    }
  }

  if (changed) writeWorkspaces(workspaces);
  return workspaces;
}

export function getWorkspace(id: string): Workspace | undefined {
  return readWorkspaces().find((w) => w.id === id);
}

export async function cleanupWorkspace(id: string): Promise<boolean> {
  const workspaces = readWorkspaces();
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return false;

  ws.status = 'cleaning';
  writeWorkspaces(workspaces);

  try {
    // Remove the worktree
    const repoPath = await resolveRepoPath(ws.repo);
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', ws.path], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch {
      // If git worktree remove fails, try manual cleanup
      // Validate path is within WORKSPACES_DIR before force-removing
      if (ws.path.startsWith(WORKSPACES_DIR) && fs.existsSync(ws.path)) {
        fs.rmSync(ws.path, { recursive: true, force: true });
      }
      // Prune worktree entries
      try {
        await execFileAsync('git', ['worktree', 'prune'], {
          cwd: repoPath,
          timeout: GIT_TIMEOUT_MS,
        });
      } catch {
        // Non-critical
      }
    }

    // Remove from registry
    const remaining = workspaces.filter((w) => w.id !== id);
    writeWorkspaces(remaining);

    logger.info({ id, repo: ws.repo }, 'Workspace cleaned up');
    return true;
  } catch (err) {
    logger.error({ err, id }, 'Workspace cleanup failed');
    ws.status = 'active'; // Restore status on failure
    writeWorkspaces(workspaces);
    return false;
  }
}

export async function cleanupExpiredWorkspaces(): Promise<number> {
  const workspaces = listWorkspaces();
  const expired = workspaces.filter((w) => w.status === 'expired');
  let cleaned = 0;

  for (const ws of expired) {
    const success = await cleanupWorkspace(ws.id);
    if (success) cleaned++;
  }

  if (cleaned > 0) {
    logger.info({ cleaned }, 'Expired workspaces cleaned up');
  }
  return cleaned;
}

// Periodic cleanup — call from the main loop
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startWorkspaceCleanup(intervalMs = 5 * 60_000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupExpiredWorkspaces().catch((err) => {
      logger.error({ err }, 'Workspace cleanup interval failed');
    });
  }, intervalMs);
  cleanupInterval.unref();
}

export function stopWorkspaceCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
