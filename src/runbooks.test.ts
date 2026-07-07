import { describe, expect, it } from 'vitest';

import {
  archiveRunbook,
  createRunbook,
  runbookProgress,
  updateRunbookStep,
} from './runbooks.js';

describe('runbooks', () => {
  it('creates a mission runbook and tracks step progress', () => {
    const runbook = createRunbook({
      title: `Test mission ${Date.now()}`,
      mission: 'Coordinate the next implementation slice.',
      owner: 'vitest',
      steps: ['Investigate issue', 'Implement change', 'Verify tests'],
    });

    expect(runbook).toMatchObject({
      status: 'active',
      owner: 'vitest',
      steps: expect.arrayContaining([
        expect.objectContaining({ title: 'Investigate issue', status: 'todo' }),
      ]),
    });

    const updated = updateRunbookStep(runbook.id, runbook.steps[0].id, {
      status: 'done',
      notes: 'Plan captured.',
    });

    expect(updated.steps[0]).toMatchObject({
      status: 'done',
      notes: 'Plan captured.',
    });
    expect(runbookProgress(updated)).toMatchObject({
      total: 3,
      done: 1,
      percent: 33,
    });

    archiveRunbook(runbook.id);
  });

  it('rejects invalid step transitions', () => {
    const runbook = createRunbook({
      title: `Invalid transition test ${Date.now()}`,
      steps: ['Only step'],
    });

    expect(() =>
      updateRunbookStep(runbook.id, runbook.steps[0].id, {
        status: 'waiting' as never,
      }),
    ).toThrow('invalid runbook step status');

    archiveRunbook(runbook.id);
  });
});
