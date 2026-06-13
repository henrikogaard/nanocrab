import fs from 'fs';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-skill-versions-test';

vi.mock('./config.js', () => ({
  CONTAINER_SKILLS_DIR: '/tmp/nanocrab-skill-versions-test/container/skills',
  STORE_DIR: '/tmp/nanocrab-skill-versions-test/store',
}));

import {
  getSkillInstallState,
  getSkillVersionDiff,
  listSkillVersions,
  recordSkillVersion,
  rollbackSkillVersion,
} from './skill-versions.js';

function writeSkill(skillPath: string, content: string): void {
  const dir = path.join(TEST_ROOT, 'container', 'skills', skillPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}

describe('skill version history', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('records installed skill content and reports install state', () => {
    writeSkill('battle-reports', '# Battle Reports\n\nv1\n');

    const version = recordSkillVersion({
      skillPath: 'battle-reports',
      actor: 'admin',
      action: 'install',
    });

    expect(version).toMatchObject({
      skillPath: 'battle-reports',
      version: 1,
      actor: 'admin',
      action: 'install',
    });
    expect(listSkillVersions('battle-reports')).toHaveLength(1);
    expect(getSkillInstallState('battle-reports')).toMatchObject({
      status: 'installed',
      currentVersion: 1,
      latestVersion: 1,
    });
  });

  it('diffs and rolls back to a previous version', () => {
    writeSkill('battle-reports', '# Battle Reports\n\nv1\n');
    recordSkillVersion({
      skillPath: 'battle-reports',
      actor: 'admin',
      action: 'install',
    });
    writeSkill('battle-reports', '# Battle Reports\n\nv2\n');
    recordSkillVersion({
      skillPath: 'battle-reports',
      actor: 'admin',
      action: 'update',
    });

    expect(getSkillVersionDiff('battle-reports', 1, 2)).toContain('-v1');

    const rolledBack = rollbackSkillVersion({
      skillPath: 'battle-reports',
      version: 1,
      actor: 'admin',
    });

    expect(rolledBack.action).toBe('rollback');
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
    ).toContain('v1');
    expect(
      listSkillVersions('battle-reports').map((entry) => entry.version),
    ).toEqual([3, 2, 1]);
  });

  it('marks installed skills modified when content drifts from latest history', () => {
    writeSkill('battle-reports', '# Battle Reports\n\nv1\n');
    recordSkillVersion({
      skillPath: 'battle-reports',
      actor: 'admin',
      action: 'install',
    });
    writeSkill('battle-reports', '# Battle Reports\n\nmanual edit\n');

    expect(getSkillInstallState('battle-reports')).toMatchObject({
      status: 'modified',
      currentVersion: null,
      latestVersion: 1,
    });
  });

  it('rejects unsafe skill names before reading or writing history', () => {
    expect(() => listSkillVersions('../outside')).toThrow('Invalid skill name');
    expect(() =>
      rollbackSkillVersion({
        skillPath: '../outside',
        version: 1,
        actor: 'admin',
      }),
    ).toThrow('Invalid skill name');
  });
});
