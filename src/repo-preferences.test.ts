import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildRepoRulesContext,
  listRepoRules,
  upsertRepoRule,
} from './repo-preferences.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-repo-rules-'));
  return path.join(dir, 'repo-rules.json');
}

describe('repo preference rules', () => {
  it('stores approved repo rules and builds coding prompt context', () => {
    const storePath = tempStore();

    const rule = upsertRepoRule(
      {
        repo: 'henrikogaard/nanocrab',
        title: 'Use Node 22',
        content: 'Run checks through `rtk mise exec node@22 -- ...`.',
        source: 'memory:mem-1',
        visibility: 'shared',
      },
      { storePath, now: () => '2026-06-13T09:00:00.000Z', id: () => 'rule-1' },
    );

    expect(rule).toMatchObject({
      id: 'rule-1',
      repo: 'henrikogaard/nanocrab',
      status: 'approved',
      visibility: 'shared',
    });
    expect(listRepoRules('henrikogaard/nanocrab', { storePath })).toHaveLength(
      1,
    );
    expect(
      buildRepoRulesContext('henrikogaard/nanocrab', { storePath }),
    ).toContain('- Use Node 22: Run checks through');
  });

  it('rejects secret-looking repo rules so credentials do not enter coding prompts', () => {
    expect(() =>
      upsertRepoRule(
        {
          repo: 'henrikogaard/nanocrab',
          title: 'Token',
          content: 'Use API token sk-secret before running tests.',
          visibility: 'shared',
        },
        { storePath: tempStore() },
      ),
    ).toThrow(/secret/i);
  });
});
