import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { DATA_DIR, STORE_DIR } from './config.js';
import { loadCodingRepos } from './coding-jobs.js';
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

function resolveRepoPath(repo: string): string {
  // Look up the repo's local clone path from coding repos config
  const repos = loadCodingRepos();
  const codingRepo = repos.find(
    (r) => r.fullName.toLowerCase() === repo.toLowerCase(),
  );
  if (!codingRepo) {
    throw new Error(`Repo ${repo} is not registered for coding jobs`);
  }
  // The coding workspace stores clones under a predictable path
  const repoDirName = repo.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const clonePath = path.resolve(
    DATA_DIR,
    'coding-workspaces',
    'repos',
    repoDirName,
  );
  if (!fs.existsSync(clonePath)) {
    throw new Error(
      `No local clone found for ${repo} at ${clonePath}. Run a coding job first to establish the clone.`,
    );
  }
  return clonePath;
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<Workspace> {
  assertSafeRepo(input.repo);

  const workspaces = readWorkspaces();
  const activeCount = workspaces.filter((w) => w.status === 'active').length;
  if (activeCount >= MAX_CONCURRENT_WORKSPACES) {
    throw new Error(
      `Maximum concurrent workspaces (${MAX_CONCURRENT_WORKSPACES}) reached. Clean up expired workspaces first.`,
    );
  }

  const repoPath = resolveRepoPath(input.repo);
  const id = crypto.randomUUID().slice(0, 8);
  const branch = input.branch || `nanocrab/ws-${id}`;
  assertSafeBranch(branch);

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
    const repoPath = resolveRepoPath(ws.repo);
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', ws.path], {
        cwd: repoPath,
        timeout: GIT_TIMEOUT_MS,
      });
    } catch {
      // If git worktree remove fails, try manual cleanup
      if (fs.existsSync(ws.path)) {
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
