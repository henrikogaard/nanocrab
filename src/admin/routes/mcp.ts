import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { auditLog } from '../security.js';
import { readEnvFile } from '../../env.js';
import {
  loadConnectorPermissions,
  normalizeConnectorPermission,
  saveConnectorPermissions,
  type ConnectorPermission,
} from '../../connector-permissions.js';
import {
  buildInfomaniakWorkflows,
  infomaniakSkillPath,
} from '../../infomaniak-workflows.js';
import {
  buildCalendarWorkflows,
  calendarSkillPath,
  meetingBriefingSkillPath,
} from '../../calendar-workflows.js';
import {
  buildEmailWorkflows,
  emailSkillPath,
  inboxTriageSkillPath,
} from '../../email-workflows.js';
import { buildConnectorCatalog } from '../../connector-catalog.js';

const router = Router();
const PROJECT_ROOT = process.cwd();
const MCP_CONFIG_PATH = path.join(PROJECT_ROOT, 'store', 'mcp-servers.json');

interface McpServerConfig {
  name: string;
  label: string;
  command: string;
  args: string[];
  envVars: string[]; // env var names this server needs
  core?: boolean; // nanocrab is core, can't be removed
  notes?: string; // setup instructions or caveats
}

const MCP_PRESETS: McpServerConfig[] = [
  {
    name: 'infomaniak',
    label: 'Infomaniak kSuite',
    command: 'npx',
    args: ['-y', '@henrikogaard/infomaniak-mcp'],
    envVars: [
      'INFOMANIAK_TOKEN',
      'KDRIVE_ID',
      'MAIL_USER',
      'MAIL_PASSWORD',
      'DAV_USER',
      'DAV_PASSWORD',
    ],
    notes:
      'Optional mail, kDrive, and DAV integration for Infomaniak kSuite. Configure credentials first, then rebuild the agent container.',
  },
];

function loadConfig(): McpServerConfig[] {
  try {
    return JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, 'utf-8'));
  } catch {
    // Default config matching current hardcoded servers
    const defaults: McpServerConfig[] = [
      {
        name: 'nanocrab',
        label: 'NanoCrab IPC',
        command: 'node',
        args: ['<mcp-server-path>'],
        envVars: [],
        core: true,
      },
      {
        name: 'github',
        label: 'GitHub',
        command: 'npx',
        args: ['-y', '@iflow-mcp/server-github'],
        envVars: ['GITHUB_TOKEN'],
      },
    ];
    saveConfig(defaults);
    return defaults;
  }
}

function saveConfig(config: McpServerConfig[]): void {
  fs.mkdirSync(path.dirname(MCP_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function permissionForServer(
  server: McpServerConfig,
  permissions = loadConnectorPermissions(),
): ConnectorPermission {
  const existing = permissions.find(
    (permission) => permission.connectorId === server.name,
  );
  return (
    existing ||
    normalizeConnectorPermission({
      connectorId: server.name,
      scope: server.core ? 'all' : 'main',
      allowedActions: server.core ? ['*'] : ['*.read', 'tools.expose'],
      requiresApproval: !server.core,
      groups: [],
      agents: [],
    })
  );
}

function upsertPermission(
  connectorId: string,
  patch: Partial<ConnectorPermission>,
): ConnectorPermission {
  const permissions = loadConnectorPermissions();
  const idx = permissions.findIndex(
    (permission) => permission.connectorId === connectorId,
  );
  const existing =
    idx >= 0
      ? permissions[idx]
      : normalizeConnectorPermission({
          connectorId,
          scope: 'main',
          allowedActions: ['*.read', 'tools.expose'],
          requiresApproval: true,
          groups: [],
          agents: [],
        });
  const next = normalizeConnectorPermission({
    ...existing,
    ...patch,
    connectorId,
    updatedAt: new Date().toISOString(),
  });
  if (idx >= 0) permissions[idx] = next;
  else permissions.push(next);
  saveConnectorPermissions(permissions);
  return next;
}

function serverStatus(s: McpServerConfig, envVars: Record<string, string>) {
  const envStatus = s.envVars.map((key) => ({
    key,
    isSet: !!(process.env[key] || envVars[key]),
  }));
  const allEnvSet =
    s.envVars.length === 0 || envStatus.every((status) => status.isSet);
  return {
    ...s,
    permission: permissionForServer(s),
    envStatus,
    allEnvSet,
    toolPattern: `mcp__${s.name}__*`,
    agentConfig: 'configured',
    status: allEnvSet ? 'ready' : 'missing-env',
  };
}

function getStatus() {
  const servers = loadConfig();
  const allEnvKeys = [...new Set(servers.flatMap((s) => s.envVars))];
  const envVars = readEnvFile(allEnvKeys);

  const result = servers.map((s) => serverStatus(s, envVars));
  const ready = result.filter((s) => s.status === 'ready').length;
  return {
    servers: result,
    summary: {
      total: result.length,
      ready,
      missingEnv: result.length - ready,
      configPath: MCP_CONFIG_PATH,
      configPresent: fs.existsSync(MCP_CONFIG_PATH),
    },
  };
}

// List all MCP servers with env var status
router.get('/', (_req: Request, res: Response) => {
  res.json(getStatus().servers);
});

router.get('/health', (_req: Request, res: Response) => {
  res.json(getStatus());
});

router.get('/infomaniak-workflows', (_req: Request, res: Response) => {
  const status = getStatus();
  const configured = new Set(loadConfig().map((server) => server.name));
  res.json(
    buildInfomaniakWorkflows({
      servers: status.servers,
      presets: MCP_PRESETS.map((preset) => ({
        name: preset.name,
        installed: configured.has(preset.name),
      })),
      skillPath: infomaniakSkillPath(PROJECT_ROOT),
    }),
  );
});

router.get('/calendar-workflows', (_req: Request, res: Response) => {
  const status = getStatus();
  res.json(
    buildCalendarWorkflows({
      servers: status.servers,
      calendarSkillPath: calendarSkillPath(PROJECT_ROOT),
      meetingSkillPath: meetingBriefingSkillPath(PROJECT_ROOT),
    }),
  );
});

router.get('/email-workflows', (_req: Request, res: Response) => {
  const status = getStatus();
  res.json(
    buildEmailWorkflows({
      servers: status.servers,
      emailSkillPath: emailSkillPath(PROJECT_ROOT),
      inboxTriageSkillPath: inboxTriageSkillPath(PROJECT_ROOT),
    }),
  );
});

router.get('/presets', (_req: Request, res: Response) => {
  const configured = new Set(loadConfig().map((server) => server.name));
  res.json(
    MCP_PRESETS.map((preset) => ({
      ...preset,
      installed: configured.has(preset.name),
      toolPattern: `mcp__${preset.name}__*`,
    })),
  );
});

router.get('/catalog', (_req: Request, res: Response) => {
  const status = getStatus();
  const configured = new Set(loadConfig().map((server) => server.name));
  res.json(
    buildConnectorCatalog({
      servers: status.servers,
      presets: MCP_PRESETS.map((preset) => ({
        name: preset.name,
        installed: configured.has(preset.name),
      })),
    }),
  );
});

router.get('/permissions', (_req: Request, res: Response) => {
  res.json(loadConnectorPermissions());
});

router.put('/permissions/:connectorId', (req: Request, res: Response) => {
  const connectorId = req.params.connectorId as string;
  try {
    const permission = upsertPermission(connectorId, req.body || {});
    auditLog(req, 'connector_permission_updated', connectorId);
    res.json({ ok: true, permission });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.post('/presets/:name/install', (req: Request, res: Response) => {
  const presetName = req.params.name as string;
  const preset = MCP_PRESETS.find((server) => server.name === presetName);
  if (!preset) {
    res.status(404).json({ error: 'Preset not found' });
    return;
  }

  const config = loadConfig();
  if (config.some((server) => server.name === preset.name)) {
    res.status(409).json({ error: `Server "${preset.name}" already exists` });
    return;
  }

  config.push(preset);
  saveConfig(config);
  upsertPermission(preset.name, {
    scope: 'main',
    allowedActions: ['*.read', 'tools.expose'],
    requiresApproval: true,
  });
  auditLog(req, 'mcp_preset_installed', preset.name);
  res.json({
    ok: true,
    name: preset.name,
    message: 'MCP preset installed. Add credentials and rebuild the container.',
  });
});

// Add a new MCP server
router.post('/', (req: Request, res: Response) => {
  const { name, label, command, args, envVars } = req.body;
  if (!name || !command) {
    res.status(400).json({ error: 'Name and command required' });
    return;
  }

  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!safeName || safeName === 'nanocrab') {
    res.status(400).json({ error: 'Invalid server name' });
    return;
  }

  const config = loadConfig();
  if (config.some((s) => s.name === safeName)) {
    res.status(409).json({ error: `Server "${safeName}" already exists` });
    return;
  }

  config.push({
    name: safeName,
    label: label || safeName,
    command,
    args: args || [],
    envVars: envVars || [],
    notes: req.body.notes || undefined,
  });

  saveConfig(config);
  upsertPermission(safeName, {
    scope: req.body.scope,
    allowedActions: req.body.allowedActions || ['*.read', 'tools.expose'],
    requiresApproval: req.body.requiresApproval !== false,
    groups: req.body.groups || [],
    agents: req.body.agents || [],
  });
  auditLog(req, 'mcp_server_added', safeName);
  res.json({
    ok: true,
    name: safeName,
    message:
      'MCP server added. Update agent-runner and rebuild container to activate.',
  });
});

// Update an MCP server
router.put('/:name', (req: Request, res: Response) => {
  const serverName = req.params.name as string;
  const config = loadConfig();
  const idx = config.findIndex((s) => s.name === serverName);

  if (idx === -1) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (config[idx].core) {
    res.status(400).json({ error: 'Cannot modify core server' });
    return;
  }

  const { label, command, args, envVars } = req.body;
  if (label !== undefined) config[idx].label = label;
  if (command !== undefined) config[idx].command = command;
  if (args !== undefined) config[idx].args = args;
  if (envVars !== undefined) config[idx].envVars = envVars;
  if (req.body.notes !== undefined)
    config[idx].notes = req.body.notes || undefined;

  saveConfig(config);
  auditLog(req, 'mcp_server_updated', serverName);
  res.json({ ok: true });
});

// Delete an MCP server
router.delete('/:name', (req: Request, res: Response) => {
  const serverName = req.params.name as string;
  const config = loadConfig();
  const server = config.find((s) => s.name === serverName);

  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  if (server.core) {
    res.status(400).json({ error: 'Cannot delete core server' });
    return;
  }

  const filtered = config.filter((s) => s.name !== serverName);
  saveConfig(filtered);
  auditLog(req, 'mcp_server_deleted', serverName);
  res.json({
    ok: true,
    message: 'Server removed. Rebuild container to apply.',
  });
});

export default router;
