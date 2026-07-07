import fs from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-skill-suggestions-test';

vi.mock('./config.js', () => ({
  STORE_DIR: '/tmp/nanocrab-skill-suggestions-test/store',
}));

import {
  dismissSkillSuggestion,
  listSkillSuggestions,
  markSkillSuggestionDrafted,
  upsertSkillSuggestions,
} from './skill-suggestions.js';

const INPUT = {
  name: 'release-checklist',
  description: 'Capture repeated release checklist requests.',
  reason: 'Repeated release planning language was seen.',
  confidence: 0.7,
  evidenceCount: 2,
  instructions: 'Use for release checklist generation.',
  provenance: ['source:test'],
};

describe('skill suggestions', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('persists recurring suggestions and tracks lifecycle state', () => {
    upsertSkillSuggestions([INPUT], '2026-06-10T10:00:00.000Z');
    upsertSkillSuggestions(
      [{ ...INPUT, confidence: 0.8, evidenceCount: 4 }],
      '2026-06-10T11:00:00.000Z',
    );

    const [suggestion] = listSkillSuggestions('suggested');
    expect(suggestion).toMatchObject({
      name: 'release-checklist',
      confidence: 0.8,
      evidenceCount: 4,
      occurrenceCount: 2,
      status: 'suggested',
    });

    markSkillSuggestionDrafted(suggestion.id, 'skill-123');
    expect(listSkillSuggestions('drafted')[0]).toMatchObject({
      draftId: 'skill-123',
      status: 'drafted',
    });
  });

  it('can dismiss suggestions from the queue', () => {
    const [suggestion] = upsertSkillSuggestions([INPUT]);
    dismissSkillSuggestion(suggestion.id);

    expect(listSkillSuggestions('suggested')).toHaveLength(0);
    expect(listSkillSuggestions('dismissed')[0]?.status).toBe('dismissed');
  });
});
