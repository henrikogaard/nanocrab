import { describe, expect, it } from 'vitest';

import {
  isSkillVisibleForGroup,
  listSkillRegistry,
  scoreSkillsForRequest,
} from './skill-registry.js';

describe('skill registry', () => {
  it('lists bundled skills with registry metadata', () => {
    const skills = listSkillRegistry();
    expect(skills.map((skill) => skill.path)).toContain('memory-curator');
    expect(skills.map((skill) => skill.path)).toContain('ops-commander');
    const ops = skills.find((skill) => skill.path === 'ops-commander');
    expect(ops?.enabled).toBe(true);
    expect(ops?.scope).toBe('all');
    expect(ops?.visibility).toBe('shared');
    expect(ops?.triggers).toContain('operation');
  });

  it('scores skills for related requests', () => {
    const matches = scoreSkillsForRequest(
      'Plan an attack operation and repeat the orders to participants',
    );
    expect(matches[0]?.path).toBe('ops-commander');
    expect(matches[0]?.score).toBeGreaterThan(0);
  });

  it('can expose blocked skill matches for missing required tools', () => {
    const blocked = scoreSkillsForRequest('Plan an attack operation', {
      availableTools: ['Bash(git:*)'],
      includeBlocked: true,
    }).find((skill) => skill.path === 'ops-commander');

    expect(blocked?.blockedReasons?.join(',')).toContain('missing-tools');

    const allowed = scoreSkillsForRequest('Plan an attack operation', {
      availableTools: ['Bash(git:*)'],
    });
    expect(allowed.map((skill) => skill.path)).not.toContain('ops-commander');
  });

  it('enforces private and scoped visibility', () => {
    expect(
      isSkillVisibleForGroup(
        { enabled: true, scope: 'main', visibility: 'shared' },
        false,
      ),
    ).toBe(false);
    expect(
      isSkillVisibleForGroup(
        { enabled: true, scope: 'all', visibility: 'private' },
        false,
      ),
    ).toBe(false);
    expect(
      isSkillVisibleForGroup(
        { enabled: true, scope: 'all', visibility: 'private' },
        true,
      ),
    ).toBe(true);
  });
});
