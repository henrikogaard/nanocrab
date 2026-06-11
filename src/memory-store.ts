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

export type MemoryReviewReason =
  | 'pending'
  | 'sensitive'
  | 'secret-note'
  | 'stale'
  | 'expired'
  | 'contradiction';

export interface MemoryReviewRecord extends MemoryRecord {
  review_reasons: MemoryReviewReason[];
  source_links: string[];
  related_memory?: MemoryRecord;
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

function findContradiction(content: string): string | null {
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  const candidates = listMemories({ status: 'approved', limit: 200 });
  const hasNegation = /\b(not|never|no longer|does not|is not)\b/.test(
    normalized,
  );
  const negated = normalized
    .replace(/\bis not\b/g, ' is ')
    .replace(/\bdoes not\b/g, ' does ')
    .replace(/\bnever\b/g, '')
    .replace(/\bno longer\b/g, '')
    .trim();
  for (const memory of candidates) {
    const other = memory.content.toLowerCase().replace(/\s+/g, ' ').trim();
    if (other === normalized) continue;
    if (
      hasNegation &&
      (other.includes(negated.slice(0, 80)) ||
        negated.includes(other.slice(0, 80)))
    ) {
      return memory.id;
    }
    if (hasNegation) {
      const tokens = new Set(
        negated
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter(
            (token) =>
              token.length >= 5 &&
              !['longer', 'prefers', 'prefer'].includes(token),
          ),
      );
      const otherTokens = new Set(
        other
          .replace(/[^a-z0-9\s-]/g, ' ')
          .split(/\s+/)
          .filter((token) => token.length >= 5),
      );
      const overlap = Array.from(tokens).filter((token) =>
        otherTokens.has(token),
      );
      if (overlap.length >= 2) return memory.id;
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
  sensitivity?: 'normal' | 'sensitive' | 'secret-note';
  reviewReason?: MemoryReviewReason;
  limit?: number;
}): MemoryRecord[] {
  const memories = listMemories(filters);
  return memories.filter((memory) => {
    if (filters.sensitivity && memory.sensitivity !== filters.sensitivity) {
      return false;
    }
    if (
      filters.reviewReason &&
      !memoryReviewReasons(memory).includes(filters.reviewReason)
    ) {
      return false;
    }
    return true;
  });
}

export function approveMemory(id: string): MemoryRecord {
  const reviewedAt = new Date().toISOString();
  const memory = reviewMemory(id, 'approved', reviewedAt);
  if (!memory) throw new Error(`Memory not found: ${id}`);
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

function parseSourceLinks(memory: MemoryRecord): string[] {
  try {
    const links = JSON.parse(memory.source_links_json || '[]') as unknown;
    return Array.isArray(links)
      ? links.filter((link): link is string => typeof link === 'string')
      : [];
  } catch {
    return [];
  }
}

export function memoryReviewReasons(
  memory: MemoryRecord,
  now = new Date().toISOString(),
): MemoryReviewReason[] {
  const reasons: MemoryReviewReason[] = [];
  if (memory.status === 'pending') reasons.push('pending');
  if (memory.sensitivity === 'sensitive') reasons.push('sensitive');
  if (memory.sensitivity === 'secret-note') reasons.push('secret-note');
  if (memory.contradicts_memory_id) reasons.push('contradiction');
  if (memory.stale_after && memory.stale_after < now) reasons.push('stale');
  if (memory.expires_at && memory.expires_at < now) reasons.push('expired');
  return reasons;
}

function decorateMemoryReviewRecord(
  memory: MemoryRecord,
  now: string,
): MemoryReviewRecord {
  const related = memory.contradicts_memory_id
    ? getMemoryById(memory.contradicts_memory_id)
    : undefined;
  return {
    ...memory,
    review_reasons: memoryReviewReasons(memory, now),
    source_links: parseSourceLinks(memory),
    related_memory: related,
  };
}

export function listMemoryReviewQueue(
  filters: {
    reason?: MemoryReviewReason;
    sensitivity?: 'normal' | 'sensitive' | 'secret-note';
    limit?: number;
  } = {},
): MemoryReviewRecord[] {
  const now = new Date().toISOString();
  const queue = [
    ...listMemories({ status: 'pending', limit: 200 }),
    ...listMemories({ status: 'approved', limit: 200 }).filter(
      (memory) =>
        memory.contradicts_memory_id ||
        memory.sensitivity !== 'normal' ||
        (memory.stale_after && memory.stale_after < now),
    ),
  ]
    .map((memory) => decorateMemoryReviewRecord(memory, now))
    .filter((memory) => {
      if (filters.sensitivity && memory.sensitivity !== filters.sensitivity) {
        return false;
      }
      if (filters.reason && !memory.review_reasons.includes(filters.reason)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const priority = (memory: MemoryReviewRecord) =>
        memory.review_reasons.includes('secret-note')
          ? 0
          : memory.review_reasons.includes('contradiction')
            ? 1
            : memory.review_reasons.includes('stale') ||
                memory.review_reasons.includes('expired')
              ? 2
              : memory.review_reasons.includes('sensitive')
                ? 3
                : 4;
      return (
        priority(a) - priority(b) ||
        b.updated_at.localeCompare(a.updated_at) ||
        b.created_at.localeCompare(a.created_at)
      );
    });
  return queue.slice(0, Math.min(Math.max(filters.limit || 200, 1), 200));
}

export function getMemory(id: string): MemoryRecord | undefined {
  return getMemoryById(id);
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
