import fs from 'fs';
import path from 'path';

import { GROUPS_DIR, STORE_DIR } from './config.js';
import { listReportJobs } from './report-jobs.js';

export type ArtifactKind = 'group' | 'deliverable';

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  name: string;
  path: string;
  relativePath: string;
  extension: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  expired: boolean;
  sourceLinks: Array<{ label: string; source: string }>;
}

export interface ArtifactVaultOptions {
  query?: string;
  kind?: ArtifactKind;
  retentionDays?: number;
  includeExpired?: boolean;
  limit?: number;
}

const DEFAULT_RETENTION_DAYS = 90;
const MAX_FILE_SIZE = 200 * 1024 * 1024;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function artifactId(kind: ArtifactKind, relativePath: string): string {
  return `${kind}:${relativePath.replace(/\\/g, '/')}`;
}

function walkFiles(root: string, maxDepth = 4): string[] {
  const files: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath, depth + 1);
      else files.push(fullPath);
    }
  }
  walk(root, 0);
  return files;
}

function reportSources(): Map<
  string,
  Array<{ label: string; source: string }>
> {
  const map = new Map<string, Array<{ label: string; source: string }>>();
  for (const job of listReportJobs()) {
    for (const artifact of job.artifacts || []) {
      map.set(path.resolve(artifact.path), [
        { label: job.title, source: `report-job:${job.id}` },
        ...job.citations.map((citation) => ({
          label: citation.label,
          source: citation.source,
        })),
      ]);
    }
  }
  return map;
}

function makeRecord(input: {
  kind: ArtifactKind;
  root: string;
  filePath: string;
  retentionDays: number;
  sourceLinks: Array<{ label: string; source: string }>;
}): ArtifactRecord | null {
  const stat = fs.statSync(input.filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_SIZE) return null;
  const relativePath = path.relative(input.root, input.filePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath))
    return null;
  const updatedAt = iso(stat.mtimeMs);
  const createdAt = iso(stat.birthtimeMs || stat.ctimeMs);
  const expiresAt =
    input.retentionDays > 0
      ? iso(stat.mtimeMs + input.retentionDays * 24 * 60 * 60 * 1000)
      : null;
  return {
    id: artifactId(input.kind, relativePath),
    kind: input.kind,
    name: path.basename(input.filePath),
    path: input.filePath,
    relativePath,
    extension: path.extname(input.filePath).replace(/^\./, '').toLowerCase(),
    size: stat.size,
    createdAt,
    updatedAt,
    expiresAt,
    expired: expiresAt ? Date.parse(expiresAt) < Date.now() : false,
    sourceLinks: input.sourceLinks,
  };
}

export function listArtifactVault(
  options: ArtifactVaultOptions = {},
): ArtifactRecord[] {
  const retentionDays = Math.max(
    0,
    Math.min(options.retentionDays ?? DEFAULT_RETENTION_DAYS, 3650),
  );
  const limit = Math.min(Math.max(options.limit || 100, 1), 1000);
  const sources = reportSources();
  const records: ArtifactRecord[] = [];

  const deliverablesRoot = path.join(STORE_DIR, 'deliverables');
  for (const filePath of walkFiles(deliverablesRoot)) {
    const record = makeRecord({
      kind: 'deliverable',
      root: deliverablesRoot,
      filePath,
      retentionDays,
      sourceLinks: sources.get(path.resolve(filePath)) || [],
    });
    if (record) records.push(record);
  }

  for (const groupArtifactsDir of walkFiles(GROUPS_DIR, 6).filter((filePath) =>
    filePath.includes(`${path.sep}artifacts${path.sep}`),
  )) {
    const groupRoot = GROUPS_DIR;
    const record = makeRecord({
      kind: 'group',
      root: groupRoot,
      filePath: groupArtifactsDir,
      retentionDays,
      sourceLinks: [],
    });
    if (record) records.push(record);
  }

  const query = options.query?.trim().toLowerCase();
  return records
    .filter((record) => !options.kind || record.kind === options.kind)
    .filter((record) => options.includeExpired || !record.expired)
    .filter((record) => {
      if (!query) return true;
      const haystack = [
        record.name,
        record.relativePath,
        record.extension,
        ...record.sourceLinks.flatMap((link) => [link.label, link.source]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}
