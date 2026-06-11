import { describe, expect, it } from 'vitest';

import { buildConnectorCatalog } from './connector-catalog.js';

describe('connector catalog', () => {
  it('marks installed and fully configured connectors ready', () => {
    const catalog = buildConnectorCatalog({
      activeChannels: ['telegram'],
      configuredMcpServers: ['github'],
      env: {
        TELEGRAM_BOT_TOKEN: 'token',
        GITHUB_TOKEN: 'ghp_test',
      },
    });

    expect(
      catalog.connectors.find((item) => item.id === 'telegram'),
    ).toMatchObject({
      installed: true,
      configured: true,
      status: 'ready',
    });
    expect(
      catalog.connectors.find((item) => item.id === 'github'),
    ).toMatchObject({
      installed: true,
      configured: true,
      status: 'ready',
    });
  });

  it('reports missing credential setup for connector env vars', () => {
    const catalog = buildConnectorCatalog({
      activeChannels: [],
      configuredMcpServers: [],
      env: {},
    });

    expect(
      catalog.connectors.find((item) => item.id === 'infomaniak'),
    ).toMatchObject({
      status: 'needs-setup',
      risk: 'high',
      approvalRequired: true,
      missingEnvVars: expect.arrayContaining(['INFOMANIAK_TOKEN', 'KDRIVE_ID']),
    });
  });

  it('exposes permission scopes for connector audit views', () => {
    const catalog = buildConnectorCatalog({
      activeChannels: [],
      configuredMcpServers: ['github'],
      env: { GITHUB_TOKEN: 'token' },
    });

    expect(
      catalog.connectors.find((item) => item.id === 'github')?.permissions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'pull-requests:write',
          access: 'write',
          approvalRequired: true,
        }),
      ]),
    );
  });
});
