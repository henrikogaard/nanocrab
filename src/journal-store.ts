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
