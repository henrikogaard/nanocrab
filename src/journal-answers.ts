import type { JournalEntryRecord, JournalEventRecord } from './types.js';

export type JournalAnswerCitationKind = 'event' | 'summary';

export interface JournalAnswerCitation {
  marker: string;
  kind: JournalAnswerCitationKind;
  id: string;
  title: string;
  source: string;
  timestamp?: string;
  groupFolder?: string | null;
  sourceIds: string[];
}

export interface JournalAnswerResult {
  query: string;
  answer: string;
  citations: JournalAnswerCitation[];
  events: JournalEventRecord[];
  entries: JournalEntryRecord[];
  generatedAt: string;
}

export interface BuildJournalAnswerInput {
  query: string;
  events: JournalEventRecord[];
  entries: JournalEntryRecord[];
  now?: Date;
}

function parseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function concise(text: string, max = 220): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}...` : trimmed;
}

function eventSentence(event: JournalEventRecord, marker: string): string {
  const date = event.timestamp.slice(0, 10);
  const location = event.location_context
    ? ` in ${event.location_context}`
    : '';
  return `${date}: ${event.title}${location} ${marker}`;
}

function entrySentence(entry: JournalEntryRecord, marker: string): string {
  return `${entry.date} ${entry.scope} summary also mentions: ${concise(
    entry.summary,
  )} ${marker}`;
}

export function buildJournalAnswer(
  input: BuildJournalAnswerInput,
): JournalAnswerResult {
  const query = input.query.trim();
  const generatedAt = (input.now || new Date()).toISOString();
  if (!query) {
    return {
      query: input.query,
      answer: 'Ask a question to search the journal.',
      citations: [],
      events: [],
      entries: [],
      generatedAt,
    };
  }

  const events = input.events.slice(0, 5);
  const entries = input.entries.slice(0, 3);
  if (events.length === 0 && entries.length === 0) {
    return {
      query,
      answer: 'No matching journal history found.',
      citations: [],
      events: [],
      entries: [],
      generatedAt,
    };
  }

  const citations: JournalAnswerCitation[] = [];
  const eventLines = events.map((event) => {
    const marker = `[${citations.length + 1}]`;
    citations.push({
      marker,
      kind: 'event',
      id: event.id,
      title: event.title,
      source: `journal:event:${event.id}`,
      timestamp: event.timestamp,
      groupFolder: event.group_folder,
      sourceIds: parseJsonArray(event.source_ids_json),
    });
    return eventSentence(event, marker);
  });
  const entryLines = entries.map((entry) => {
    const marker = `[${citations.length + 1}]`;
    citations.push({
      marker,
      kind: 'summary',
      id: entry.id,
      title: `${entry.date} ${entry.scope} summary`,
      source: `journal:entry:${entry.id}`,
      timestamp: entry.created_at,
      groupFolder: entry.group_folder,
      sourceIds: parseJsonArray(entry.source_message_ids_json),
    });
    return entrySentence(entry, marker);
  });

  const answer = [
    eventLines.length
      ? `I found ${eventLines.length} matching event${eventLines.length === 1 ? '' : 's'}:\n${eventLines.join('\n')}`
      : '',
    entryLines.length
      ? `Related journal summaries:\n${entryLines.join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    query,
    answer,
    citations,
    events,
    entries,
    generatedAt,
  };
}
