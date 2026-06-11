import fs from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-assistant-profile-test';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanocrab-assistant-profile-test/data',
  GROUPS_DIR: '/tmp/nanocrab-assistant-profile-test/groups',
}));

import {
  applyAssistantProfileBlock,
  defaultAssistantProfile,
  propagateAssistantProfileToGroups,
  saveAssistantProfile,
} from './assistant-profile.js';

describe('assistant profile', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('adds and replaces a managed profile block without clobbering custom text', () => {
    const profile = defaultAssistantProfile();
    profile.personality = 'Use concise, careful answers.';
    const first = applyAssistantProfileBlock(
      '# Group Rules\nKeep local notes.',
      profile,
    );

    expect(first).toContain('# Group Rules');
    expect(first).toContain('Use concise, careful answers.');

    profile.personality = 'Use warmer answers.';
    const second = applyAssistantProfileBlock(first, profile);

    expect(second).toContain('# Group Rules');
    expect(second).toContain('Use warmer answers.');
    expect(second).not.toContain('Use concise, careful answers.');
  });

  it('saves skill preferences and propagates profile blocks to groups', () => {
    const groupsDir = path.join(TEST_ROOT, 'groups');
    const mainDir = path.join(groupsDir, 'main');
    fs.mkdirSync(mainDir, { recursive: true });
    fs.writeFileSync(path.join(mainDir, 'AGENTS.md'), '# Main\nCustom line.\n');

    const profile = saveAssistantProfile({
      personality: 'Prefer direct operational updates.',
      enabledSkillPreferenceIds: ['memory', 'operations'],
    });
    const updated = propagateAssistantProfileToGroups(profile, groupsDir);

    expect(updated).toEqual(['main']);
    const content = fs.readFileSync(path.join(mainDir, 'AGENTS.md'), 'utf-8');
    expect(content).toContain('Custom line.');
    expect(content).toContain('Prefer direct operational updates.');
    expect(content).toContain('Memory');
    expect(content).toContain('Operations');
    expect(content).not.toContain('Coding:');
  });
});
