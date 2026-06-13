import type { ConnectorPermission } from './connector-permissions.js';

export type ConnectorCatalogStatus = 'ready' | 'attention' | 'blocked';
export type ConnectorCatalogSeverity = 'required' | 'advisory';

export interface ConnectorCatalogServer {
  name: string;
  label?: string;
  envVars?: string[];
  envStatus?: Array<{ key: string; isSet: boolean }>;
  allEnvSet?: boolean;
  permission?: ConnectorPermission;
}

export interface ConnectorCatalogPreset {
  name: string;
  installed?: boolean;
}

export interface ConnectorCatalogDefinition {
  id: string;
  label: string;
  category: string;
  summary: string;
  capabilities: string[];
  requiredEnvVars: string[];
  setupPath: 'built-in' | 'preset' | 'manual';
  presetName?: string;
  writesRequireApproval?: boolean;
}

export interface ConnectorCatalogStep {
  id: string;
  label: string;
  status: ConnectorCatalogStatus;
  severity: ConnectorCatalogSeverity;
  detail: string;
  action?: string;
}

export interface ConnectorCatalogItem extends ConnectorCatalogDefinition {
  status: ConnectorCatalogStatus;
  installed: boolean;
  ready: boolean;
  missingEnvVars: string[];
  approvalRequired: boolean;
  steps: ConnectorCatalogStep[];
}

export interface ConnectorCatalogResult {
  status: ConnectorCatalogStatus;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
    installed: number;
  };
  items: ConnectorCatalogItem[];
}

export interface BuildConnectorCatalogInput {
  servers: ConnectorCatalogServer[];
  presets: ConnectorCatalogPreset[];
  now?: Date;
  definitions?: ConnectorCatalogDefinition[];
}

export const DEFAULT_CONNECTOR_CATALOG: ConnectorCatalogDefinition[] = [
  {
    id: 'nanocrab',
    label: 'NanoCrab IPC',
    category: 'Core',
    summary:
      'Internal control plane for group, task, memory, and coding-job tools.',
    capabilities: ['Groups', 'Tasks', 'Memory', 'Coding jobs'],
    requiredEnvVars: [],
    setupPath: 'built-in',
    writesRequireApproval: false,
  },
  {
    id: 'github',
    label: 'GitHub',
    category: 'Developer',
    summary:
      'Issue triage, pull requests, webhooks, and coding-job automation.',
    capabilities: ['Issues', 'Pull requests', 'Webhooks', 'Coding jobs'],
    requiredEnvVars: ['GITHUB_TOKEN'],
    setupPath: 'built-in',
    writesRequireApproval: true,
  },
  {
    id: 'infomaniak',
    label: 'Infomaniak kSuite',
    category: 'Productivity',
    summary: 'kDrive, DAV calendar, mail, and document workflow access.',
    capabilities: ['kDrive', 'Mail', 'Calendar', 'Documents'],
    requiredEnvVars: [
      'INFOMANIAK_TOKEN',
      'KDRIVE_ID',
      'MAIL_USER',
      'MAIL_PASSWORD',
      'DAV_USER',
      'DAV_PASSWORD',
    ],
    setupPath: 'preset',
    presetName: 'infomaniak',
    writesRequireApproval: true,
  },
  {
    id: 'google-workspace',
    label: 'Google Workspace',
    category: 'Productivity',
    summary:
      'Gmail and Google Calendar workflows through compatible MCP servers.',
    capabilities: ['Gmail', 'Calendar', 'Meetings', 'Briefings'],
    requiredEnvVars: [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_REFRESH_TOKEN',
    ],
    setupPath: 'manual',
    writesRequireApproval: true,
  },
];

function hasAction(
  permission: ConnectorPermission | undefined,
  fragment: string,
) {
  return !!permission?.allowedActions.some(
    (action) => action === '*' || action.includes(fragment),
  );
}

function hasWritePermission(permission: ConnectorPermission | undefined) {
  return !!permission?.allowedActions.some(
    (action) =>
      action === '*' ||
      /(^|[.*:_-])(write|send|create|update|delete|upload|push|commit|merge|execute)$/i.test(
        action,
      ) ||
      /(write|send|create|update|delete|upload|push|commit|merge|execute)/i.test(
        action,
      ),
  );
}

function stepStatus(steps: ConnectorCatalogStep[]): ConnectorCatalogStatus {
  if (
    steps.some(
      (step) => step.status === 'blocked' && step.severity === 'required',
    )
  ) {
    return 'blocked';
  }
  if (steps.some((step) => step.status !== 'ready')) return 'attention';
  return 'ready';
}

function summarize(items: ConnectorCatalogItem[]) {
  return {
    total: items.length,
    ready: items.filter((item) => item.status === 'ready').length,
    attention: items.filter((item) => item.status === 'attention').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
    installed: items.filter((item) => item.installed).length,
  };
}

export function buildConnectorCatalog(
  input: BuildConnectorCatalogInput,
): ConnectorCatalogResult {
  const servers = new Map(input.servers.map((server) => [server.name, server]));
  const presets = new Map(input.presets.map((preset) => [preset.name, preset]));
  const definitions = input.definitions || DEFAULT_CONNECTOR_CATALOG;

  const items = definitions.map((definition): ConnectorCatalogItem => {
    const server = servers.get(definition.id);
    const preset = definition.presetName
      ? presets.get(definition.presetName)
      : undefined;
    const installed =
      definition.setupPath === 'built-in' || !!server || !!preset?.installed;
    const missingEnvVars = definition.requiredEnvVars.filter((key) => {
      const envStatus = server?.envStatus?.find((status) => status.key === key);
      return !envStatus?.isSet;
    });
    const permission = server?.permission;
    const approvalRequired =
      definition.writesRequireApproval === true
        ? permission?.requiresApproval !== false
        : !!permission?.requiresApproval;
    const readAllowed =
      definition.setupPath === 'built-in' && definition.id === 'nanocrab'
        ? true
        : hasAction(permission, 'read') || hasAction(permission, 'expose');
    const unsafeWrites =
      definition.writesRequireApproval === true &&
      hasWritePermission(permission) &&
      permission?.requiresApproval === false;

    const steps: ConnectorCatalogStep[] = [
      {
        id: 'install',
        label: 'Install connector',
        status: installed ? 'ready' : 'attention',
        severity: definition.setupPath === 'manual' ? 'advisory' : 'required',
        detail: installed
          ? 'Connector is present in the MCP configuration'
          : definition.setupPath === 'preset'
            ? 'Install the recommended MCP preset'
            : 'Add a compatible MCP server manually',
        action:
          installed || definition.setupPath === 'built-in'
            ? undefined
            : definition.setupPath === 'preset'
              ? 'Install preset'
              : 'Add server',
      },
      {
        id: 'credentials',
        label: 'Configure credentials',
        status: missingEnvVars.length === 0 ? 'ready' : 'attention',
        severity: 'required',
        detail:
          missingEnvVars.length === 0
            ? 'Required credential names are present'
            : `Missing ${missingEnvVars.join(', ')}`,
        action: missingEnvVars.length === 0 ? undefined : 'Open Credentials',
      },
      {
        id: 'permissions',
        label: 'Review permissions',
        status: readAllowed ? 'ready' : 'attention',
        severity: 'required',
        detail: readAllowed
          ? 'Read/tool exposure is available for the connector scope'
          : 'Connector needs read/tool exposure permissions before agents can use it',
        action: readAllowed ? undefined : 'Review permissions',
      },
      {
        id: 'approval-gate',
        label: 'Approval gate',
        status: unsafeWrites ? 'blocked' : 'ready',
        severity: 'required',
        detail:
          definition.writesRequireApproval === true
            ? unsafeWrites
              ? 'Write-capable actions are allowed without explicit approval'
              : 'External write actions stay approval gated'
            : 'No external approval gate required for this connector',
        action: unsafeWrites ? 'Require approval' : undefined,
      },
      {
        id: 'rebuild',
        label: 'Rebuild container',
        status: installed ? 'ready' : 'attention',
        severity: 'advisory',
        detail:
          definition.setupPath === 'built-in'
            ? 'Rebuild only after changing connector code or dependencies'
            : 'Rebuild the agent container after installing or changing this MCP server',
        action: 'Rebuild container',
      },
    ];

    const status = stepStatus(steps);
    return {
      ...definition,
      status,
      installed,
      ready: status === 'ready',
      missingEnvVars,
      approvalRequired,
      steps,
    };
  });

  const summary = summarize(items);
  return {
    status:
      summary.blocked > 0
        ? 'blocked'
        : summary.attention > 0
          ? 'attention'
          : 'ready',
    generatedAt: (input.now || new Date()).toISOString(),
    summary,
    items,
  };
}
