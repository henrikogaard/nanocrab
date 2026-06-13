import { describe, expect, it } from 'vitest';

import { buildJournalAnswer } from './journal-answers.js';
import type { JournalEntryRecord, JournalEventRecord } from './types.js';

const event: JournalEventRecord = {
  id: 'evt-1',
  timestamp: '2026-06-13T10:00:00.000Z',
  title: 'Fleet crash near Kepler-442b',
  entities_json: '["Kepler-442b","Scout-7"]',
  location_context: 'operations',
  confidence: 0.82,
  source_ids_json: '["msg-1"]',
  tags_json: '["fleet","crash"]',
  group_folder: 'operations',
  created_at: '2026-06-13T10:01:00.000Z',
};

const entry: JournalEntryRecord = {
  id: 'journal-1',
  date: '2026-06-13',
  scope: 'daily',
  group_folder: 'operations',
  summary:
    '42 messages reviewed. Notable events included a fleet crash near Kepler-442b and new evening operation orders.',
  notable_events_json: '[]',
  source_message_ids_json: '["msg-1","msg-2"]',
  provider_profile_id: 'default_journal',
  created_at: '2026-06-13T10:05:00.000Z',
};

describe('journal answers', () => {
  it('answers questions with cited events and summaries', () => {
    const result = buildJournalAnswer({
      query: 'What happened near Kepler?',
      events: [event],
      entries: [entry],
      now: new Date('2026-06-13T11:00:00.000Z'),
    });

    expect(result.answer).toContain('Fleet crash near Kepler-442b');
    expect(result.answer).toContain('[1]');
    expect(result.answer).toContain('daily summary also mentions');
    expect(result.citations).toEqual([
      expect.objectContaining({
        marker: '[1]',
        kind: 'event',
        id: 'evt-1',
        source: 'journal:event:evt-1',
      }),
      expect.objectContaining({
        marker: '[2]',
        kind: 'summary',
        id: 'journal-1',
        source: 'journal:entry:journal-1',
      }),
    ]);
  });

  it('does not fabricate answers for blank questions or missing history', () => {
    expect(
      buildJournalAnswer({ query: '   ', events: [], entries: [] }),
    ).toMatchObject({
      answer: 'Ask a question to search the journal.',
      citations: [],
    });

    expect(
      buildJournalAnswer({ query: 'unknown thing', events: [], entries: [] }),
    ).toMatchObject({
      answer: 'No matching journal history found.',
      citations: [],
    });
  });
});
