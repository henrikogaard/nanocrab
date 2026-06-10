import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-journal-store-test';

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/nanocrab-journal-store-test/data',
  GROUPS_DIR: '/tmp/nanocrab-journal-store-test/groups',
  STORE_DIR: '/tmp/nanocrab-journal-store-test/store',
}));

import { _closeDatabase, _initTestDatabase } from './db.js';
import {
  findJournalEvents,
  recordJournalEntry,
  recordJournalEvent,
} from './journal-store.js';

describe('journal store', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    _closeDatabase();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('records notable events with structured metadata', () => {
    const event = recordJournalEvent({
      title: 'Fleet crash at planet X-17',
      timestamp: '2026-06-09T20:00:00.000Z',
      entities: ['Fleet Alpha', 'Planet X-17'],
      locationContext: 'Planet X-17',
      confidence: 0.85,
      tags: ['attack', 'fleet-crash'],
      groupFolder: 'main',
    });

    expect(event).toMatchObject({
      title: 'Fleet crash at planet X-17',
      timestamp: '2026-06-09T20:00:00.000Z',
      location_context: 'Planet X-17',
      confidence: 0.85,
      group_folder: 'main',
    });
    expect(JSON.parse(event.tags_json)).toEqual(['attack', 'fleet-crash']);
  });

  it('searches journal events by title, tags, entities, and scope', () => {
    recordJournalEvent({
      title: 'Fleet crash at planet X-17',
      entities: ['Fleet Alpha'],
      tags: ['fleet-crash'],
      groupFolder: 'main',
    });
    recordJournalEvent({
      title: 'Trade convoy arrived',
      tags: ['trade'],
      groupFolder: 'other-group',
    });

    expect(
      findJournalEvents({ query: 'fleet', groupFolder: 'main' }),
    ).toHaveLength(1);
    expect(
      findJournalEvents({ query: 'trade', groupFolder: 'main' }),
    ).toHaveLength(0);
    expect(findJournalEvents({ query: 'trade' })).toHaveLength(1);
  });

  it('records daily journal summaries', () => {
    const entry = recordJournalEntry({
      date: '2026-06-09',
      scope: 'group',
      groupFolder: 'main',
      summary: 'Large fleet movement and one confirmed crash.',
      notableEvents: [{ title: 'Fleet crash at planet X-17' }],
      sourceMessageIds: ['m1', 'm2'],
      providerProfileId: 'default_journal',
    });

    expect(entry).toMatchObject({
      date: '2026-06-09',
      scope: 'group',
      group_folder: 'main',
      summary: 'Large fleet movement and one confirmed crash.',
      provider_profile_id: 'default_journal',
    });
    expect(JSON.parse(entry.source_message_ids_json)).toEqual(['m1', 'm2']);
  });
});
