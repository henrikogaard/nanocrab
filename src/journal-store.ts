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

export interface SkillWorthyJournalPattern {
  normalizedIntent: string;
  exampleCount: number;
  examples: string[];
  sources: string[];
  confidence: number;
}

function normalizeConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

function jsonArray(value: unknown[] | undefined): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function normalizeSkillIntent(text: string): string {
  const firstClause = text
    .toLowerCase()
    .split(/\b(?:with|from|for|when|using|before|after)\b/)[0];
  return firstClause
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(
      /\b(always|please|can|could|would|should|make|create|draft|write|a|an|the|i|we|to|and|next|actions?)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function looksSkillWorthy(text: string): boolean {
  return /\b(always|when i ask|workflow|prepare|summarize|summary|digest|report|review|triage|use this)\b/i.test(
    text,
  );
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

export function findSkillWorthyJournalPatterns(input: {
  groupFolder?: string | null;
  minExamples?: number;
  limit?: number;
}): SkillWorthyJournalPattern[] {
  const minExamples = Math.max(input.minExamples || 3, 3);
  const limit = Math.min(Math.max(input.limit || 100, 1), 200);
  const entries = listJournalEntries({
    groupFolder: input.groupFolder || null,
    limit,
  });
  const events = searchJournalEvents({
    query: '',
    groupFolder: input.groupFolder || null,
    limit,
  });
  const grouped = new Map<
    string,
    { examples: string[]; sources: string[]; confidenceTotal: number }
  >();
  for (const entry of entries) {
    if (!looksSkillWorthy(entry.summary)) continue;
    const normalizedIntent = normalizeSkillIntent(entry.summary);
    if (!normalizedIntent) continue;
    const group = grouped.get(normalizedIntent) || {
      examples: [],
      sources: [],
      confidenceTotal: 0,
    };
    group.examples.push(entry.summary);
    group.sources.push(entry.id);
    group.confidenceTotal += 0.65;
    grouped.set(normalizedIntent, group);
  }
  for (const event of events) {
    if (!looksSkillWorthy(event.title)) continue;
    const normalizedIntent = normalizeSkillIntent(event.title);
    if (!normalizedIntent) continue;
    const group = grouped.get(normalizedIntent) || {
      examples: [],
      sources: [],
      confidenceTotal: 0,
    };
    group.examples.push(event.title);
    group.sources.push(event.id);
    group.confidenceTotal += event.confidence;
    grouped.set(normalizedIntent, group);
  }
  return [...grouped.entries()]
    .filter(([, group]) => group.examples.length >= minExamples)
    .map(([normalizedIntent, group]) => ({
      normalizedIntent,
      exampleCount: group.examples.length,
      examples: group.examples.slice(0, 5),
      sources: group.sources.slice(0, 10),
      confidence: Math.min(0.95, group.confidenceTotal / group.examples.length),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
