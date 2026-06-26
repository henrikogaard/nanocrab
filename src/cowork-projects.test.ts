import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-cowork-db-test-${Date.now()}`,
);
const DATA_DIR = path.join(
  os.tmpdir(),
  `nanocrab-cowork-db-data-${Date.now()}`,
);
const GROUPS_DIR = path.join(
  os.tmpdir(),
  `nanocrab-cowork-db-groups-${Date.now()}`,
);

vi.mock('./config.js', () => ({
  STORE_DIR,
  DATA_DIR,
  GROUPS_DIR,
  ASSISTANT_NAME: 'Assistant',
}));

const {
  _closeDatabase,
  _initTestDatabase,
  createCoworkProject,
  getCoworkProject,
  getCoworkProjects,
  touchCoworkProject,
  updateCoworkProjectContext,
} = await import('./db.js');

describe('Cowork project activity ordering', () => {
  beforeEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* may not be initialized */
    }
    _initTestDatabase();
  });

  afterEach(() => {
    try {
      _closeDatabase();
    } catch {
      /* ok */
    }
  });

  it('moves active projects to the top when files or chats update them', () => {
    createCoworkProject({
      id: 'older',
      name: 'Older Project',
      slug: 'older-project',
      description: null,
      instructions: null,
      created_at: '2026-06-01T08:00:00.000Z',
      updated_at: '2026-06-01T08:00:00.000Z',
    });
    createCoworkProject({
      id: 'newer',
      name: 'Newer Project',
      slug: 'newer-project',
      description: null,
      instructions: null,
      created_at: '2026-06-02T08:00:00.000Z',
      updated_at: '2026-06-02T08:00:00.000Z',
    });

    expect(getCoworkProjects().map((project) => project.id)).toEqual([
      'newer',
      'older',
    ]);

    touchCoworkProject('older', '2026-06-03T08:00:00.000Z');

    expect(getCoworkProject('older')?.updated_at).toBe(
      '2026-06-03T08:00:00.000Z',
    );
    expect(getCoworkProjects().map((project) => project.id)).toEqual([
      'older',
      'newer',
    ]);
  });

  it('updates project context and activity time', () => {
    createCoworkProject({
      id: 'context-project',
      name: 'Context Project',
      slug: 'context-project',
      description: null,
      instructions: null,
      created_at: '2026-06-01T08:00:00.000Z',
      updated_at: '2026-06-01T08:00:00.000Z',
    });

    const updated = updateCoworkProjectContext('context-project', {
      description: 'Turn inbound research into durable briefs.',
      instructions:
        'Use mail and document MCP servers for source gathering. Ask before external writes.',
      updated_at: '2026-06-04T08:00:00.000Z',
    });

    expect(updated?.description).toBe(
      'Turn inbound research into durable briefs.',
    );
    expect(updated?.instructions).toContain('mail and document MCP servers');
    expect(getCoworkProject('context-project')?.updated_at).toBe(
      '2026-06-04T08:00:00.000Z',
    );
  });
});
