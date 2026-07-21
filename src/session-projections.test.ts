import { describe, expect, it } from 'vitest';

import {
  buildSessionProjections,
  type SessionProjectionInput,
} from './session-projections.js';

function input(
  overrides: Partial<SessionProjectionInput> = {},
): SessionProjectionInput {
  return {
    sessionId: 'session-1',
    events: [],
    learningProposals: [],
    journalEntries: [],
    ...overrides,
  };
}

describe('session projections', () => {
  it('projects bounded conversation and plan tasks from transcript records', () => {
    const result = buildSessionProjections(
      input({
        events: [
          {
            type: 'user',
            timestamp: '2026-07-21T10:00:00Z',
            content: 'Implement the next roadmap slice',
          },
          {
            type: 'task',
            timestamp: '2026-07-21T10:01:00Z',
            title: 'Add API projection',
            status: 'running',
            detail: 'Expose typed data to the cockpit',
          },
          {
            type: 'assistant',
            timestamp: '2026-07-21T10:02:00Z',
            message: { content: [{ type: 'text', text: 'Working now.' }] },
          },
        ],
      }),
    );

    expect(result.conversation).toMatchObject({ available: true });
    expect(result.conversation.items).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Implement the next roadmap slice',
        provenance: 'transcript',
      }),
      expect.objectContaining({ role: 'assistant', content: 'Working now.' }),
    ]);
    expect(result.plan).toMatchObject({ available: true });
    expect(result.plan.items).toEqual([
      expect.objectContaining({
        title: 'Add API projection',
        status: 'running',
        detail: 'Expose typed data to the cockpit',
      }),
    ]);
  });

  it('returns explicit unavailable states when a source is not recorded', () => {
    const result = buildSessionProjections(input());

    expect(result.conversation).toEqual({
      available: false,
      reason: 'not_recorded',
      items: [],
    });
    expect(result.memoryProposals).toEqual({
      available: false,
      reason: 'not_recorded',
      items: [],
    });
  });

  it('redacts sensitive proposal content and caps collection sizes', () => {
    const result = buildSessionProjections(
      input({
        learningProposals: [
          {
            id: 'memory-1',
            type: 'memory',
            status: 'pending',
            sourceRunId: 'session-1',
            sourceRunSummary: 'run',
            extractedLesson: 'token: sk-live-12345678901234567890',
            proposedScope: 'group',
            sensitivity: 'secret-note',
            confidence: 0.9,
            validationResult: null,
            diff: null,
            createdBy: 'agent',
            createdAt: '2026-07-21T10:00:00Z',
            reviewedAt: null,
            reviewedBy: null,
            decisionNote: null,
            memoryId: null,
            skillDraftId: null,
          },
        ],
      }),
    );

    expect(result.memoryProposals.items[0]).toMatchObject({
      id: 'memory-1',
      sensitivity: 'secret-note',
      summary: '[REDACTED]',
    });
    expect(JSON.stringify(result)).not.toContain('sk-live-');
  });

  it('normalizes timeline metadata and preserves chronological ordering', () => {
    const result = buildSessionProjections(
      input({
        events: [
          {
            type: 'assistant',
            timestamp: '2026-07-21T10:02:00Z',
            content: 'Done',
          },
          {
            type: 'user',
            timestamp: '2026-07-21T10:00:00Z',
            content: 'Start',
          },
        ],
      }),
    );

    expect(result.timeline.map((event) => event.timestamp)).toEqual([
      '2026-07-21T10:00:00Z',
      '2026-07-21T10:02:00Z',
    ]);
    expect(result.timeline[0]).toMatchObject({
      provenance: 'conversation',
      sensitivity: 'normal',
    });
  });

  it('projects only run-linked memory, skill, and journal records', () => {
    const result = buildSessionProjections(
      input({
        learningProposals: [
          {
            id: 'memory-linked',
            type: 'memory',
            status: 'pending',
            sourceRunId: 'session-1',
            sourceRunSummary: 'linked',
            extractedLesson: 'Remember this preference',
            proposedScope: 'group',
            sensitivity: 'normal',
            confidence: 0.8,
            validationResult: null,
            diff: null,
            createdBy: 'agent',
            createdAt: '2026-07-21T10:00:00Z',
            reviewedAt: null,
            reviewedBy: null,
            decisionNote: null,
            memoryId: null,
            skillDraftId: null,
          },
          {
            id: 'skill-unrelated',
            type: 'skill-draft',
            status: 'pending',
            sourceRunId: 'other-session',
            sourceRunSummary: 'unrelated',
            extractedLesson: 'Do not show this',
            proposedScope: 'global',
            sensitivity: 'normal',
            confidence: 0.8,
            validationResult: null,
            diff: null,
            createdBy: 'agent',
            createdAt: '2026-07-21T10:00:00Z',
            reviewedAt: null,
            reviewedBy: null,
            decisionNote: null,
            memoryId: null,
            skillDraftId: 'skill-1',
          },
        ],
        journalEntries: [
          {
            id: 'journal-linked',
            date: '2026-07-21',
            scope: 'group',
            group_folder: 'main',
            summary: 'Linked journal note',
            notable_events_json: '[]',
            source_message_ids_json: '["session-1"]',
            provider_profile_id: null,
            created_at: '2026-07-21T10:03:00Z',
          },
          {
            id: 'journal-unrelated',
            date: '2026-07-21',
            scope: 'group',
            group_folder: 'main',
            summary: 'Do not show this',
            notable_events_json: '[]',
            source_message_ids_json: '["other-session"]',
            provider_profile_id: null,
            created_at: '2026-07-21T10:03:00Z',
          },
        ],
      }),
    );

    expect(result.memoryProposals.items).toHaveLength(1);
    expect(result.memoryProposals.items[0].id).toBe('memory-linked');
    expect(result.skillProposals.available).toBe(false);
    expect(result.journalEvents.items).toEqual([
      expect.objectContaining({
        id: 'journal-linked',
        summary: 'Linked journal note',
      }),
    ]);
  });
});
