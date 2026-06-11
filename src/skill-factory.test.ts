import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-skill-factory-test';

vi.mock('./config.js', () => ({
  CONTAINER_SKILLS_DIR: '/tmp/nanocrab-skill-factory-test/container/skills',
  STORE_DIR: '/tmp/nanocrab-skill-factory-test/store',
}));

import {
  approveSkillDraft,
  getSkillDraftContent,
  listSkillDraftRevisions,
  listSkillDrafts,
  proposeSkillDraft,
  rejectSkillDraft,
  rollbackSkillDraft,
  updateSkillDraft,
} from './skill-factory.js';

const VALID_SKILL = `---
name: battle-reports
description: Summarize combat reports into concise operational notes.
---

# Battle Reports

Use this skill when asked to summarize combat reports.
`;

describe('skill factory', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('stores valid skill drafts as pending', () => {
    const draft = proposeSkillDraft({
      skillMd: VALID_SKILL,
      createdBy: 'whatsapp_main',
    });

    expect(draft).toMatchObject({
      name: 'battle-reports',
      description: 'Summarize combat reports into concise operational notes.',
      status: 'pending',
      createdBy: 'whatsapp_main',
    });
    expect(listSkillDrafts('pending')).toHaveLength(1);
  });

  it('rejects drafts without valid frontmatter', () => {
    expect(() =>
      proposeSkillDraft({
        skillMd: '# Missing frontmatter',
        createdBy: 'whatsapp_main',
      }),
    ).toThrow('frontmatter');
  });

  it('approves drafts by installing SKILL.md into container skills', () => {
    const draft = proposeSkillDraft({
      skillMd: VALID_SKILL,
      createdBy: 'whatsapp_main',
    });

    const approved = approveSkillDraft(draft.id);

    expect(approved.status).toBe('approved');
    expect(
      fs.readFileSync(
        path.join(
          TEST_ROOT,
          'container',
          'skills',
          'battle-reports',
          'SKILL.md',
        ),
        'utf-8',
      ),
    ).toContain('Battle Reports');
  });

  it('rejects drafts without installing them', () => {
    const draft = proposeSkillDraft({
      skillMd: VALID_SKILL,
      createdBy: 'whatsapp_main',
    });

    const rejected = rejectSkillDraft(draft.id);

    expect(rejected.status).toBe('rejected');
    expect(fs.existsSync(path.join(TEST_ROOT, 'container', 'skills'))).toBe(
      false,
    );
  });

  it('tracks draft revisions and rolls back into a new pending revision', () => {
    const draft = proposeSkillDraft({
      skillMd: VALID_SKILL,
      createdBy: 'whatsapp_main',
    });

    const updated = updateSkillDraft(draft.id, {
      updatedBy: 'dashboard',
      skillMd: VALID_SKILL.replace(
        'concise operational notes',
        'structured operational notes',
      ),
    });
    expect(updated.version).toBe(2);
    expect(listSkillDraftRevisions(draft.id).map((rev) => rev.version)).toEqual(
      [2, 1],
    );

    const rolledBack = rollbackSkillDraft(draft.id, 1, 'dashboard');
    expect(rolledBack.version).toBe(3);
    expect(rolledBack.status).toBe('pending');
    expect(getSkillDraftContent(draft.id)).toContain(
      'concise operational notes',
    );
  });
});
