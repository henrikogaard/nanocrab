import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';
import {
  createMemory,
  listMemories,
  reviewMemory,
  getMemoryById,
} from './db.js';
import {
  MemoryRecord,
  MemoryScope,
  MemoryStatus,
  MemoryType,
  MemoryVisibility,
} from './types.js';

const MEMORY_SCOPES: MemoryScope[] = [
  'global',
  'group',
  'user',
  'project',
  'repo',
];
const MEMORY_TYPES: MemoryType[] = [
  'preference',
  'fact',
  'habit',
  'relationship',
  'project',
  'credential-note',
  'game-knowledge',
  'warning',
];
const MEMORY_VISIBILITIES: MemoryVisibility[] = [
  'private',
  'group',
  'global',
  'superuser-only',
];

export interface ProposeMemoryInput {
  scope: string;
  type: string;
  content: string;
  source?: string;
  sourceLinks?: string[];
  confidence?: number;
  visibility?: string;
  createdBy?: string;
  expiresAt?: string | null;
  sensitivity?: 'normal' | 'sensitive' | 'secret-note';
  staleAfter?: string | null;
}

export interface MemoryReviewFilters {
  status?: MemoryStatus;
  scope?: string;
  visibility?: string;
  source?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  staleBefore?: string;
  contradictionGroup?: string;
  limit?: number;
}

export interface RefreshMemoryReviewOptions {
  now?: string;
  staleAfterDays?: number;
}

export interface MemoryProvenanceTimelineEvent {
  id: string;
  type:
    | 'memory.proposed'
    | 'memory.approved'
    | 'memory.rejected'
    | 'memory.stale'
    | 'memory.contradicted';
  timestamp: string;
  subjectId: string;
  subjectName: string;
  actor: string;
  summary: string;
  metadata: {
    scope: MemoryScope;
    visibility: MemoryVisibility;
    source: string | null;
    confidence: number;
    sensitivity: MemoryRecord['sensitivity'];
  };
}

function assertChoice<T extends string>(
  name: string,
  value: string,
  choices: readonly T[],
): asserts value is T {
  if (!choices.includes(value as T)) {
    throw new Error(`${name} must be one of: ${choices.join(', ')}`);
  }
}

function normalizeConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

function detectSensitivity(
  content: string,
): 'normal' | 'sensitive' | 'secret-note' {
  if (
    /\b(api[_ -]?key|token|password|secret|private key|oauth)\b/i.test(content)
  ) {
    return 'secret-note';
  }
  if (/\b(address|phone|email|health|salary|personal)\b/i.test(content)) {
    return 'sensitive';
  }
  return 'normal';
}

function normalizedMemorySubject(content: string): string {
  return content
    .toLowerCase()
    .replace(/\bdoes not\b|\bdo not\b|\bis not\b|\bare not\b/g, ' ')
    .replace(/\bno longer\b|\bnever\b|\bnot\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(prefers|preference)\b/g, 'prefer')
    .replace(/\b(updates|summaries|notes|windows)\b/g, (match) =>
      match.replace(/s$/, ''),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMemoryNegation(content: string): boolean {
  return /\b(does not|do not|is not|are not|no longer|never|not)\b/i.test(
    content,
  );
}

function memoriesConflict(a: MemoryRecord, b: MemoryRecord): boolean {
  return (
    normalizedMemorySubject(a.content) === normalizedMemorySubject(b.content) &&
    hasMemoryNegation(a.content) !== hasMemoryNegation(b.content)
  );
}

function findContradiction(content: string): string | null {
  const normalizedSubject = normalizedMemorySubject(content);
  const negated = hasMemoryNegation(content);
  const candidates = listMemories({ status: 'approved', limit: 200 });
  for (const memory of candidates) {
    if (
      normalizedMemorySubject(memory.content) === normalizedSubject &&
      hasMemoryNegation(memory.content) !== negated
    ) {
      return memory.id;
    }
  }
  return null;
}

export function proposeMemory(input: ProposeMemoryInput): MemoryRecord {
  const scope = input.scope || 'group';
  const type = input.type || 'fact';
  const visibility =
    input.visibility || (scope === 'global' ? 'global' : 'group');
  assertChoice('scope', scope, MEMORY_SCOPES);
  assertChoice('type', type, MEMORY_TYPES);
  assertChoice('visibility', visibility, MEMORY_VISIBILITIES);

  const content = input.content.trim();
  if (!content) throw new Error('memory content is required');
  if (content.length > 4000) throw new Error('memory content is too long');

  const now = new Date().toISOString();
  const sensitivity = input.sensitivity || detectSensitivity(content);
  const contradictsMemoryId = findContradiction(content);
  return createMemory({
    id: `mem-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    scope,
    type,
    content,
    source: input.source?.trim() || null,
    confidence: normalizeConfidence(input.confidence),
    visibility,
    status: 'pending',
    created_by: input.createdBy || null,
    created_at: now,
    updated_at: now,
    reviewed_at: null,
    expires_at: input.expiresAt || null,
    sensitivity,
    source_links_json: JSON.stringify(input.sourceLinks || []),
    contradicts_memory_id: contradictsMemoryId,
    stale_after: input.staleAfter || input.expiresAt || null,
  });
}

export function listMemoryRecords(filters: {
  status?: MemoryStatus;
  scope?: string;
  visibility?: string;
  source?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  staleBefore?: string;
  contradictionGroup?: string;
  limit?: number;
}): MemoryRecord[] {
  return applyMemoryReviewFilters(listMemories(filters), filters);
}

export function approveMemory(id: string): MemoryRecord {
  const reviewedAt = new Date().toISOString();
  const memory = reviewMemory(id, 'approved', reviewedAt);
  if (!memory) throw new Error(`Memory not found: ${id}`);
  refreshMemoryReviewStatuses({ now: reviewedAt });
  renderGlobalMemoryMarkdown();
  return memory;
}

export function rejectMemory(id: string): MemoryRecord {
  const reviewedAt = new Date().toISOString();
  const memory = reviewMemory(id, 'rejected', reviewedAt);
  if (!memory) throw new Error(`Memory not found: ${id}`);
  renderGlobalMemoryMarkdown();
  return memory;
}

export function markMemoryStale(id: string): MemoryRecord {
  const reviewedAt = new Date().toISOString();
  const memory = reviewMemory(id, 'stale', reviewedAt);
  if (!memory) throw new Error(`Memory not found: ${id}`);
  renderGlobalMemoryMarkdown();
  return memory;
}

export function markMemoryContradicted(id: string): MemoryRecord {
  const reviewedAt = new Date().toISOString();
  const memory = reviewMemory(id, 'contradicted', reviewedAt);
  if (!memory) throw new Error(`Memory not found: ${id}`);
  renderGlobalMemoryMarkdown();
  return memory;
}

function contradictionGroupIds(groupId: string): Set<string> {
  const all = listMemories({ limit: 200 });
  const ids = new Set<string>([groupId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const memory of all) {
      if (
        memory.contradicts_memory_id &&
        (ids.has(memory.id) || ids.has(memory.contradicts_memory_id))
      ) {
        const before = ids.size;
        ids.add(memory.id);
        ids.add(memory.contradicts_memory_id);
        changed ||= ids.size !== before;
      }
    }
  }
  return ids;
}

function applyMemoryReviewFilters(
  records: MemoryRecord[],
  filters: MemoryReviewFilters,
): MemoryRecord[] {
  let filtered = records;
  if (filters.source) {
    filtered = filtered.filter((memory) => memory.source === filters.source);
  }
  if (filters.confidenceMin !== undefined) {
    filtered = filtered.filter(
      (memory) => memory.confidence >= filters.confidenceMin!,
    );
  }
  if (filters.confidenceMax !== undefined) {
    filtered = filtered.filter(
      (memory) => memory.confidence <= filters.confidenceMax!,
    );
  }
  if (filters.staleBefore) {
    filtered = filtered.filter(
      (memory) =>
        memory.stale_after && memory.stale_after < filters.staleBefore!,
    );
  }
  if (filters.contradictionGroup) {
    const ids = contradictionGroupIds(filters.contradictionGroup);
    filtered = filtered
      .filter((memory) => ids.has(memory.id))
      .sort((a, b) => {
        if (a.id === filters.contradictionGroup) return -1;
        if (b.id === filters.contradictionGroup) return 1;
        return (
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
        );
      });
  }
  return filtered.slice(0, Math.min(Math.max(filters.limit || 200, 1), 200));
}

export function refreshMemoryReviewStatuses(
  options: RefreshMemoryReviewOptions = {},
): MemoryRecord[] {
  const now = options.now || new Date().toISOString();
  const approved = listMemories({ status: 'approved', limit: 200 });
  const changed: MemoryRecord[] = [];
  for (const memory of approved) {
    const isStaleByDate = Boolean(
      memory.stale_after && memory.stale_after < now,
    );
    const isStaleByAge =
      options.staleAfterDays !== undefined &&
      Date.parse(memory.created_at) <
        Date.parse(now) - options.staleAfterDays * 24 * 60 * 60 * 1000;
    if (isStaleByDate || isStaleByAge) {
      const stale = reviewMemory(memory.id, 'stale', now);
      if (stale) changed.push(stale);
    }
  }

  const stillApproved = listMemories({ status: 'approved', limit: 200 });
  for (const memory of stillApproved) {
    if (memory.contradicts_memory_id) {
      const contradicted = reviewMemory(
        memory.contradicts_memory_id,
        'contradicted',
        now,
      );
      if (contradicted) changed.push(contradicted);
    }
  }

  const active = listMemories({ status: 'approved', limit: 200 });
  for (const newer of active) {
    for (const older of active) {
      if (newer.id === older.id) continue;
      if (newer.created_at <= older.created_at) continue;
      if (!memoriesConflict(newer, older)) continue;
      const contradicted = reviewMemory(older.id, 'contradicted', now);
      if (contradicted) changed.push(contradicted);
    }
  }
  return changed;
}

export function listMemoryReviewQueue(
  filters: MemoryReviewFilters = {},
): MemoryRecord[] {
  const now = new Date().toISOString();
  const reviewRecords = [
    ...listMemories({ status: 'pending', limit: 200 }),
    ...listMemories({ status: 'approved', limit: 200 }).filter(
      (memory) =>
        memory.contradicts_memory_id ||
        memory.sensitivity !== 'normal' ||
        (memory.stale_after && memory.stale_after < now),
    ),
    ...listMemories({ status: 'stale', limit: 200 }),
    ...listMemories({ status: 'contradicted', limit: 200 }),
  ];
  const unique = [
    ...new Map(reviewRecords.map((memory) => [memory.id, memory])).values(),
  ];
  const statusFiltered = filters.status
    ? unique.filter(
        (memory) =>
          memory.status === filters.status ||
          (filters.status === 'contradicted' && memory.contradicts_memory_id),
      )
    : unique;
  return applyMemoryReviewFilters(statusFiltered, filters);
}

export function getMemory(id: string): MemoryRecord | undefined {
  return getMemoryById(id);
}

export function listMemoryProvenanceTimeline(
  limit = 100,
): MemoryProvenanceTimelineEvent[] {
  const events = listMemories({ limit: 200 }).flatMap((memory) => {
    const base = {
      subjectId: memory.id,
      subjectName: memory.type,
      summary: memory.content,
      metadata: {
        scope: memory.scope,
        visibility: memory.visibility,
        source: memory.source,
        confidence: memory.confidence,
        sensitivity: memory.sensitivity,
      },
    };
    const proposed: MemoryProvenanceTimelineEvent = {
      id: `${memory.id}:proposed`,
      type: 'memory.proposed',
      timestamp: memory.created_at,
      actor: memory.created_by || 'system',
      ...base,
    };
    if (memory.status === 'pending' || !memory.reviewed_at) {
      return [proposed];
    }
    const reviewed: MemoryProvenanceTimelineEvent = {
      id: `${memory.id}:${memory.status}`,
      type: `memory.${memory.status}` as MemoryProvenanceTimelineEvent['type'],
      timestamp: memory.reviewed_at,
      actor: 'admin',
      ...base,
    };
    return [proposed, reviewed];
  });
  return events
    .sort(
      (a, b) =>
        b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id),
    )
    .slice(0, Math.min(Math.max(limit, 1), 500));
}

export function renderGlobalMemoryMarkdown(): string {
  const memories = listMemories({
    status: 'approved',
    scope: 'global',
    visibility: 'global',
    limit: 200,
  }).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lines = [
    '# Global Memory',
    '',
    'This file is generated from approved structured memories.',
    'Do not commit it; runtime memory is private operator data.',
    '',
  ];
  if (memories.length === 0) {
    lines.push('_No approved global memories yet._', '');
  } else {
    for (const memory of memories) {
      lines.push(
        `- (${memory.type}, confidence ${memory.confidence.toFixed(2)}) ${memory.content}`,
      );
    }
    lines.push('');
  }
  const markdown = `${lines.join('\n')}\n`;
  const globalDir = path.join(GROUPS_DIR, 'global');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'MEMORY.md'), markdown);
  return markdown;
}
