import crypto from 'crypto';

import {
  createJournalEntry,
  createJournalEvent,
  listJournalEntries,
  searchJournalEvents,
} from './db.js';
import { JournalEntryRecord, JournalEventRecord } from './types.js';

export interface RecordJournalEventInput {
  title: string;
  timestamp?: string;
  entities?: string[];
  locationContext?: string;
  confidence?: number;
  sourceIds?: string[];
  tags?: string[];
  groupFolder?: string | null;
}

export interface RecordJournalEntryInput {
  date: string;
  scope: string;
  groupFolder?: string | null;
  summary: string;
  notableEvents?: unknown[];
  sourceMessageIds?: string[];
  providerProfileId?: string | null;
}

export interface JournalAnswerCitation {
  id: string;
  type: 'event' | 'summary';
  label: string;
  source: string;
  timestamp?: string;
  confidence?: number;
}

export interface JournalAnswer {
  query: string;
  answer: string;
  citations: JournalAnswerCitation[];
  events: JournalEventRecord[];
  entries: JournalEntryRecord[];
}

function normalizeConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

function jsonArray(value: unknown[] | undefined): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

export function recordJournalEvent(
  input: RecordJournalEventInput,
): JournalEventRecord {
  const title = input.title.trim();
  if (!title) throw new Error('journal event title is required');
  if (title.length > 500) throw new Error('journal event title is too long');
  const now = new Date().toISOString();
  return createJournalEvent({
    id: `evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    timestamp: input.timestamp || now,
    title,
    entities_json: jsonArray(input.entities),
    location_context: input.locationContext?.trim() || null,
    confidence: normalizeConfidence(input.confidence),
    source_ids_json: jsonArray(input.sourceIds),
    tags_json: jsonArray(input.tags),
    group_folder: input.groupFolder || null,
    created_at: now,
  });
}

export function recordJournalEntry(
  input: RecordJournalEntryInput,
): JournalEntryRecord {
  const summary = input.summary.trim();
  if (!summary) throw new Error('journal summary is required');
  const now = new Date().toISOString();
  return createJournalEntry({
    id: `journal-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    date: input.date,
    scope: input.scope,
    group_folder: input.groupFolder || null,
    summary,
    notable_events_json: jsonArray(input.notableEvents),
    source_message_ids_json: jsonArray(input.sourceMessageIds),
    provider_profile_id: input.providerProfileId || null,
    created_at: now,
  });
}

export function findJournalEvents(input: {
  query: string;
  groupFolder?: string | null;
  limit?: number;
}): JournalEventRecord[] {
  const query = input.query.trim();
  if (!query) throw new Error('journal search query is required');
  return searchJournalEvents({
    query,
    groupFolder: input.groupFolder || null,
    limit: input.limit,
  });
}

export function listJournalEntryRecords(input: {
  groupFolder?: string | null;
  scope?: string | null;
  limit?: number;
}): JournalEntryRecord[] {
  return listJournalEntries(input);
}

function parseJsonArray(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function termsForQuery(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((term) => term.length >= 3),
    ),
  ];
}

function findEventsForNaturalQuestion(input: {
  query: string;
  groupFolder?: string | null;
  limit: number;
}): JournalEventRecord[] {
  const seen = new Set<string>();
  const events: JournalEventRecord[] = [];
  const queries = [
    input.query,
    ...termsForQuery(input.query).filter(
      (term) =>
        ![
          'when',
          'what',
          'where',
          'who',
          'why',
          'how',
          'was',
          'the',
          'did',
          'had',
        ].includes(term),
    ),
  ];
  for (const query of queries) {
    for (const event of findJournalEvents({
      query,
      groupFolder: input.groupFolder || null,
      limit: input.limit,
    })) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
      if (events.length >= input.limit) return events;
    }
  }
  return events;
}

function entryMatchesQuery(
  entry: JournalEntryRecord,
  terms: string[],
): boolean {
  const haystack = [
    entry.date,
    entry.scope,
    entry.group_folder || '',
    entry.summary,
    ...parseJsonArray(entry.notable_events_json),
  ]
    .join(' ')
    .toLowerCase();
  return terms.length === 0 || terms.some((term) => haystack.includes(term));
}

export function answerJournalQuestion(input: {
  query: string;
  groupFolder?: string | null;
  limit?: number;
}): JournalAnswer {
  const query = input.query.trim();
  if (!query) throw new Error('journal question is required');
  const limit = Math.min(Math.max(input.limit || 8, 1), 25);
  const events = findEventsForNaturalQuestion({
    query,
    groupFolder: input.groupFolder || null,
    limit,
  });
  const terms = termsForQuery(query);
  const entries = listJournalEntryRecords({
    groupFolder: input.groupFolder || null,
    limit: 50,
  })
    .filter((entry) => entryMatchesQuery(entry, terms))
    .slice(0, Math.max(3, Math.min(limit, 8)));

  const citations: JournalAnswerCitation[] = [
    ...events.slice(0, limit).map(
      (event): JournalAnswerCitation => ({
        id: event.id,
        type: 'event',
        label: event.title,
        source: `journal-event:${event.id}`,
        timestamp: event.timestamp,
        confidence: event.confidence,
      }),
    ),
    ...entries.map(
      (entry): JournalAnswerCitation => ({
        id: entry.id,
        type: 'summary',
        label: `${entry.date} ${entry.scope} summary`,
        source: `journal-summary:${entry.id}`,
        timestamp: entry.created_at,
      }),
    ),
  ];

  const lines = events.slice(0, 5).map((event, index) => {
    const where = event.location_context ? ` (${event.location_context})` : '';
    const confidence = Number.isFinite(event.confidence)
      ? `, confidence ${Math.round(event.confidence * 100)}%`
      : '';
    return `[${index + 1}] ${event.timestamp.slice(0, 10)}: ${
      event.title
    }${where}${confidence}.`;
  });
  const summaryLines = entries.slice(0, 3).map((entry, index) => {
    const citationIndex = events.slice(0, 5).length + index + 1;
    return `[${citationIndex}] ${entry.date} ${entry.scope}: ${entry.summary.slice(
      0,
      220,
    )}`;
  });
  const answer =
    lines.length || summaryLines.length
      ? [...lines, ...summaryLines].join('\n')
      : 'No matching journal events or summaries found.';

  return { query, answer, citations, events, entries };
}
