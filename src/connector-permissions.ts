import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { evaluatePolicy, type PolicyDecisionStatus } from './policy-engine.js';

export type ConnectorPermissionScope = 'all' | 'main' | 'groups' | 'agents';

export interface ConnectorPermission {
  connectorId: string;
  scope: ConnectorPermissionScope;
  allowedActions: string[];
  requiresApproval: boolean;
  groups: string[];
  agents: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorPermissionDecision {
  allowed: boolean;
  connectorId: string;
  action: string;
  decision: PolicyDecisionStatus;
  requiresApproval: boolean;
  reason: string;
  matchedPermission?: ConnectorPermission;
}

export interface ConnectorAuthorizationInput {
  permissions?: ConnectorPermission[];
  connectorId: string;
  action: string;
  groupFolder: string;
  agentId?: string;
  isMain?: boolean;
  isCoworkProject?: boolean;
  dryRun?: boolean;
  context?: unknown;
}

const CONNECTOR_PERMISSIONS_PATH = path.join(
  STORE_DIR,
  'connector-permissions.json',
);

const DEFAULT_CONNECTOR_ACTIONS = ['*'];
const READ_TOOL_PREFIXES = [
  'get',
  'list',
  'read',
  'search',
  'fetch',
  'download',
  'help',
];
const WRITE_TOOL_PREFIXES = [
  'create',
  'update',
  'delete',
  'send',
  'upload',
  'push',
  'commit',
  'merge',
  'write',
];
type ConnectorToolMode = 'read' | 'write';

interface ConnectorToolManifestEntry {
  mode: ConnectorToolMode;
  patterns: string[];
}

const CONNECTOR_TOOL_MANIFESTS: Record<
  string,
  Record<string, ConnectorToolManifestEntry>
> = {
  github: {
    'issues.read': {
      mode: 'read',
      patterns: [
        'get_issue*',
        'list_issue*',
        'search_issue*',
        'get_issues*',
        'list_issues*',
        'search_issues*',
      ],
    },
    'pulls.read': {
      mode: 'read',
      patterns: [
        'get_pull*',
        'list_pull*',
        'search_pull*',
        'get_pulls*',
        'list_pulls*',
        'search_pulls*',
      ],
    },
    'issues.write': {
      mode: 'write',
      patterns: [
        'create_issue*',
        'update_issue*',
        'delete_issue*',
        'create_issues*',
        'update_issues*',
        'delete_issues*',
      ],
    },
    'pulls.write': {
      mode: 'write',
      patterns: [
        'create_pull*',
        'update_pull*',
        'merge_pull*',
        'create_pulls*',
        'update_pulls*',
        'merge_pulls*',
      ],
    },
  },
  gmail: {
    'mail.read': {
      mode: 'read',
      patterns: [
        'get_mail*',
        'list_mail*',
        'read_mail*',
        'search_mail*',
        'fetch_mail*',
      ],
    },
    'mail.write': {
      mode: 'write',
      patterns: [
        'create_mail*',
        'send_mail*',
        'update_mail*',
        'delete_mail*',
        'upload_mail*',
      ],
    },
  },
  'google-mail': {
    'mail.read': {
      mode: 'read',
      patterns: [
        'get_mail*',
        'list_mail*',
        'read_mail*',
        'search_mail*',
        'fetch_mail*',
      ],
    },
    'mail.write': {
      mode: 'write',
      patterns: [
        'create_mail*',
        'send_mail*',
        'update_mail*',
        'delete_mail*',
        'upload_mail*',
      ],
    },
  },
  'google-docs': {
    'document.read': {
      mode: 'read',
      patterns: [
        'get_document*',
        'list_document*',
        'read_document*',
        'search_document*',
        'fetch_document*',
      ],
    },
    'document.write': {
      mode: 'write',
      patterns: [
        'create_document*',
        'update_document*',
        'delete_document*',
        'upload_document*',
      ],
    },
  },
  'google-drive': {
    'file.read': {
      mode: 'read',
      patterns: [
        'get_file*',
        'list_file*',
        'read_file*',
        'search_file*',
        'fetch_file*',
      ],
    },
    'file.write': {
      mode: 'write',
      patterns: [
        'create_file*',
        'update_file*',
        'delete_file*',
        'upload_file*',
      ],
    },
  },
  calendar: {
    'calendar.read': {
      mode: 'read',
      patterns: [
        'get_calendar*',
        'list_calendar*',
        'read_calendar*',
        'search_calendar*',
        'fetch_calendar*',
      ],
    },
    'calendar.write': {
      mode: 'write',
      patterns: ['create_calendar*', 'update_calendar*', 'delete_calendar*'],
    },
  },
  'google-calendar': {
    'calendar.read': {
      mode: 'read',
      patterns: [
        'get_calendar*',
        'list_calendar*',
        'read_calendar*',
        'search_calendar*',
        'fetch_calendar*',
      ],
    },
    'calendar.write': {
      mode: 'write',
      patterns: ['create_calendar*', 'update_calendar*', 'delete_calendar*'],
    },
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeConnectorId(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeScope(value: unknown, groups: string[], agents: string[]) {
  if (value === 'all' || value === 'main' || value === 'groups') return value;
  if (value === 'agents') return value;
  if (groups.length > 0) return 'groups';
  if (agents.length > 0) return 'agents';
  return 'main';
}

export function normalizeConnectorPermission(
  value: Partial<ConnectorPermission> | Record<string, unknown>,
): ConnectorPermission {
  const groups = normalizeStringArray(value.groups);
  const agents = normalizeStringArray(value.agents);
  const timestamp = nowIso();
  return {
    connectorId: normalizeConnectorId(value.connectorId),
    scope: normalizeScope(value.scope, groups, agents),
    allowedActions:
      normalizeStringArray(value.allowedActions).length > 0
        ? normalizeStringArray(value.allowedActions)
        : DEFAULT_CONNECTOR_ACTIONS,
    requiresApproval:
      typeof value.requiresApproval === 'boolean'
        ? value.requiresApproval
        : true,
    groups,
    agents,
    createdAt:
      typeof value.createdAt === 'string' && value.createdAt.trim()
        ? value.createdAt
        : timestamp,
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt.trim()
        ? value.updatedAt
        : timestamp,
  };
}

export function defaultConnectorPermission(
  connectorId: string,
): ConnectorPermission | null {
  const normalized = normalizeConnectorId(connectorId);
  const timestamp = nowIso();
  if (normalized === 'github') {
    return {
      connectorId: normalized,
      scope: 'main',
      allowedActions: [
        'issues.read',
        'pulls.read',
        'issues.write',
        'pulls.write',
      ],
      requiresApproval: true,
      groups: [],
      agents: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
  if (normalized !== 'nanocrab') return null;
  return {
    connectorId: normalized,
    scope: 'all',
    allowedActions: ['*'],
    requiresApproval: false,
    groups: [],
    agents: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function loadConnectorPermissions(): ConnectorPermission[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(CONNECTOR_PERMISSIONS_PATH, 'utf-8'),
    );
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) =>
        normalizeConnectorPermission(item as Partial<ConnectorPermission>),
      )
      .filter((permission) => permission.connectorId);
  } catch {
    return [];
  }
}

export function saveConnectorPermissions(
  permissions: ConnectorPermission[],
): void {
  fs.mkdirSync(path.dirname(CONNECTOR_PERMISSIONS_PATH), { recursive: true });
  fs.writeFileSync(
    CONNECTOR_PERMISSIONS_PATH,
    `${JSON.stringify(
      permissions.map((permission) => normalizeConnectorPermission(permission)),
      null,
      2,
    )}\n`,
  );
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesAction(patterns: string[], action: string): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(action));
}

function inScope(
  permission: ConnectorPermission,
  input: {
    groupFolder: string;
    agentId?: string;
    isMain?: boolean;
    isCoworkProject?: boolean;
  },
): boolean {
  if (permission.scope === 'all') return true;
  if (permission.scope === 'main') {
    return input.isMain === true || input.isCoworkProject === true;
  }
  if (permission.scope === 'groups') {
    return permission.groups.includes(input.groupFolder);
  }
  return input.agentId ? permission.agents.includes(input.agentId) : false;
}

function findPermission(
  permissions: ConnectorPermission[],
  connectorId: string,
): ConnectorPermission | null {
  const normalized = normalizeConnectorId(connectorId);
  return (
    permissions.find((permission) => permission.connectorId === normalized) ||
    defaultConnectorPermission(normalized)
  );
}

function isExposureAction(action: string): boolean {
  return action === 'tools.expose' || action === 'connector.expose';
}

function isWriteAction(action: string): boolean {
  return /(^|\.)(write|send|create|update|delete|upload|push|commit|open_pr|execute)$/i.test(
    action,
  );
}

function toolPattern(connectorId: string, toolNamePattern: string): string {
  return `mcp__${connectorId}__${toolNamePattern}`;
}

function connectorToolManifestEntry(
  connectorId: string,
  action: string,
): ConnectorToolManifestEntry | null {
  const manifest = CONNECTOR_TOOL_MANIFESTS[normalizeConnectorId(connectorId)];
  if (!manifest) return null;
  return (
    manifest[
      String(action || '')
        .trim()
        .toLowerCase()
    ] || null
  );
}

function connectorActionMode(
  connectorId: string,
  action: string,
): ConnectorToolMode | null {
  const explicit = connectorToolManifestEntry(connectorId, action);
  if (explicit) return explicit.mode;
  if (isWriteAction(action)) return 'write';
  if (
    String(action || '')
      .trim()
      .match(/^(.+)\.read$/i)
  )
    return 'read';
  return null;
}

function actionNameVariants(action: string): string[] {
  const normalized = action.trim();
  return Array.from(
    new Set([
      normalized,
      normalized.replace(/[.:\s/]+/g, '_'),
      normalized.replace(/[.:\s/]+/g, '-'),
    ]),
  ).filter(Boolean);
}

function semanticToolPatterns(
  connectorId: string,
  resource: string,
  mode: 'read' | 'write',
): string[] {
  const prefixes = mode === 'read' ? READ_TOOL_PREFIXES : WRITE_TOOL_PREFIXES;
  if (resource === '*') {
    return prefixes.flatMap((prefix) => [
      toolPattern(connectorId, `${prefix}_*`),
      toolPattern(connectorId, `${prefix}-*`),
    ]);
  }
  const normalizedResource = resource.replace(/[^a-z0-9]+/gi, '_');
  return prefixes.flatMap((prefix) => [
    toolPattern(connectorId, `${prefix}_${normalizedResource}*`),
    toolPattern(
      connectorId,
      `${prefix}- ${normalizedResource}*`.replace(' ', ''),
    ),
    toolPattern(connectorId, `${normalizedResource}_${prefix}*`),
    toolPattern(connectorId, `${normalizedResource}-${prefix}*`),
  ]);
}

export function connectorActionToToolPatterns(
  connectorId: string,
  action: string,
): string[] {
  const normalizedConnectorId = normalizeConnectorId(connectorId);
  const normalizedAction = String(action || '').trim();
  if (!normalizedConnectorId || !normalizedAction) return [];
  if (
    normalizedAction === 'tools.expose' ||
    normalizedAction === 'connector.expose'
  ) {
    return [];
  }
  if (normalizedAction === '*')
    return [toolPattern(normalizedConnectorId, '*')];

  const explicit = connectorToolManifestEntry(
    normalizedConnectorId,
    normalizedAction,
  );
  if (explicit) {
    return explicit.patterns.map((pattern) =>
      toolPattern(normalizedConnectorId, pattern),
    );
  }

  const semantic = normalizedAction.match(/^(.+)\.(read|write)$/i);
  if (semantic) {
    return semanticToolPatterns(
      normalizedConnectorId,
      semantic[1].toLowerCase(),
      semantic[2].toLowerCase() as 'read' | 'write',
    );
  }

  return actionNameVariants(normalizedAction).map((variant) =>
    toolPattern(normalizedConnectorId, variant),
  );
}

export function authorizeConnectorAction(
  input: ConnectorAuthorizationInput,
): ConnectorPermissionDecision {
  const connectorId = normalizeConnectorId(input.connectorId);
  const permissions = input.permissions || loadConnectorPermissions();
  const permission = findPermission(permissions, connectorId);

  if (!permission) {
    return {
      allowed: false,
      connectorId,
      action: input.action,
      decision: 'denied',
      requiresApproval: false,
      reason: `Connector "${connectorId}" has no permission record.`,
    };
  }

  if (!inScope(permission, input)) {
    return {
      allowed: false,
      connectorId,
      action: input.action,
      decision: 'denied',
      requiresApproval: permission.requiresApproval,
      reason: `Agent ${input.agentId || input.groupFolder} is not in connector scope for ${connectorId}.`,
      matchedPermission: permission,
    };
  }

  if (
    !isExposureAction(input.action) &&
    !matchesAction(permission.allowedActions, input.action)
  ) {
    return {
      allowed: false,
      connectorId,
      action: input.action,
      decision: 'denied',
      requiresApproval: permission.requiresApproval,
      reason: `Action "${input.action}" is not allowed for connector "${connectorId}".`,
      matchedPermission: permission,
    };
  }

  if (
    permission.requiresApproval &&
    !isExposureAction(input.action) &&
    connectorActionMode(connectorId, input.action) === 'write'
  ) {
    return {
      allowed: false,
      connectorId,
      action: input.action,
      decision: 'requires_approval',
      requiresApproval: true,
      reason: `Connector "${connectorId}" action "${input.action}" requires approval.`,
      matchedPermission: permission,
    };
  }

  const policy = evaluatePolicy({
    actor: input.groupFolder,
    actorId: input.agentId || null,
    actionType: `connector.${connectorId}.${input.action}`,
    resource: connectorId,
    dryRun: input.dryRun,
    context: input.context || {
      connectorId,
      action: input.action,
      groupFolder: input.groupFolder,
      agentId: input.agentId || null,
    },
  });

  if (
    policy.decision === 'denied' ||
    policy.decision === 'requires_approval' ||
    (isWriteAction(input.action) && policy.decision !== 'allowed')
  ) {
    return {
      allowed: false,
      connectorId,
      action: input.action,
      decision: policy.decision,
      requiresApproval: policy.approvalRequired,
      reason: policy.explanation,
      matchedPermission: permission,
    };
  }

  return {
    allowed: true,
    connectorId,
    action: input.action,
    decision: policy.decision,
    requiresApproval: false,
    reason: policy.explanation,
    matchedPermission: permission,
  };
}

export function filterAllowedConnectorIds(input: {
  connectorIds: string[];
  permissions?: ConnectorPermission[];
  groupFolder: string;
  agentId?: string;
  isMain?: boolean;
  isCoworkProject?: boolean;
  action?: string;
}): string[] {
  const seen = new Set<string>();
  return input.connectorIds
    .map((connectorId) => normalizeConnectorId(connectorId))
    .filter(Boolean)
    .filter((connectorId) => {
      if (seen.has(connectorId)) return false;
      seen.add(connectorId);
      const decision = authorizeConnectorAction({
        permissions: input.permissions,
        connectorId,
        action: input.action || 'tools.expose',
        groupFolder: input.groupFolder,
        agentId: input.agentId,
        isMain: input.isMain,
        isCoworkProject: input.isCoworkProject,
      });
      return decision.allowed;
    });
}

export function getAllowedConnectorToolPatterns(input: {
  connectorIds: string[];
  permissions?: ConnectorPermission[];
  groupFolder: string;
  agentId?: string;
  isMain?: boolean;
  isCoworkProject?: boolean;
  dryRun?: boolean;
}): string[] {
  const permissions = input.permissions || loadConnectorPermissions();
  const patterns: string[] = [];
  for (const connectorId of input.connectorIds) {
    const permission = findPermission(permissions, connectorId);
    if (!permission || !inScope(permission, input)) continue;
    for (const action of permission.allowedActions) {
      if (action === 'tools.expose' || action === 'connector.expose') continue;
      if (
        permission.requiresApproval &&
        permission.connectorId !== 'nanocrab' &&
        (action === '*' ||
          connectorActionMode(permission.connectorId, action) === 'write')
      ) {
        continue;
      }
      const decision = authorizeConnectorAction({
        permissions,
        connectorId: permission.connectorId,
        action,
        groupFolder: input.groupFolder,
        agentId: input.agentId,
        isMain: input.isMain,
        isCoworkProject: input.isCoworkProject,
        dryRun: input.dryRun,
      });
      if (!decision.allowed) continue;
      patterns.push(
        ...connectorActionToToolPatterns(permission.connectorId, action),
      );
    }
  }
  return Array.from(new Set(patterns));
}
