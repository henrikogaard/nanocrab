import type { RegisteredGroup } from './types.js';

export type AgentChannelScope = 'own' | 'all' | 'none';
export type AgentFilesystemAccess = 'read-only' | 'read-write';
export type AgentProviderProfilePermission =
  | 'default_chat'
  | 'default_coding'
  | 'default_automation'
  | 'default_memory'
  | 'default_journal'
  | 'default_skill_factory'
  | 'default_reports'
  | 'default_documents'
  | 'default_vision'
  | string;

export interface AgentFilesystemScope {
  containerPath: string;
  access: AgentFilesystemAccess;
}

export interface AgentSkillScopePermission {
  allowedScopes: Array<'all' | 'main' | 'channels'>;
  allowedVisibility: Array<'shared' | 'private' | 'system'>;
}

export interface AgentExternalWritePermission {
  allowed: boolean;
  requiresApproval: boolean;
}

export interface AgentBoundary {
  agentId: string;
  groupFolder: string;
  isMain: boolean;
  channelScopes: AgentChannelScope[];
  filesystemScopes: AgentFilesystemScope[];
  skillScopes: AgentSkillScopePermission;
  providerProfiles: AgentProviderProfilePermission[];
  connectorIds: string[];
  externalWrites: AgentExternalWritePermission;
}

export interface RuntimeCapabilities {
  allowedConnectorIds: string[];
  allowedChannelScopes: AgentChannelScope[];
  allowedProviderProfiles: AgentProviderProfilePermission[];
  allowExternalWrites: boolean;
  externalWritesRequireApproval: boolean;
  allowedToolActions: string[];
}

interface SkillPolicyShape {
  enabled: boolean;
  scope: 'all' | 'main' | 'channels';
  visibility: 'shared' | 'private' | 'system';
}

const MAIN_PROVIDER_PROFILES: AgentProviderProfilePermission[] = [
  'default_chat',
  'default_coding',
  'default_automation',
  'default_memory',
  'default_journal',
  'default_skill_factory',
  'default_reports',
  'default_documents',
  'default_vision',
];

const CHANNEL_PROVIDER_PROFILES: AgentProviderProfilePermission[] = [
  'default_chat',
  'default_automation',
  'default_memory',
  'default_reports',
  'default_documents',
  'default_vision',
];

function normalizeConnectorId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function explicitConnectorIds(
  group: RegisteredGroup,
  availableConnectorIds: string[],
): string[] {
  const available = unique(
    ['nanocrab', ...availableConnectorIds].map(normalizeConnectorId),
  );
  const configured = group.containerConfig?.allowedMcpServers;
  if (configured === undefined) return available;
  return unique(['nanocrab', ...configured.map(normalizeConnectorId)]).filter(
    (connectorId) => available.includes(connectorId),
  );
}

export function resolveAgentBoundary(input: {
  group: RegisteredGroup;
  isMain?: boolean;
  agentId?: string;
  availableConnectorIds?: string[];
}): AgentBoundary {
  const isMain = input.isMain ?? input.group.isMain === true;
  const groupFolder = input.group.folder;
  const agentId = input.agentId || groupFolder;
  const availableConnectorIds = input.availableConnectorIds || [
    'nanocrab',
    'github',
  ];
  const connectorIds = explicitConnectorIds(input.group, availableConnectorIds);

  if (isMain) {
    return {
      agentId,
      groupFolder,
      isMain: true,
      channelScopes: ['own', 'all'],
      filesystemScopes: [
        { containerPath: '/workspace/project', access: 'read-only' },
        { containerPath: '/workspace/project/store', access: 'read-write' },
        { containerPath: '/workspace/group', access: 'read-write' },
        { containerPath: '/workspace/global', access: 'read-write' },
        { containerPath: '/workspace/ipc', access: 'read-write' },
        { containerPath: '/workspace/skills', access: 'read-only' },
      ],
      skillScopes: {
        allowedScopes: ['all', 'main', 'channels'],
        allowedVisibility: ['shared', 'private', 'system'],
      },
      providerProfiles: MAIN_PROVIDER_PROFILES,
      connectorIds,
      externalWrites: {
        allowed: true,
        requiresApproval: true,
      },
    };
  }

  return {
    agentId,
    groupFolder,
    isMain: false,
    channelScopes: ['own'],
    filesystemScopes: [
      { containerPath: '/workspace/group', access: 'read-write' },
      { containerPath: '/workspace/global', access: 'read-only' },
      { containerPath: '/workspace/ipc', access: 'read-write' },
      { containerPath: '/workspace/skills', access: 'read-only' },
    ],
    skillScopes: {
      allowedScopes: ['all', 'channels'],
      allowedVisibility: ['shared'],
    },
    providerProfiles: CHANNEL_PROVIDER_PROFILES,
    connectorIds,
    externalWrites: {
      allowed: false,
      requiresApproval: true,
    },
  };
}

export function canUseChannelScope(
  boundary: AgentBoundary,
  scope: AgentChannelScope,
): boolean {
  return boundary.channelScopes.includes(scope);
}

export function canUseProviderProfile(
  boundary: AgentBoundary,
  profile: string,
): boolean {
  return boundary.providerProfiles.includes(profile);
}

export function canUseSkill(
  boundary: AgentBoundary,
  skill: SkillPolicyShape,
): boolean {
  if (!skill.enabled) return false;
  if (!boundary.skillScopes.allowedScopes.includes(skill.scope)) return false;
  return boundary.skillScopes.allowedVisibility.includes(skill.visibility);
}

export function canUseFilesystemScope(
  boundary: AgentBoundary,
  containerPath: string,
  access: AgentFilesystemAccess,
): boolean {
  const scope = boundary.filesystemScopes.find(
    (item) => item.containerPath === containerPath,
  );
  if (!scope) return false;
  if (access === 'read-only') return true;
  return scope.access === 'read-write';
}

export function deriveRuntimeCapabilities(
  boundary: AgentBoundary,
  input: {
    connectorIds: string[];
    requestedConnectorIds?: string[];
  },
): RuntimeCapabilities {
  const requested = input.requestedConnectorIds
    ? input.requestedConnectorIds.map(normalizeConnectorId)
    : input.connectorIds.map(normalizeConnectorId);
  const available = new Set(input.connectorIds.map(normalizeConnectorId));
  const boundaryConnectors = new Set(boundary.connectorIds);
  const allowedConnectorIds = unique(requested).filter(
    (connectorId) =>
      available.has(connectorId) && boundaryConnectors.has(connectorId),
  );
  const allowedToolActions = ['read', 'mcp.call'];
  if (boundary.externalWrites.allowed) {
    allowedToolActions.push('external.write');
  }

  return {
    allowedConnectorIds,
    allowedChannelScopes: boundary.channelScopes,
    allowedProviderProfiles: boundary.providerProfiles,
    allowExternalWrites: boundary.externalWrites.allowed,
    externalWritesRequireApproval: boundary.externalWrites.requiresApproval,
    allowedToolActions,
  };
}
