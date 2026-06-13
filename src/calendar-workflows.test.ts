import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildCalendarWorkflows } from './calendar-workflows.js';

function skillPath(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-calendar-'));
  const file = path.join(root, 'container', 'skills', name, 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${name}\n`);
  return file;
}

const googleServer = {
  name: 'google-workspace',
  allEnvSet: true,
  envStatus: [
    { key: 'GOOGLE_OAUTH_CLIENT_ID', isSet: true },
    { key: 'GOOGLE_OAUTH_CLIENT_SECRET', isSet: true },
    { key: 'GOOGLE_REFRESH_TOKEN', isSet: true },
  ],
  permission: {
    connectorId: 'google-workspace',
    scope: 'main' as const,
    allowedActions: ['calendar.read', 'tools.expose'],
    requiresApproval: true,
    groups: [],
    agents: [],
    createdAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  },
};

describe('calendar workflows', () => {
  it('reports calendar workflows ready with a configured provider and skills', () => {
    const result = buildCalendarWorkflows({
      servers: [googleServer],
      calendarSkillPath: skillPath('calendar-assistant'),
      meetingSkillPath: skillPath('meeting-briefing'),
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.summary.ready).toBe(result.summary.total);
    expect(result.workflows).toContainEqual(
      expect.objectContaining({
        id: 'schedule-change',
        status: 'ready',
        approvalRequired: true,
      }),
    );
  });

  it('blocks calendar mutation workflows when approval is disabled', () => {
    const result = buildCalendarWorkflows({
      servers: [
        {
          ...googleServer,
          permission: {
            ...googleServer.permission,
            requiresApproval: false,
          },
        },
      ],
      calendarSkillPath: skillPath('calendar-assistant'),
      meetingSkillPath: skillPath('meeting-briefing'),
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('blocked');
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'write-approval',
        ok: false,
        severity: 'required',
      }),
    );
    expect(result.workflows).toContainEqual(
      expect.objectContaining({ id: 'schedule-change', status: 'blocked' }),
    );
  });
});
