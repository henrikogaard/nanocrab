import fs from 'fs';
import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_ROOT = '/tmp/nanocrab-artifact-vault-test';

vi.mock('./config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  DATA_DIR: '/tmp/nanocrab-artifact-vault-test/data',
  GROUPS_DIR: '/tmp/nanocrab-artifact-vault-test/groups',
  STORE_DIR: '/tmp/nanocrab-artifact-vault-test/store',
}));

import { listArtifactVault } from './artifact-vault.js';

describe('artifact vault', () => {
  beforeEach(() => {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    fs.mkdirSync(path.join(TEST_ROOT, 'store', 'deliverables'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(TEST_ROOT, 'groups', 'main', 'artifacts'), {
      recursive: true,
    });
  });

  it('indexes deliverables and group artifacts with search metadata', () => {
    fs.writeFileSync(
      path.join(TEST_ROOT, 'store', 'deliverables', 'weekly-digest.md'),
      '# Weekly Digest\n',
    );
    fs.writeFileSync(
      path.join(TEST_ROOT, 'groups', 'main', 'artifacts', 'orders.csv'),
      'order,status\n',
    );

    const all = listArtifactVault({ retentionDays: 30 });
    expect(all.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['deliverable', 'group']),
    );
    expect(listArtifactVault({ query: 'weekly' })).toEqual([
      expect.objectContaining({
        kind: 'deliverable',
        name: 'weekly-digest.md',
        expired: false,
      }),
    ]);
  });

  it('hides expired artifacts unless requested', () => {
    const oldPath = path.join(TEST_ROOT, 'store', 'deliverables', 'old.md');
    fs.writeFileSync(oldPath, 'old');
    const old = new Date('2020-01-01T00:00:00.000Z');
    fs.utimesSync(oldPath, old, old);

    expect(listArtifactVault({ retentionDays: 1 })).toHaveLength(0);
    expect(
      listArtifactVault({ retentionDays: 1, includeExpired: true }),
    ).toEqual([expect.objectContaining({ name: 'old.md', expired: true })]);
  });
});
