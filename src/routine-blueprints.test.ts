import { describe, expect, it } from 'vitest';

import { listRoutineBlueprints } from './routine-blueprints.js';

describe('routine blueprints', () => {
  it('ships the core Hermes/OpenClaw-inspired routine starters', () => {
    const blueprints = listRoutineBlueprints();
    const ids = blueprints.map((blueprint) => blueprint.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'daily-briefing',
        'issue-triage',
        'pr-review-digest',
        'dependency-update-check',
        'release-notes-drafter',
        'heartbeat-health-check',
      ]),
    );
  });

  it('includes schedule, prompt, context, and safety metadata', () => {
    const briefing = listRoutineBlueprints().find(
      (blueprint) => blueprint.id === 'daily-briefing',
    );

    expect(briefing).toMatchObject({
      title: 'Daily briefing',
      routineType: 'briefing',
      schedule: {
        type: 'cron',
        value: '0 8 * * 1-5',
        label: 'Weekdays at 08:00',
      },
      contextMode: 'isolated',
      deliveryMode: 'dashboard',
      toolPolicy: 'dry-run',
      requiredConnectors: expect.arrayContaining(['calendar', 'email']),
      skills: expect.arrayContaining(['calendar-assistant', 'email-assistant']),
    });
    expect(briefing?.prompt).toContain('concise morning briefing');
  });

  it('marks script-gated routines so they can skip waking an agent', () => {
    const health = listRoutineBlueprints().find(
      (blueprint) => blueprint.id === 'heartbeat-health-check',
    );

    expect(health).toMatchObject({
      routineType: 'heartbeat',
      scriptMode: 'gate',
      deliveryMode: 'dashboard',
      silentMarker: 'HEARTBEAT_OK',
      heartbeatPolicy: {
        quietHours: { start: '22:00', end: '07:00' },
        staleAfterMinutes: 120,
      },
    });
    expect(health?.script).toContain('"wakeAgent"');
    expect(health?.prompt).toContain('system health');
  });

  it('includes advanced automation templates for noisy coding workflows', () => {
    const ids = listRoutineBlueprints().map((blueprint) => blueprint.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'flaky-test-tracker',
        'dependency-security-watch',
        'release-webhook-approval',
        'inbox-sla-monitor',
        'github-auto-pick-review',
      ]),
    );
  });

  it('can merge routine blueprints declared by enabled skills', () => {
    const ids = listRoutineBlueprints().map((blueprint) => blueprint.id);

    expect(ids).toContain('skill-automation-safety-review');
  });
});
