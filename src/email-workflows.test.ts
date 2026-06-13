import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildEmailWorkflows } from './email-workflows.js';

function skillPath(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-email-'));
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
    allowedActions: ['mail.read', 'tools.expose'],
    requiresApproval: true,
    groups: [],
    agents: [],
    createdAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  },
};

describe('email workflows', () => {
  it('reports email workflows ready with a configured provider and skills', () => {
    const result = buildEmailWorkflows({
      servers: [googleServer],
      emailSkillPath: skillPath('email-assistant'),
      inboxTriageSkillPath: skillPath('inbox-triage'),
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.summary.ready).toBe(result.summary.total);
    expect(result.workflows).toContainEqual(
      expect.objectContaining({
        id: 'send-reply',
        status: 'ready',
        approvalRequired: true,
      }),
    );
  });

  it('blocks outbound mail and mailbox mutation workflows when approval is disabled', () => {
    const result = buildEmailWorkflows({
      servers: [
        {
          ...googleServer,
          permission: {
            ...googleServer.permission,
            requiresApproval: false,
          },
        },
      ],
      emailSkillPath: skillPath('email-assistant'),
      inboxTriageSkillPath: skillPath('inbox-triage'),
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
      expect.objectContaining({ id: 'send-reply', status: 'blocked' }),
    );
    expect(result.workflows).toContainEqual(
      expect.objectContaining({ id: 'mailbox-mutation', status: 'blocked' }),
    );
  });
});
