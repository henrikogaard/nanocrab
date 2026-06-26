import { describe, expect, it } from 'vitest';

import {
  authorizeConnectorAction,
  filterAllowedConnectorIds,
  getAllowedConnectorToolPatterns,
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

  it('treats cowork project chats as owner-controlled connector surfaces', () => {
    const decision = authorizeConnectorAction({
      permissions: [
        {
          ...basePermission,
          connectorId: 'gmail',
          scope: 'main',
          allowedActions: ['mail.read', 'tools.expose'],
        },
      ],
      connectorId: 'gmail',
      action: 'mail.read',
      groupFolder: 'web-project-thread',
      agentId: 'web-project-thread',
      isMain: false,
      isCoworkProject: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.decision).toBe('allowed');
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

  it('narrows read-only connector permissions to read-like MCP tool patterns', () => {
    const patterns = getAllowedConnectorToolPatterns({
      permissions: [
        {
          ...basePermission,
          allowedActions: ['*.read'],
          requiresApproval: false,
        },
      ],
      connectorIds: ['github'],
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(patterns).toContain('mcp__github__get_*');
    expect(patterns).toContain('mcp__github__list_*');
    expect(patterns).not.toContain('mcp__github__*');
    expect(patterns).not.toContain('mcp__github__create_*');
    expect(patterns).not.toContain('mcp__github__delete_*');
  });

  it('exposes read MCP tools for approval-required connectors', () => {
    const patterns = getAllowedConnectorToolPatterns({
      permissions: [
        {
          ...basePermission,
          allowedActions: ['issues.read'],
          requiresApproval: true,
        },
      ],
      connectorIds: ['github'],
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(patterns).toEqual(
      expect.arrayContaining([
        'mcp__github__get_issues*',
        'mcp__github__search_issues*',
      ]),
    );
  });

  it('does not expose write MCP tools for approval-required connectors', () => {
    const patterns = getAllowedConnectorToolPatterns({
      permissions: [
        {
          ...basePermission,
          allowedActions: ['issues.read', 'issues.write'],
          requiresApproval: true,
        },
      ],
      connectorIds: ['github'],
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(patterns).toContain('mcp__github__search_issues*');
    expect(patterns).not.toContain('mcp__github__update_issues*');
    expect(patterns).not.toContain('mcp__github__delete_issues*');
  });

  it('uses known connector tool manifests before semantic fallbacks', () => {
    const patterns = getAllowedConnectorToolPatterns({
      permissions: [
        {
          ...basePermission,
          allowedActions: ['pulls.read', 'pulls.write'],
          requiresApproval: true,
        },
      ],
      connectorIds: ['GitHub'],
      groupFolder: 'main',
      agentId: 'main',
      isMain: true,
    });

    expect(patterns).toEqual(
      expect.arrayContaining([
        'mcp__github__get_pull*',
        'mcp__github__list_pulls*',
        'mcp__github__search_pull*',
      ]),
    );
    expect(patterns).not.toContain('mcp__github__pulls_read');
    expect(patterns).not.toContain('mcp__github__merge_pull*');
    expect(patterns).not.toContain('mcp__github__update_pulls*');
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

  it('exposes main-scoped MCP read tools to cowork project chats only', () => {
    const permissions: ConnectorPermission[] = [
      {
        ...basePermission,
        connectorId: 'gmail',
        scope: 'main',
        allowedActions: ['mail.read', 'tools.expose'],
        requiresApproval: false,
        groups: [],
      },
    ];

    expect(
      filterAllowedConnectorIds({
        connectorIds: ['gmail'],
        permissions,
        groupFolder: 'web-project-thread',
        agentId: 'web-project-thread',
        isMain: false,
        isCoworkProject: true,
        action: 'tools.expose',
      }),
    ).toEqual(['gmail']);

    expect(
      getAllowedConnectorToolPatterns({
        connectorIds: ['gmail'],
        permissions,
        groupFolder: 'web-project-thread',
        agentId: 'web-project-thread',
        isMain: false,
        isCoworkProject: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        'mcp__gmail__get_mail*',
        'mcp__gmail__search_mail*',
      ]),
    );

    expect(
      filterAllowedConnectorIds({
        connectorIds: ['gmail'],
        permissions,
        groupFolder: 'regular-channel',
        agentId: 'regular-channel',
        isMain: false,
        action: 'tools.expose',
      }),
    ).toEqual([]);
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
