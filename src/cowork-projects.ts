import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import type { CoworkProject } from './types.js';

export const COWORK_PROJECTS_DIR = path.join(STORE_DIR, 'projects');
export const COWORK_PROJECT_FILE_PREVIEW_LIMIT = 256 * 1024;

export function coworkProjectPath(project: CoworkProject): string {
  return path.join(COWORK_PROJECTS_DIR, project.slug);
}

export function ensureCoworkProjectFolder(project: CoworkProject): string {
  const folder = coworkProjectPath(project);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function safeCoworkProjectFilePath(input: string): string | null {
  const clean = input.replace(/\\/g, '/').trim();
  if (!clean || clean.startsWith('/') || clean.includes('\0')) return null;
  const normalized = path.posix.normalize(clean);
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized === '..'
  ) {
    return null;
  }
  return normalized;
}

export function classifyCoworkProjectFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (['.md', '.markdown', '.txt', '.doc', '.docx', '.pdf'].includes(ext)) {
    return 'document';
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
    return 'image';
  }
  return 'artifact';
}

export function isPreviewableCoworkProjectFile(filePath: string): boolean {
  return [
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.jsonl',
    '.csv',
    '.yaml',
    '.yml',
    '.xml',
    '.html',
    '.css',
    '.js',
    '.ts',
    '.log',
  ].includes(path.extname(filePath).toLowerCase());
}

export function resolveCoworkProjectFile(
  project: CoworkProject,
  rawPath: unknown,
):
  | { rel: string; root: string; target: string; stat: fs.Stats }
  | { error: string; status: number } {
  const raw = Array.isArray(rawPath) ? rawPath[0] : rawPath;
  const rel = safeCoworkProjectFilePath(typeof raw === 'string' ? raw : '');
  if (!rel) {
    return { error: 'Invalid project file path', status: 400 };
  }

  const root = ensureCoworkProjectFolder(project);
  const target = path.join(root, rel);
  if (!fs.existsSync(target)) {
    return { error: 'Project file not found', status: 404 };
  }
  const stat = fs.statSync(target);
  if (!stat.isFile()) {
    return { error: 'Project file not found', status: 404 };
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    return { error: 'Invalid project file path', status: 400 };
  }

  return { rel, root: realRoot, target: realTarget, stat };
}

export function listCoworkProjectFiles(project: CoworkProject): Array<{
  path: string;
  kind: string;
  size: number;
  updatedAt: string;
}> {
  const root = ensureCoworkProjectFolder(project);
  const files: Array<{
    path: string;
    kind: string;
    size: number;
    updatedAt: string;
  }> = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(full);
      const rel = path.relative(root, full).split(path.sep).join('/');
      files.push({
        path: rel,
        kind: classifyCoworkProjectFile(rel),
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }

  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function writeCoworkProjectFile(
  project: CoworkProject,
  filePath: string,
  content: string,
): {
  path: string;
  kind: string;
  size: number;
  updatedAt: string;
  hostPath: string;
} {
  const rel = safeCoworkProjectFilePath(filePath);
  if (!rel) throw new Error('Invalid project file path');
  const root = ensureCoworkProjectFolder(project);
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf-8');
  const stat = fs.statSync(target);
  return {
    path: rel,
    kind: classifyCoworkProjectFile(rel),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    hostPath: target,
  };
}
