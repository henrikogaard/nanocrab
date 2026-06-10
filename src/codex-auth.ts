import fs from 'fs';
import os from 'os';
import path from 'path';

import { DATA_DIR } from './config.js';

export interface CodexAuthStatus {
  configured: boolean;
  persistedDir: string;
  hostDir: string;
  hasPersistedAuth: boolean;
  hasHostAuth: boolean;
  imported: boolean;
}

const CODEX_AUTH_FILES = ['auth.json', 'config.toml', 'version.json'];

export function getCodexPersistedDir(): string {
  return path.join(DATA_DIR, 'codex');
}

export function getHostCodexDir(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function hasAuthFile(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'auth.json'));
}

function copyIfPresent(srcDir: string, dstDir: string, filename: string): void {
  const src = path.join(srcDir, filename);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, filename));
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const persistedDir = getCodexPersistedDir();
  const hostDir = getHostCodexDir();
  const hasPersistedAuth = hasAuthFile(persistedDir);
  const hasHostAuth = hasAuthFile(hostDir);

  return {
    configured: hasPersistedAuth,
    persistedDir,
    hostDir,
    hasPersistedAuth,
    hasHostAuth,
    imported: false,
  };
}

export function importHostCodexAuth(): CodexAuthStatus {
  const status = getCodexAuthStatus();
  if (status.hasPersistedAuth || !status.hasHostAuth) return status;

  for (const file of CODEX_AUTH_FILES) {
    copyIfPresent(status.hostDir, status.persistedDir, file);
  }

  try {
    fs.chmodSync(path.join(status.persistedDir, 'auth.json'), 0o600);
  } catch {
    // Best effort; container mount permissions vary by runtime.
  }

  return {
    ...getCodexAuthStatus(),
    imported: true,
  };
}

export function ensureCodexOAuth(): CodexAuthStatus {
  const status = getCodexAuthStatus();
  if (status.hasPersistedAuth) return status;
  return importHostCodexAuth();
}
