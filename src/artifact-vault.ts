import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import type { ReportJob } from './report-jobs.js';

export interface ArtifactSourceLink {
  label: string;
  source: string;
  url?: string;
}

export interface ArtifactVaultRecord {
  id: string;
  title: string;
  kind: string;
  format: string;
  path: string;
  sizeBytes: number;
  sourceType: string;
  sourceId: string;
  sourceArtifactIndex: number | null;
  sourceLinks: ArtifactSourceLink[];
  createdAt: string;
  updatedAt: string;
  retentionDays: number;
  expiresAt: string | null;
  tags: string[];
}

export interface ArtifactVaultSearch {
  query?: string;
  kind?: string;
  format?: string;
  source?: string;
  includeExpired?: boolean;
  limit?: number;
  now?: Date;
}

export interface BuildArtifactVaultInput {
  reports: ReportJob[];
  now?: Date;
  retentionDays?: number;
}

export interface PruneArtifactVaultInput {
  now?: Date;
}

const ARTIFACT_VAULT_PATH = path.join(STORE_DIR, 'artifact-vault.json');
const DEFAULT_RETENTION_DAYS = 90;

function nowIso(now?: Date): string {
  return (now || new Date()).toISOString();
}

function readRecords(): ArtifactVaultRecord[] {
  try {
    const records = JSON.parse(fs.readFileSync(ARTIFACT_VAULT_PATH, 'utf-8'));
    if (!Array.isArray(records)) return [];
    return records.map(normalizeRecord).filter((record) => record.id);
  } catch {
    return [];
  }
}

function writeRecords(records: ArtifactVaultRecord[]): void {
  fs.mkdirSync(path.dirname(ARTIFACT_VAULT_PATH), { recursive: true });
  fs.writeFileSync(
    ARTIFACT_VAULT_PATH,
    `${JSON.stringify(records.map(normalizeRecord), null, 2)}\n`,
  );
}

function normalizeSourceLinks(value: unknown): ArtifactSourceLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item as Partial<ArtifactSourceLink>;
      return {
        label: String(record.label || record.source || '').slice(0, 180),
        source: String(record.source || '').slice(0, 240),
        url:
          typeof record.url === 'string' && record.url.trim()
            ? record.url
            : undefined,
      };
    })
    .filter((item) => item.source);
}

function normalizeRecord(
  value: Partial<ArtifactVaultRecord> | Record<string, unknown>,
): ArtifactVaultRecord {
  const updatedAt =
    typeof value.updatedAt === 'string' && value.updatedAt
      ? value.updatedAt
      : nowIso();
  const retentionDays =
    typeof value.retentionDays === 'number' && value.retentionDays > 0
      ? Math.floor(value.retentionDays)
      : DEFAULT_RETENTION_DAYS;
  return {
    id: String(value.id || ''),
    title: String(value.title || 'Untitled artifact'),
    kind: String(value.kind || 'artifact'),
    format: String(value.format || 'file'),
    path: String(value.path || ''),
    sizeBytes:
      typeof value.sizeBytes === 'number' && value.sizeBytes >= 0
        ? value.sizeBytes
        : 0,
    sourceType: String(value.sourceType || 'unknown'),
    sourceId: String(value.sourceId || ''),
    sourceArtifactIndex:
      typeof value.sourceArtifactIndex === 'number' &&
      value.sourceArtifactIndex >= 0
        ? Math.floor(value.sourceArtifactIndex)
        : null,
    sourceLinks: normalizeSourceLinks(value.sourceLinks),
    createdAt:
      typeof value.createdAt === 'string' && value.createdAt
        ? value.createdAt
        : updatedAt,
    updatedAt,
    retentionDays,
    expiresAt:
      typeof value.expiresAt === 'string' && value.expiresAt
        ? value.expiresAt
        : null,
    tags: Array.isArray(value.tags)
      ? value.tags.map((tag) => String(tag)).filter(Boolean)
      : [],
  };
}

function artifactId(sourceId: string, artifactPath: string): string {
  return `${sourceId}:${path.basename(artifactPath)}`;
}

function expiresAt(updatedAt: string, retentionDays: number): string | null {
  if (retentionDays <= 0) return null;
  const time = Date.parse(updatedAt);
  if (!Number.isFinite(time)) return null;
  return new Date(time + retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function isExpired(record: ArtifactVaultRecord, now = new Date()): boolean {
  if (!record.expiresAt) return false;
  const time = Date.parse(record.expiresAt);
  return Number.isFinite(time) && time <= now.getTime();
}

export function listArtifactVault(
  input: ArtifactVaultSearch = {},
): ArtifactVaultRecord[] {
  return searchArtifactVault(input);
}

export function searchArtifactVault(
  input: ArtifactVaultSearch = {},
): ArtifactVaultRecord[] {
  const query = (input.query || '').trim().toLowerCase();
  const source = (input.source || '').trim().toLowerCase();
  const now = input.now || new Date();
  return readRecords()
    .filter((record) => input.includeExpired || !isExpired(record, now))
    .filter((record) => !input.kind || record.kind === input.kind)
    .filter((record) => !input.format || record.format === input.format)
    .filter(
      (record) =>
        !source ||
        record.sourceLinks.some((link) =>
          `${link.label} ${link.source} ${link.url || ''}`
            .toLowerCase()
            .includes(source),
        ),
    )
    .filter((record) => {
      if (!query) return true;
      const haystack = [
        record.title,
        record.kind,
        record.format,
        record.path,
        record.sourceType,
        record.sourceId,
        ...record.tags,
        ...record.sourceLinks.flatMap((link) => [link.label, link.source]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.min(Math.max(input.limit || 100, 1), 500));
}

export function buildArtifactVaultFromReports(input: BuildArtifactVaultInput): {
  added: number;
  updated: number;
  total: number;
} {
  const records = readRecords();
  const byId = new Map(records.map((record) => [record.id, record]));
  let added = 0;
  let updated = 0;
  const generatedAt = nowIso(input.now);
  const retentionDays = input.retentionDays || DEFAULT_RETENTION_DAYS;

  for (const report of input.reports) {
    for (const [index, artifact] of (report.artifacts || []).entries()) {
      const id = artifactId(report.id, artifact.path);
      const record = normalizeRecord({
        id,
        title: report.title,
        kind: 'report',
        format: artifact.format,
        path: artifact.path,
        sizeBytes: fileSize(artifact.path),
        sourceType: 'report-job',
        sourceId: report.id,
        sourceArtifactIndex: index,
        sourceLinks: report.citations,
        createdAt: report.createdAt || generatedAt,
        updatedAt: report.updatedAt || generatedAt,
        retentionDays,
        expiresAt: expiresAt(report.updatedAt || generatedAt, retentionDays),
        tags: ['report', ...report.sourceScopes],
      });
      if (byId.has(id)) updated++;
      else added++;
      byId.set(id, record);
    }
  }

  const next = Array.from(byId.values());
  writeRecords(next);
  return { added, updated, total: next.length };
}

export function pruneArtifactVault(input: PruneArtifactVaultInput = {}): {
  removed: number;
  remaining: number;
} {
  const now = input.now || new Date();
  const records = readRecords();
  const kept = records.filter((record) => !isExpired(record, now));
  writeRecords(kept);
  return { removed: records.length - kept.length, remaining: kept.length };
}
