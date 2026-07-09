import { Router, Request, Response } from 'express';
import { readEnvFile } from '../../env.js';
import { getAllRegisteredGroups } from '../../db.js';
import { updateEnvVar, removeEnvVar } from '../auth.js';
import { auditLog } from '../security.js';

const router = Router();

const CREDENTIAL_KEYS = [
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    mcp: null,
    editable: true,
  },
  {
    key: 'CLAUDE_CODE_OAUTH_TOKEN',
    label: 'Claude OAuth Token',
    mcp: null,
    editable: true,
  },
  {
    key: 'TELEGRAM_BOT_TOKEN',
    label: 'Telegram Bot Token',
    mcp: null,
    editable: true,
  },
  {
    key: 'SIGNAL_PHONE_NUMBER',
    label: 'Signal Phone',
    mcp: null,
    editable: true,
  },
  {
    key: 'SLACK_BOT_TOKEN',
    label: 'Slack Bot Token',
    mcp: null,
    editable: true,
  },
  {
    key: 'SLACK_APP_TOKEN',
    label: 'Slack App Token',
    mcp: null,
    editable: true,
  },
  {
    key: 'DISCORD_BOT_TOKEN',
    label: 'Discord Bot Token',
    mcp: null,
    editable: true,
  },
  { key: 'FAL_KEY', label: 'fal.ai Key', mcp: null, editable: true },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', mcp: null, editable: true },
  {
    key: 'LEONARDO_API_KEY',
    label: 'Leonardo API Key',
    mcp: null,
    editable: true,
  },
  {
    key: 'GITHUB_TOKEN',
    label: 'GitHub Token',
    mcp: 'github',
    editable: true,
  },
  {
    key: 'GITHUB_WEBHOOK_SECRET',
    label: 'GitHub Webhook Secret',
    mcp: null,
    editable: true,
  },
  {
    key: 'GOOGLE_OAUTH_CLIENT_ID',
    label: 'Google OAuth Client ID',
    mcp: 'google-workspace',
    editable: true,
  },
  {
    key: 'GOOGLE_OAUTH_CLIENT_SECRET',
    label: 'Google OAuth Client Secret',
    mcp: 'google-workspace',
    editable: true,
  },
  {
    key: 'GOOGLE_REFRESH_TOKEN',
    label: 'Google Refresh Token',
    mcp: 'google-workspace',
    editable: true,
  },
  {
    key: 'INFOMANIAK_TOKEN',
    label: 'Infomaniak API Token',
    mcp: 'infomaniak',
    editable: true,
  },
  {
    key: 'KDRIVE_ID',
    label: 'Infomaniak kDrive ID',
    mcp: 'infomaniak',
    editable: true,
  },
  {
    key: 'MAIL_USER',
    label: 'Mail Username',
    mcp: 'infomaniak',
    editable: true,
  },
  {
    key: 'MAIL_PASSWORD',
    label: 'Mail Password',
    mcp: 'infomaniak',
    editable: true,
  },
  {
    key: 'DAV_USER',
    label: 'DAV Username',
    mcp: 'infomaniak',
    editable: true,
  },
  {
    key: 'DAV_PASSWORD',
    label: 'DAV Password',
    mcp: 'infomaniak',
    editable: true,
  },
];

const MCP_SERVERS = [
  { name: 'nanocrab', label: 'NanoCrab IPC', alwaysAvailable: true },
  { name: 'github', label: 'GitHub', alwaysAvailable: false },
  {
    name: 'google-workspace',
    label: 'Google Workspace',
    alwaysAvailable: false,
  },
  { name: 'infomaniak', label: 'Infomaniak kSuite', alwaysAvailable: false },
];

router.get('/', (_req: Request, res: Response) => {
  const envVars = readEnvFile(CREDENTIAL_KEYS.map((c) => c.key));

  const credentials = CREDENTIAL_KEYS.map((c) => ({
    key: c.key,
    label: c.label,
    mcp: c.mcp,
    editable: c.editable,
    isSet: !!(process.env[c.key] || envVars[c.key]),
  }));

  const groups = getAllRegisteredGroups();
  const mcpMatrix = Object.entries(groups).map(([jid, group]) => ({
    jid,
    name: group.name,
    folder: group.folder,
    isMain: group.isMain || false,
    allowedMcpServers: group.containerConfig?.allowedMcpServers ?? null,
  }));

  res.json({
    credentials,
    mcpServers: MCP_SERVERS,
    mcpMatrix,
  });
});

// Update a credential
router.put('/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;
  const { value } = req.body;

  const allowed = CREDENTIAL_KEYS.find((c) => c.key === key && c.editable);
  if (!allowed) {
    res.status(400).json({ error: 'Invalid or non-editable key' });
    return;
  }

  if (!value || !value.trim()) {
    res.status(400).json({ error: 'Value required' });
    return;
  }

  updateEnvVar(key, value.trim());
  auditLog(req, 'credential_updated', key);
  res.json({
    ok: true,
    note: 'Restart for channel changes to take effect',
  });
});

// Remove a credential
router.delete('/:key', (req: Request, res: Response) => {
  const key = req.params.key as string;

  const allowed = CREDENTIAL_KEYS.find((c) => c.key === key && c.editable);
  if (!allowed) {
    res.status(400).json({ error: 'Invalid or non-editable key' });
    return;
  }

  removeEnvVar(key);
  auditLog(req, 'credential_removed', key);
  res.json({ ok: true });
});

// Add a custom credential (not in the predefined list)
router.post('/', (req: Request, res: Response) => {
  const { key, value } = req.body;
  if (!key || !value) {
    res.status(400).json({ error: 'Key and value required' });
    return;
  }
  // Sanitize key
  const safeKey = key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  updateEnvVar(safeKey, value.trim());
  auditLog(req, 'credential_created', safeKey);
  res.json({ ok: true, key: safeKey });
});

export default router;
