import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  createMissionFromRunbook,
  createRunbook,
  loadMissionStore,
  updateMissionStep,
} from './missions.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-missions-'));
  return path.join(dir, 'missions.json');
}

describe('missions and runbooks', () => {
  it('creates a mission from a runbook and tracks step progress', () => {
    const storePath = tempStore();
    const runbook = createRunbook(
      {
        title: 'Morning Operations',
        description: 'Review overnight state and prepare the day.',
        steps: [
          { title: 'Collect signals', detail: 'Read overnight summaries.' },
          { title: 'Draft plan', detail: 'Prepare the operator brief.' },
        ],
      },
      { storePath, now: () => '2026-06-13T08:00:00.000Z' },
    );

    const mission = createMissionFromRunbook(
      {
        runbookId: runbook.id,
        title: 'Saturday briefing',
        owner: 'Henrik',
      },
      { storePath, now: () => '2026-06-13T08:05:00.000Z' },
    );

    const updated = updateMissionStep(
      mission.id,
      mission.steps[0].id,
      { status: 'completed', note: 'Signals collected from journal.' },
      { storePath, now: () => '2026-06-13T08:10:00.000Z' },
    );

    expect(updated.status).toBe('running');
    expect(updated.steps[0]).toMatchObject({
      title: 'Collect signals',
      status: 'completed',
      note: 'Signals collected from journal.',
      completedAt: '2026-06-13T08:10:00.000Z',
    });
    expect(updated.steps[1].status).toBe('pending');

    const persisted = loadMissionStore(storePath);
    expect(persisted.runbooks).toHaveLength(1);
    expect(persisted.missions[0].steps[0].status).toBe('completed');
  });

  it('does not complete approval-required mission steps without an approval reference', () => {
    const storePath = tempStore();
    const runbook = createRunbook(
      {
        title: 'Publish Orders',
        steps: [
          {
            title: 'Send orders',
            detail: 'Publish to the operations channel.',
            requiresApproval: true,
          },
        ],
      },
      { storePath },
    );
    const mission = createMissionFromRunbook(
      { runbookId: runbook.id, title: 'Nightfall orders' },
      { storePath },
    );

    expect(() =>
      updateMissionStep(
        mission.id,
        mission.steps[0].id,
        { status: 'completed' },
        { storePath },
      ),
    ).toThrow(/approval reference/i);
  });
});
