import { describe, expect, it } from 'vitest';

import {
  authorizeConnectorAction,
  filterAllowedConnectorIds,
  normalizeConnectorPermission,
  type ConnectorPermission,
} from './connector-permissions.js';

const basePermission: ConnectorPermission = {
  connectorId: 'github',
  scope: 'groups',
  allowedActions: ['issues.read', 'pulls.read'],
  requiresApproval: false,
  groups: ['main'],
  agents: [],
  createdAt: '2026-06-13T10:00:00.000Z',
  updatedAt: '2026-06-13T10:00:00.000Z',
};

describe('connector permissions', () => {
  it('allows an in-scope read action without approval', () => {
    const decision = authorizeConnectorAction({
      permissions: [basePermission],
      connectorId: 'github',
      action: 'issues.read',
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.decision).toBe('allowed');
    expect(decision.requiresApproval).toBe(false);
  });

  it('denies out-of-scope groups before policy evaluation can expose tools', () => {
    const decision = authorizeConnectorAction({
      permissions: [basePermission],
      connectorId: 'github',
      action: 'issues.read',
      groupFolder: 'scouts',
      agentId: 'scouts',
      isMain: false,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decision).toBe('denied');
    expect(decision.reason).toContain('not in connector scope');
  });

  it('requires approval for write-capable external connector actions', () => {
    const decision = authorizeConnectorAction({
      permissions: [
        {
          ...basePermission,
          allowedActions: ['issues.read', 'issues.write'],
          requiresApproval: true,
        },
      ],
      connectorId: 'github',
      action: 'issues.write',
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.decision).toBe('requires_approval');
    expect(decision.requiresApproval).toBe(true);
  });

  it('filters connector ids using group and agent scope', () => {
    const filtered = filterAllowedConnectorIds({
      connectorIds: ['github', 'infomaniak', 'kdrive'],
      permissions: [
        basePermission,
        {
          ...basePermission,
          connectorId: 'infomaniak',
          scope: 'agents',
          groups: [],
          agents: ['main:writer'],
        },
        {
          ...basePermission,
          connectorId: 'kdrive',
          scope: 'groups',
          groups: ['operations'],
        },
      ],
      groupFolder: 'main',
      agentId: 'main:writer',
      isMain: true,
      action: 'tools.expose',
    });

    expect(filtered).toEqual(['github', 'infomaniak']);
  });

  it('normalizes malformed permission records to conservative defaults', () => {
    const permission = normalizeConnectorPermission({
      connectorId: 'Mail Bridge',
      allowedActions: 'messages.send',
      groups: 'main',
      agents: 'agent-1',
    });

    expect(permission.connectorId).toBe('mail-bridge');
    expect(permission.scope).toBe('groups');
    expect(permission.allowedActions).toEqual(['messages.send']);
    expect(permission.requiresApproval).toBe(true);
    expect(permission.groups).toEqual(['main']);
    expect(permission.agents).toEqual(['agent-1']);
  });
});
