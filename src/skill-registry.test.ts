import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  prepareActiveSkillsDirectory,
  isSkillVisibleForGroup,
  listSkillRegistry,
  selectSkillsForRequest,
  scoreSkillsForRequest,
} from './skill-registry.js';
import type { AgentBoundary } from './agent-boundaries.js';

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

  it('clamps scores and records injection reasons', () => {
    const matches = selectSkillsForRequest(
      Array.from({ length: 40 }, () => 'operation ops commander').join(' '),
      { isMain: true, limit: 3 },
    );

    expect(matches.injected).toHaveLength(1);
    expect(matches.injected[0].path).toBe('ops-commander');
    expect(matches.injected[0].score).toBeLessThanOrEqual(100);
    expect(matches.injected[0].injectionReasons.length).toBeGreaterThan(0);
    expect(matches.injected[0].decision).toBe('injected');
  });

  it('deterministically excludes low-score and over-limit skills', () => {
    const base = {
      category: 'custom' as const,
      enabled: true,
      scope: 'all' as const,
      visibility: 'shared' as const,
      examples: [],
      riskLevel: 'low' as const,
      requiredTools: [],
    };
    const skills = [
      {
        ...base,
        name: 'Alpha Skill',
        description: 'alpha helper',
        path: 'alpha-skill',
        triggers: ['alpha'],
      },
      {
        ...base,
        name: 'Beta Skill',
        description: 'beta helper',
        path: 'beta-skill',
        triggers: ['beta'],
      },
      {
        ...base,
        name: 'Gamma Skill',
        description: 'gamma helper',
        path: 'gamma-skill',
        triggers: ['gamma'],
      },
      {
        ...base,
        name: 'Zeta Skill',
        description: 'zeta helper',
        path: 'zeta-skill',
        triggers: ['zeta'],
      },
      {
        ...base,
        name: 'Silent Skill',
        description: 'unrelated',
        path: 'silent-skill',
        triggers: ['silent'],
      },
    ];
    const selection = selectSkillsForRequest('alpha beta gamma zeta', {
      isMain: true,
      limit: 2,
      maxBytes: 90,
      skills,
      skillBytes: {
        'alpha-skill': 40,
        'beta-skill': 80,
        'gamma-skill': 40,
        'zeta-skill': 40,
        'silent-skill': 40,
      },
    });

    expect(selection.injected).toHaveLength(2);
    expect(selection.excluded.length).toBeGreaterThan(0);
    expect(selection.excluded.map((skill) => skill.decision)).toContain(
      'excluded-byte-limit',
    );
    expect(selection.excluded.map((skill) => skill.decision)).toContain(
      'excluded-count-limit',
    );
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

  it('does not prepare private skills for unauthorized channel agents', () => {
    const runtimeDir = prepareActiveSkillsDirectory({
      groupFolder: 'test-private-channel',
      isMain: false,
      request: 'remember preferences',
      skills: [
        {
          name: 'Private Memory',
          description: 'Private memory helper',
          path: 'private-memory',
          category: 'custom',
          enabled: true,
          scope: 'all',
          visibility: 'private',
          triggers: ['remember'],
          examples: [],
          riskLevel: 'low',
          requiredTools: [],
        },
      ],
    });

    const registry = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, 'registry.json'), 'utf-8'),
    ) as unknown[];
    expect(registry).toHaveLength(0);
    expect(fs.existsSync(path.join(runtimeDir, 'private-memory'))).toBe(false);
  });

  it('uses agent boundaries to deny private skills even when legacy isMain is true', () => {
    const boundary: AgentBoundary = {
      agentId: 'limited-main',
      groupFolder: 'main',
      isMain: true,
      channelScopes: ['own'],
      filesystemScopes: [],
      skillScopes: {
        allowedScopes: ['all'],
        allowedVisibility: ['shared'],
      },
      providerProfiles: ['default_chat'],
      connectorIds: ['nanocrab'],
      externalWrites: { allowed: false, requiresApproval: true },
    };

    const selection = selectSkillsForRequest('remember', {
      isMain: true,
      agentBoundary: boundary,
      skills: [
        {
          name: 'Private Memory',
          description: 'Private memory helper',
          path: 'private-memory',
          category: 'custom',
          enabled: true,
          scope: 'all',
          visibility: 'private',
          triggers: ['remember'],
          examples: [],
          riskLevel: 'low',
          requiredTools: [],
        },
      ],
    });

    expect(selection.injected).toHaveLength(0);
    expect(selection.excluded[0].decision).toBe('excluded-visibility');
  });
});
