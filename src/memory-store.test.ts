import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-memory-store-test';

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/nanocrab-memory-store-test/data',
  GROUPS_DIR: '/tmp/nanocrab-memory-store-test/groups',
  STORE_DIR: '/tmp/nanocrab-memory-store-test/store',
}));

import { _closeDatabase, _initTestDatabase } from './db.js';
import {
  approveMemory,
  listMemoryProvenanceTimeline,
  listMemoryReviewQueue,
  listMemoryRecords,
  markMemoryStale,
  proposeMemory,
  refreshMemoryReviewStatuses,
  rejectMemory,
} from './memory-store.js';

describe('memory store', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    _initTestDatabase();
  });

  afterEach(() => {
    _closeDatabase();
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('stores memory proposals as pending records', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'preference',
      content: 'Henrik prefers concise deployment notes.',
      confidence: 0.9,
      visibility: 'global',
      createdBy: 'whatsapp_main',
    });

    expect(memory).toMatchObject({
      scope: 'global',
      type: 'preference',
      content: 'Henrik prefers concise deployment notes.',
      confidence: 0.9,
      visibility: 'global',
      status: 'pending',
      created_by: 'whatsapp_main',
    });
    expect(listMemoryRecords({ status: 'pending' })).toHaveLength(1);
  });

  it('exposes memory proposal and approval events for provenance timelines', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'fact',
      content: 'Release notes should mention routing decisions.',
      confidence: 0.91,
      visibility: 'global',
      createdBy: 'timeline-test',
    });
    approveMemory(memory.id);

    expect(
      listMemoryProvenanceTimeline().map((event) => ({
        type: event.type,
        subjectId: event.subjectId,
        actor: event.actor,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          type: 'memory.proposed',
          subjectId: memory.id,
          actor: 'timeline-test',
        },
        {
          type: 'memory.approved',
          subjectId: memory.id,
          actor: 'admin',
        },
      ]),
    );
  });

  it('keeps prior approval events when a memory is later marked stale', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'fact',
      content: 'Multi-step memory reviews keep their full trail.',
      confidence: 0.83,
      visibility: 'global',
      createdBy: 'timeline-test',
    });

    approveMemory(memory.id);
    markMemoryStale(memory.id);

    expect(
      listMemoryProvenanceTimeline()
        .filter((event) => event.subjectId === memory.id)
        .map((event) => event.type),
    ).toEqual(
      expect.arrayContaining([
        'memory.proposed',
        'memory.approved',
        'memory.stale',
      ]),
    );
  });

  it('includes recent review events for memories outside the newest record window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
      const oldMemory = proposeMemory({
        scope: 'global',
        type: 'fact',
        content: 'Old memories can still receive recent reviews.',
        confidence: 0.8,
        visibility: 'global',
        createdBy: 'timeline-test',
      });

      for (let index = 0; index < 205; index += 1) {
        vi.setSystemTime(
          new Date(Date.UTC(2001, 0, 1, 0, 0, 0) + index * 1000),
        );
        proposeMemory({
          scope: 'group',
          type: 'fact',
          content: `Newer memory ${index}`,
          confidence: 0.5,
          visibility: 'group',
        });
      }

      vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
      approveMemory(oldMemory.id);

      expect(
        listMemoryProvenanceTimeline(10).map((event) => ({
          type: event.type,
          subjectId: event.subjectId,
        })),
      ).toContainEqual({
        type: 'memory.approved',
        subjectId: oldMemory.id,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('approves global memories into generated MEMORY.md', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'fact',
      content: 'NanoCrab coding jobs run in isolated containers.',
      confidence: 1,
      visibility: 'global',
      createdBy: 'whatsapp_main',
    });

    approveMemory(memory.id);

    const memoryMd = fs.readFileSync(
      path.join(TEST_ROOT, 'groups', 'global', 'MEMORY.md'),
      'utf-8',
    );
    expect(memoryMd).toContain(
      'NanoCrab coding jobs run in isolated containers.',
    );
    expect(listMemoryRecords({ status: 'approved' })).toHaveLength(1);
  });

  it('does not render rejected memories as active global memory', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'warning',
      content: 'Do not keep this.',
      confidence: 0.2,
      visibility: 'global',
      createdBy: 'whatsapp_main',
    });

    rejectMemory(memory.id);

    const memoryMd = fs.readFileSync(
      path.join(TEST_ROOT, 'groups', 'global', 'MEMORY.md'),
      'utf-8',
    );
    expect(memoryMd).not.toContain('Do not keep this.');
    expect(listMemoryRecords({ status: 'rejected' })).toHaveLength(1);
  });

  it('filters review records by source, confidence, stale date, and contradiction group', () => {
    const stale = proposeMemory({
      scope: 'group',
      type: 'fact',
      content: 'Ops summaries should include launch windows.',
      source: 'journal',
      confidence: 0.92,
      visibility: 'group',
      staleAfter: '2026-01-01T00:00:00.000Z',
    });
    approveMemory(stale.id);
    const older = proposeMemory({
      scope: 'group',
      type: 'preference',
      content: 'Henrik prefers verbose status updates.',
      source: 'message',
      confidence: 0.74,
      visibility: 'group',
    });
    approveMemory(older.id);
    const newer = proposeMemory({
      scope: 'group',
      type: 'preference',
      content: 'Henrik does not prefer verbose status updates.',
      source: 'message',
      confidence: 0.88,
      visibility: 'group',
    });
    approveMemory(newer.id);

    refreshMemoryReviewStatuses({ now: '2026-02-01T00:00:00.000Z' });

    expect(
      listMemoryReviewQueue({
        status: 'stale',
        source: 'journal',
        confidenceMin: 0.9,
        staleBefore: '2026-01-15T00:00:00.000Z',
      }).map((memory) => memory.id),
    ).toEqual([stale.id]);
    expect(
      listMemoryReviewQueue({
        status: 'contradicted',
        contradictionGroup: older.id,
      }).map((memory) => memory.id),
    ).toEqual([older.id, newer.id]);
  });

  it('marks old approved memories stale by configurable age without deleting them', () => {
    const memory = proposeMemory({
      scope: 'global',
      type: 'fact',
      content: 'Old deployment notes should be reviewed.',
      confidence: 0.7,
      visibility: 'global',
    });
    approveMemory(memory.id);

    refreshMemoryReviewStatuses({
      now: '2100-06-01T00:00:00.000Z',
      staleAfterDays: 30,
    });

    expect(listMemoryRecords({ status: 'stale' })).toHaveLength(1);
    expect(listMemoryRecords({ status: 'stale' })[0].id).toBe(memory.id);
  });
});
