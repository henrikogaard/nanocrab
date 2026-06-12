import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-skill-factory-test';

vi.mock('./config.js', () => ({
  CONTAINER_SKILLS_DIR: '/tmp/nanocrab-skill-factory-test/container/skills',
  STORE_DIR: '/tmp/nanocrab-skill-factory-test/store',
}));

import {
  approveSkillSuggestion,
  approveSkillDraft,
  detectAndQueueSkillSuggestions,
  listSkillSuggestions,
  listSkillDrafts,
  proposeSkillDraft,
  rejectSkillDraft,
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

  it('queues repeated skill suggestions and approval creates an uninstalled draft', () => {
    const suggestions = detectAndQueueSkillSuggestions({
      messages: [
        'When I ask for release notes, summarize commits and risks.',
        'Please summarize commits and risks for release notes.',
        'Always summarize commits and risks in release notes.',
      ],
      createdBy: 'test',
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      proposedSkillName: 'summarize-commits-risks-release-notes',
      status: 'pending',
      sourceExamples: expect.arrayContaining([
        expect.stringContaining('release notes'),
      ]),
    });
    expect(listSkillDrafts()).toHaveLength(0);

    const approved = approveSkillSuggestion(suggestions[0].id, {
      decidedBy: 'owner',
      decision: 'create-draft',
    });

    expect(approved.status).toBe('approved');
    expect(approved.ownerDecision).toBe('create-draft');
    expect(approved.draftId).toBeTruthy();
    expect(listSkillDrafts('pending')).toHaveLength(1);
    expect(fs.existsSync(path.join(TEST_ROOT, 'container', 'skills'))).toBe(
      false,
    );
    expect(listSkillSuggestions({ status: 'approved' })).toHaveLength(1);
  });

  it('does not lower the skill suggestion threshold below three examples', () => {
    const suggestions = detectAndQueueSkillSuggestions({
      messages: [
        'Please summarize commits and risks for release notes.',
        'Always summarize commits and risks in release notes.',
      ],
      createdBy: 'test',
      minExamples: 2,
    });

    expect(suggestions).toHaveLength(0);
    expect(listSkillSuggestions()).toHaveLength(0);
  });

  it('requires three skill-worthy repeated examples before queueing', () => {
    const suggestions = detectAndQueueSkillSuggestions({
      messages: [
        'Always summarize commits and risks in release notes.',
        'Summarize commits and risks release notes.',
        'Summarize commits and risks release notes.',
      ],
      createdBy: 'test',
    });

    expect(suggestions).toHaveLength(0);
    expect(listSkillSuggestions()).toHaveLength(0);
  });

  it('queues when three repeated examples are skill-worthy', () => {
    const suggestions = detectAndQueueSkillSuggestions({
      messages: [
        'Please summarize commits and risks for release notes.',
        'Always summarize commits and risks in release notes.',
        'Use this workflow to summarize commits and risks for release notes.',
      ],
      createdBy: 'test',
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].proposedSkillName).toBe(
      'summarize-commits-risks-release-notes',
    );
  });

  it('queues repeated journal workflow examples recognized by journal detection', () => {
    const suggestions = detectAndQueueSkillSuggestions({
      journal: [
        'Prepare a concise weekly alliance digest for the team.',
        'Prepare a concise weekly alliance digest from journal notes.',
        'Prepare a concise weekly alliance digest for Monday.',
      ],
      createdBy: 'test',
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].proposedSkillName).toBe(
      'prepare-concise-weekly-alliance-digest',
    );
  });
});
