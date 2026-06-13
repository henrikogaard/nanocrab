import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildInfomaniakWorkflows } from './infomaniak-workflows.js';

function skillFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanocrab-infomaniak-'));
  const file = path.join(
    root,
    'container',
    'skills',
    'infomaniak-ksuite',
    'SKILL.md',
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Infomaniak kSuite\n');
  return file;
}

const readyServer = {
  name: 'infomaniak',
  allEnvSet: true,
  envStatus: [
    { key: 'INFOMANIAK_TOKEN', isSet: true },
    { key: 'KDRIVE_ID', isSet: true },
    { key: 'MAIL_USER', isSet: true },
    { key: 'MAIL_PASSWORD', isSet: true },
    { key: 'DAV_USER', isSet: true },
    { key: 'DAV_PASSWORD', isSet: true },
  ],
  permission: {
    connectorId: 'infomaniak',
    scope: 'main' as const,
    allowedActions: ['*.read', 'tools.expose'],
    requiresApproval: true,
    groups: [],
    agents: [],
    createdAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
  },
};

describe('infomaniak workflows', () => {
  it('reports document workflows ready when preset, credentials, permission, and skill are present', () => {
    const result = buildInfomaniakWorkflows({
      servers: [readyServer],
      presets: [{ name: 'infomaniak', installed: true }],
      skillPath: skillFile(),
      now: new Date('2026-06-13T10:01:00.000Z'),
    });

    expect(result.status).toBe('ready');
    expect(result.summary.ready).toBe(result.summary.total);
    expect(result.workflows).toContainEqual(
      expect.objectContaining({
        id: 'upload-share',
        status: 'ready',
        approvalRequired: true,
      }),
    );
  });

  it('blocks write-capable document workflow when approval is disabled', () => {
    const result = buildInfomaniakWorkflows({
      servers: [
        {
          ...readyServer,
          permission: {
            ...readyServer.permission,
            requiresApproval: false,
          },
        },
      ],
      presets: [{ name: 'infomaniak', installed: true }],
      skillPath: skillFile(),
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
      expect.objectContaining({ id: 'upload-share', status: 'blocked' }),
    );
  });
});
