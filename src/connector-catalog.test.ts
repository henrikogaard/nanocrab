import { describe, expect, it } from 'vitest';

import { buildConnectorCatalog } from './connector-catalog.js';

const timestamp = '2026-06-13T11:00:00.000Z';

function permission(overrides = {}) {
  return {
    connectorId: 'github',
    scope: 'main' as const,
    allowedActions: ['issues.read', 'pulls.read', 'tools.expose'],
    requiresApproval: true,
    groups: [],
    agents: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('connector catalog', () => {
  it('summarizes installed connectors, credentials, and setup steps', () => {
    const result = buildConnectorCatalog({
      servers: [
        {
          name: 'github',
          label: 'GitHub',
          envStatus: [{ key: 'GITHUB_TOKEN', isSet: true }],
          allEnvSet: true,
          permission: permission(),
        },
        {
          name: 'infomaniak',
          label: 'Infomaniak kSuite',
          envStatus: [
            { key: 'INFOMANIAK_TOKEN', isSet: true },
            { key: 'KDRIVE_ID', isSet: true },
            { key: 'MAIL_USER', isSet: false },
            { key: 'MAIL_PASSWORD', isSet: false },
            { key: 'DAV_USER', isSet: true },
            { key: 'DAV_PASSWORD', isSet: true },
          ],
          allEnvSet: false,
          permission: permission({
            connectorId: 'infomaniak',
            allowedActions: ['*.read', 'tools.expose'],
          }),
        },
      ],
      presets: [{ name: 'infomaniak', installed: true }],
      now: new Date(timestamp),
    });

    expect(result.status).toBe('attention');
    expect(result.summary.installed).toBeGreaterThanOrEqual(3);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: 'github',
        installed: true,
        missingEnvVars: [],
      }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: 'infomaniak',
        status: 'attention',
        missingEnvVars: ['MAIL_USER', 'MAIL_PASSWORD'],
      }),
    );
  });

  it('blocks write-capable external connectors without approval', () => {
    const result = buildConnectorCatalog({
      servers: [
        {
          name: 'github',
          label: 'GitHub',
          envStatus: [{ key: 'GITHUB_TOKEN', isSet: true }],
          allEnvSet: true,
          permission: permission({
            allowedActions: ['issues.read', 'issues.write', 'tools.expose'],
            requiresApproval: false,
          }),
        },
      ],
      presets: [],
      now: new Date(timestamp),
    });

    expect(result.status).toBe('blocked');
    expect(result.items).toContainEqual(
      expect.objectContaining({
        id: 'github',
        status: 'blocked',
      }),
    );
    expect(
      result.items.find((item) => item.id === 'github')?.steps,
    ).toContainEqual(
      expect.objectContaining({
        id: 'approval-gate',
        status: 'blocked',
        severity: 'required',
      }),
    );
  });
});
