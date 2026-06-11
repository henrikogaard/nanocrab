export type ConnectorCategory = 'channel' | 'mcp' | 'workflow';
export type ConnectorStatus = 'ready' | 'configured' | 'needs-setup';
export type ConnectorPermissionAccess = 'read' | 'write' | 'admin';
export type ConnectorRisk = 'low' | 'medium' | 'high';

export interface ConnectorPermission {
  scope: string;
  access: ConnectorPermissionAccess;
  approvalRequired: boolean;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  envVars: string[];
  installAction: string;
  skill?: string;
  mcpServer?: string;
  channel?: string;
  permissions: ConnectorPermission[];
  setupSteps: string[];
}

export interface ConnectorCatalogItem extends ConnectorDefinition {
  installed: boolean;
  configured: boolean;
  status: ConnectorStatus;
  risk: ConnectorRisk;
  approvalRequired: boolean;
  missingEnvVars: string[];
}

export interface ConnectorCatalog {
  summary: {
    total: number;
    ready: number;
    configured: number;
    needsSetup: number;
  };
  connectors: ConnectorCatalogItem[];
}

export const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    category: 'channel',
    channel: 'whatsapp',
    description: 'Messaging channel using Baileys with QR/pairing-code auth.',
    envVars: [],
    installAction: '/add-whatsapp',
    skill: 'container/skills/channel-formatting/SKILL.md',
    permissions: [
      { scope: 'messages:send', access: 'write', approvalRequired: true },
      { scope: 'messages:read', access: 'read', approvalRequired: false },
    ],
    setupSteps: ['Pair the account from the admin dashboard or service logs.'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    category: 'channel',
    channel: 'telegram',
    description: 'Telegram Bot API channel for groups and direct messages.',
    envVars: ['TELEGRAM_BOT_TOKEN'],
    installAction: '/add-telegram',
    permissions: [
      { scope: 'messages:send', access: 'write', approvalRequired: true },
      { scope: 'messages:read', access: 'read', approvalRequired: false },
    ],
    setupSteps: ['Create a bot with BotFather.', 'Set TELEGRAM_BOT_TOKEN.'],
  },
  {
    id: 'signal',
    name: 'Signal',
    category: 'channel',
    channel: 'signal',
    description: 'Signal channel through signal-cli.',
    envVars: ['SIGNAL_PHONE_NUMBER'],
    installAction: '/add-signal',
    permissions: [
      { scope: 'messages:send', access: 'write', approvalRequired: true },
      { scope: 'messages:read', access: 'read', approvalRequired: false },
    ],
    setupSteps: ['Register signal-cli.', 'Set SIGNAL_PHONE_NUMBER.'],
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'mcp',
    mcpServer: 'github',
    description: 'Issues, PRs, CI status, webhooks, and coding workflows.',
    envVars: ['GITHUB_TOKEN'],
    installAction: 'Built in MCP preset',
    skill: 'container/skills/github-issue-work/SKILL.md',
    permissions: [
      { scope: 'issues:read', access: 'read', approvalRequired: false },
      { scope: 'issues:write', access: 'write', approvalRequired: true },
      {
        scope: 'pull-requests:write',
        access: 'write',
        approvalRequired: true,
      },
    ],
    setupSteps: [
      'Set GITHUB_TOKEN.',
      'Configure webhook secret if using webhooks.',
    ],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    category: 'mcp',
    mcpServer: 'google-workspace',
    description: 'Gmail and Calendar workflows through MCP tools.',
    envVars: [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
    ],
    installAction: '/add-gmail',
    skill: 'container/skills/google-workspace/SKILL.md',
    permissions: [
      { scope: 'gmail:read', access: 'read', approvalRequired: false },
      { scope: 'gmail:send', access: 'write', approvalRequired: true },
      { scope: 'calendar:write', access: 'write', approvalRequired: true },
    ],
    setupSteps: [
      'Create an OAuth client.',
      'Store OAuth credentials and refresh token.',
    ],
  },
  {
    id: 'infomaniak',
    name: 'Infomaniak kSuite',
    category: 'mcp',
    mcpServer: 'infomaniak',
    description: 'Mail, kDrive, contacts, calendars, and DAV-backed resources.',
    envVars: [
      'INFOMANIAK_TOKEN',
      'KDRIVE_ID',
      'MAIL_USER',
      'MAIL_PASSWORD',
      'DAV_USER',
      'DAV_PASSWORD',
    ],
    installAction: 'Install MCP preset',
    skill: 'container/skills/infomaniak-ksuite/SKILL.md',
    permissions: [
      { scope: 'mail:read', access: 'read', approvalRequired: false },
      { scope: 'mail:send', access: 'write', approvalRequired: true },
      { scope: 'kdrive:write', access: 'write', approvalRequired: true },
      { scope: 'dav:write', access: 'write', approvalRequired: true },
    ],
    setupSteps: [
      'Install the Infomaniak MCP preset.',
      'Add token, kDrive, mail, and DAV credentials.',
    ],
  },
];

function riskForPermissions(permissions: ConnectorPermission[]): ConnectorRisk {
  if (permissions.some((permission) => permission.access === 'admin')) {
    return 'high';
  }
  if (permissions.some((permission) => permission.access === 'write')) {
    return 'high';
  }
  if (permissions.length > 0) return 'medium';
  return 'low';
}

export function buildConnectorCatalog(input: {
  activeChannels: string[];
  configuredMcpServers: string[];
  env: Record<string, string | undefined>;
}): ConnectorCatalog {
  const activeChannels = new Set(
    input.activeChannels.map((item) => item.toLowerCase()),
  );
  const mcpServers = new Set(
    input.configuredMcpServers.map((item) => item.toLowerCase()),
  );
  const connectors = CONNECTOR_DEFINITIONS.map((definition) => {
    const installed =
      (definition.channel && activeChannels.has(definition.channel)) ||
      (definition.mcpServer && mcpServers.has(definition.mcpServer)) ||
      false;
    const missingEnvVars = definition.envVars.filter((key) => !input.env[key]);
    const configured = missingEnvVars.length === 0;
    const status: ConnectorStatus =
      installed && configured
        ? 'ready'
        : configured
          ? 'configured'
          : 'needs-setup';
    const risk = riskForPermissions(definition.permissions);
    return {
      ...definition,
      installed,
      configured,
      status,
      risk,
      approvalRequired: definition.permissions.some(
        (permission) => permission.approvalRequired,
      ),
      missingEnvVars,
    };
  });
  return {
    summary: {
      total: connectors.length,
      ready: connectors.filter((item) => item.status === 'ready').length,
      configured: connectors.filter((item) => item.status === 'configured')
        .length,
      needsSetup: connectors.filter((item) => item.status === 'needs-setup')
        .length,
    },
    connectors,
  };
}
