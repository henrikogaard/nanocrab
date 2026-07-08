import { Router, Request, Response } from 'express';
import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import v8 from 'v8';
import Database from 'better-sqlite3';
import path from 'path';

import {
  STORE_DIR,
  ASSISTANT_NAME,
  DEFAULT_TRIGGER,
  GROUPS_DIR,
  DATA_DIR,
  CONTAINER_IMAGE,
  CREDENTIAL_PROXY_PORT,
} from '../../config.js';
import { readEnvFile, writeEnvValue } from '../../env.js';
import { getState, nonWebGroups } from '../state.js';
import {
  buildChannelStatus,
  isChannelEnabledForRegisteredGroups,
} from '../../channel-status.js';
import { auditLog } from '../security.js';
import { requireRole } from '../middleware.js';
import { logger } from '../../logger.js';
import {
  APP_VERSION,
  EDITION_NAME,
  EDITION_SHORT,
  EDITION_VERSION,
} from '../../edition.js';
import { ensureCodexOAuth, getCodexAuthStatus } from '../../codex-auth.js';
import { runSetupPreflight } from '../../setup-preflight.js';
import { runReleaseDiagnostics } from '../../release-diagnostics.js';
import { CONTAINER_RUNTIME_BIN } from '../../container-runtime.js';
import {
  AGENT_PROVIDER_DEFINITIONS,
  AGENT_PROVIDERS,
  AGENT_PROVIDER_MODELS,
  DEFAULT_AGENT_MODELS,
  getAgentProviderDefinition,
  getAgentProviderConfig,
  getProviderAvailability,
  isAgentProvider,
  isValidAgentModel,
  providerApiKeyEnvKey,
  providerBaseUrlEnvKey,
  writeAgentProviderConfig,
} from '../../agent-provider.js';
import {
  readAgentInstructions,
  writeAgentInstructions,
} from '../../agent-instructions.js';
import {
  getProviderCapabilityMatrix,
  getProviderProbeHistory,
  getProviderPurposeMetadata,
  loadProviderProfiles,
  probeAllProviderProfiles,
  probeProviderProfile,
  ProviderPurpose,
  PROVIDER_PURPOSES,
  runLiveProviderProbe,
  saveProviderProfile,
} from '../../provider-router.js';

const router = Router();
const MAX_AVATAR_BYTES = 1024 * 1024;
const AVATAR_EXTENSIONS = ['jpg', 'png', 'webp'] as const;

export interface AvatarUploadValidation {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: 'jpg' | 'png' | 'webp';
}

export function validateAvatarUpload(buffer: Buffer): AvatarUploadValidation {
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new Error('avatar must be 1 MB or smaller');
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  throw new Error('avatar must be a JPEG, PNG, or WebP image');
}

function normalizeProviderBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function providerUrl(baseUrl: string, pathSuffix: string): string {
  return `${normalizeProviderBaseUrl(baseUrl)}/${pathSuffix.replace(/^\/+/, '')}`;
}

async function fetchProviderModels(
  baseUrl: string,
  apiKey?: string,
): Promise<{ ok: boolean; status?: number; detail: string }> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetch(providerUrl(baseUrl, '/models'), {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: `GET /models returned HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      status: response.status,
      detail: 'GET /models succeeded',
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function getDiskUsage(): {
  total: number;
  used: number;
  free: number;
  percent: number;
} | null {
  try {
    const output = execSync('df -B1 / 2>/dev/null | tail -1', {
      encoding: 'utf-8',
    });
    const parts = output.trim().split(/\s+/);
    if (parts.length >= 4) {
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      const free = parseInt(parts[3], 10);
      return { total, used, free, percent: Math.round((used / total) * 100) };
    }
  } catch {}
  return null;
}

router.get('/', (_req: Request, res: Response) => {
  const state = getState();
  const uptimeMs = Date.now() - state.startTime;

  res.json({
    uptime: uptimeMs,
    uptimeFormatted: formatUptime(uptimeMs),
    startedAt: new Date(state.startTime).toISOString(),
    nodeVersion: process.version,
    version: {
      edition: EDITION_NAME,
      editionShort: EDITION_SHORT,
      editionVersion: EDITION_VERSION,
      appVersion: APP_VERSION,
      containerImage: CONTAINER_IMAGE,
    },
    platform: os.platform(),
    arch: os.arch(),
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
      heapLimit: v8.getHeapStatistics().heap_size_limit,
    },
    system: {
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAvg: os.loadavg(),
      cpus: os.cpus().length,
      disk: getDiskUsage(),
    },
  });
});

// Combined dashboard endpoint — single call instead of 8+ separate ones
router.get('/dashboard', async (_req: Request, res: Response) => {
  const state = getState();
  const uptimeMs = Date.now() - state.startTime;
  const groupsRecord = nonWebGroups(state.registeredGroups());
  const channels = state.channels
    .filter((ch) => isChannelEnabledForRegisteredGroups(ch.name, groupsRecord))
    .map((ch) => buildChannelStatus(ch));
  const containers = state.queue.getActiveContainers();

  const db = new Database(path.join(STORE_DIR, 'messages.db'), {
    readonly: true,
  });
  let messages: any[] = [];
  let todayCount = 0;
  let daily: any[] = [];
  let failedLogins = 0;
  let blockedIps = 0;
  try {
    messages = db
      .prepare(
        `SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, channel, chat_name
       FROM messages ORDER BY timestamp DESC LIMIT 15`,
      )
      .all();
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = db
      .prepare(
        `SELECT COUNT(*) as count FROM messages WHERE date(timestamp) = ?`,
      )
      .get(today) as any;
    todayCount = todayRow?.count || 0;
    daily = db
      .prepare(
        `SELECT date(timestamp) as day, COUNT(*) as count FROM messages
       WHERE timestamp > datetime('now', '-30 days') GROUP BY date(timestamp) ORDER BY day`,
      )
      .all();
    try {
      const audit = db
        .prepare(
          `SELECT action FROM audit_log ORDER BY timestamp DESC LIMIT 50`,
        )
        .all() as any[];
      failedLogins = audit.filter((a) => a.action === 'login_failed').length;
      blockedIps = audit.filter((a) => a.action === 'ip_blocked').length;
    } catch {}
  } catch {
  } finally {
    db.close();
  }

  const groups = Object.values(groupsRecord).map((g: any) => ({
    jid: g.jid,
    name: g.name,
    folder: g.folder,
    channel: g.channel,
    isMain: g.isMain,
    lastActivity: g.lastActivity,
  }));

  res.json({
    uptimeFormatted: formatUptime(uptimeMs),
    channels,
    containers,
    groups,
    messages,
    todayCount,
    daily,
    failedLogins,
    blockedIps,
  });
});

// --- Local Weather (MET Norway) ---

let weatherCache: { data: any; ts: number } | null = null;
const WEATHER_CACHE_MS = 10 * 60 * 1000; // 10 min

router.get('/weather', async (_req: Request, res: Response) => {
  // Return cached if fresh
  if (weatherCache && Date.now() - weatherCache.ts < WEATHER_CACHE_MS) {
    res.json(weatherCache.data);
    return;
  }

  try {
    const env = readEnvFile(['WEATHER_LAT', 'WEATHER_LNG', 'WEATHER_LOCATION']);
    const lat = env.WEATHER_LAT || process.env.WEATHER_LAT || '58.97';
    const lng = env.WEATHER_LNG || process.env.WEATHER_LNG || '5.73';
    const location =
      env.WEATHER_LOCATION || process.env.WEATHER_LOCATION || 'Stavanger';

    const resp = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lng}`,
      {
        headers: { 'User-Agent': 'NanoCrab/1.0' },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!resp.ok) {
      res.json({ error: 'Weather API unavailable' });
      return;
    }

    const json = (await resp.json()) as any;
    const now = json.properties?.timeseries?.[0]?.data;
    if (!now) {
      res.json({ error: 'No weather data' });
      return;
    }

    const inst = now.instant?.details;
    const next1h = now.next_1_hours;

    const dirs = [
      'N',
      'NNE',
      'NE',
      'ENE',
      'E',
      'ESE',
      'SE',
      'SSE',
      'S',
      'SSW',
      'SW',
      'WSW',
      'W',
      'WNW',
      'NW',
      'NNW',
    ];
    const windDir =
      dirs[Math.round((inst?.wind_from_direction || 0) / 22.5) % 16];

    const data = {
      location,
      temperature: inst?.air_temperature ?? 0,
      windSpeed: (inst?.wind_speed ?? 0).toFixed(1),
      windDirection: windDir,
      cloudCover: Math.round(inst?.cloud_area_fraction ?? 0),
      pressure: Math.round(inst?.air_pressure_at_sea_level ?? 0),
      humidity: Math.round(inst?.relative_humidity ?? 0),
      precipitation: next1h?.details?.precipitation_amount ?? 0,
      symbol: next1h?.summary?.symbol_code ?? 'unknown',
    };

    weatherCache = { data, ts: Date.now() };
    res.json(data);
  } catch {
    res.json({ error: 'Weather fetch failed' });
  }
});

router.post('/restart-channel/:name', (req: Request, res: Response) => {
  const channelName = req.params.name as string;
  const state = getState();
  const channel = state.channels.find(
    (ch) => ch.name.toLowerCase() === channelName.toLowerCase(),
  );

  if (!channel) {
    res.status(404).json({ error: `Channel "${channelName}" not found` });
    return;
  }

  auditLog(req, 'channel_restart', channelName);
  logger.info({ channel: channelName }, 'Admin triggered channel restart');

  // Disconnect and reconnect
  channel
    .disconnect()
    .then(() => channel.connect())
    .then(() => {
      logger.info({ channel: channelName }, 'Channel restarted successfully');
    })
    .catch((err) => {
      logger.error({ channel: channelName, err }, 'Channel restart failed');
    });

  res.json({ ok: true, message: `Restarting ${channelName}...` });
});

// Restart NanoCrab service (owner only)
router.post(
  '/restart',
  requireRole('owner'),
  (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Restarting...' });
    logger.info('Admin dashboard triggered restart');
    setTimeout(() => {
      try {
        execSync('systemctl --user restart nanocrab', { timeout: 5000 });
      } catch {
        // Process will be killed by systemd, this is expected
      }
    }, 500);
  },
);

// Channel health check
router.get('/health', (_req: Request, res: Response) => {
  const state = getState();
  const groups = nonWebGroups(state.registeredGroups());
  const health = state.channels
    .filter((ch) => isChannelEnabledForRegisteredGroups(ch.name, groups))
    .map((ch) => buildChannelStatus(ch));

  const allHealthy = health.every((h) => h.connected);
  res.json({
    overall: allHealthy ? 'healthy' : 'degraded',
    channels: health,
    timestamp: new Date().toISOString(),
  });
});

router.get('/setup/preflight', requireRole('owner'), async (_req, res) => {
  try {
    const env = readEnvFile(['ADMIN_PORT', 'CREDENTIAL_PROXY_PORT']);
    const adminPort = Number(process.env.ADMIN_PORT || env.ADMIN_PORT || 9744);
    const proxyPort = Number(
      process.env.CREDENTIAL_PROXY_PORT ||
        env.CREDENTIAL_PROXY_PORT ||
        CREDENTIAL_PROXY_PORT,
    );
    const result = await runSetupPreflight({
      dryRun: true,
      occupiedPortsOk: [adminPort, proxyPort],
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Setup preflight failed');
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/release-diagnostics', requireRole('owner'), async (_req, res) => {
  try {
    res.json(await runReleaseDiagnostics());
  } catch (err) {
    logger.error({ err }, 'Release diagnostics failed');
    res.status(500).json({ error: 'Release diagnostics failed' });
  }
});

// Usage stats
router.get('/stats', (_req: Request, res: Response) => {
  const db = new Database(path.join(STORE_DIR, 'messages.db'), {
    readonly: true,
  });
  try {
    // Messages per day (last 30 days)
    const daily = db
      .prepare(
        `SELECT date(timestamp) as day, COUNT(*) as count,
                SUM(CASE WHEN is_bot_message = 1 OR is_from_me = 1 THEN 1 ELSE 0 END) as bot_count,
                SUM(CASE WHEN is_bot_message = 0 AND is_from_me = 0 THEN 1 ELSE 0 END) as user_count
         FROM messages
         WHERE timestamp > datetime('now', '-30 days')
         GROUP BY date(timestamp)
         ORDER BY day`,
      )
      .all();

    // Messages per channel
    const byChannel = db
      .prepare(
        `SELECT c.channel, COUNT(*) as count
         FROM messages m
         JOIN chats c ON m.chat_jid = c.jid
         WHERE m.timestamp > datetime('now', '-30 days') AND c.channel IS NOT NULL
         GROUP BY c.channel`,
      )
      .all();

    // Total counts
    const totals = db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN is_bot_message = 1 OR is_from_me = 1 THEN 1 ELSE 0 END) as bot,
                SUM(CASE WHEN is_bot_message = 0 AND is_from_me = 0 THEN 1 ELSE 0 END) as user
         FROM messages`,
      )
      .get() as { total: number; bot: number; user: number };

    res.json({ daily, byChannel, totals });
  } finally {
    db.close();
  }
});

// Upload avatar
router.post('/avatar', async (req: Request, res: Response) => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let rejected = false;
  req.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_AVATAR_BYTES) {
      rejected = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (rejected) {
      if (!res.headersSent) {
        res
          .status(413)
          .json({ ok: false, error: 'avatar must be 1 MB or smaller' });
      }
      return;
    }
    const buffer = Buffer.concat(chunks);
    let avatar: AvatarUploadValidation;
    try {
      avatar = validateAvatarUpload(buffer);
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'invalid avatar',
      });
      return;
    }
    const projectRoot = process.cwd();
    const avatarDir = path.join(projectRoot, 'site', 'static');
    fs.mkdirSync(avatarDir, { recursive: true });
    fs.writeFileSync(
      path.join(avatarDir, `avatar.${avatar.extension}`),
      buffer,
    );
    for (const extension of AVATAR_EXTENSIONS) {
      if (extension !== avatar.extension) {
        fs.rmSync(path.join(avatarDir, `avatar.${extension}`), { force: true });
      }
    }
    // Also save to admin public for dashboard use
    const adminStatic = path.join(
      projectRoot,
      'src',
      'admin',
      'public',
      'static',
    );
    fs.mkdirSync(adminStatic, { recursive: true });
    fs.writeFileSync(
      path.join(adminStatic, `avatar.${avatar.extension}`),
      buffer,
    );
    for (const extension of AVATAR_EXTENSIONS) {
      if (extension !== avatar.extension) {
        fs.rmSync(path.join(adminStatic, `avatar.${extension}`), {
          force: true,
        });
      }
    }
    // Copy to dist too
    const distStatic = path.join(
      projectRoot,
      'dist',
      'admin',
      'public',
      'static',
    );
    fs.mkdirSync(distStatic, { recursive: true });
    fs.writeFileSync(
      path.join(distStatic, `avatar.${avatar.extension}`),
      buffer,
    );
    for (const extension of AVATAR_EXTENSIONS) {
      if (extension !== avatar.extension) {
        fs.rmSync(path.join(distStatic, `avatar.${extension}`), {
          force: true,
        });
      }
    }
    res.json({
      ok: true,
      contentType: avatar.contentType,
      url: `/static/avatar.${avatar.extension}`,
    });
  });
});

// Alerts
// Budget management
const BUDGET_PATH = path.join(STORE_DIR, 'budget.json');

router.get('/budget', (_req: Request, res: Response) => {
  try {
    res.json(JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf-8')));
  } catch {
    res.json({ dailyLimit: 0, monthlyLimit: 0 });
  }
});

router.put('/budget', (req: Request, res: Response) => {
  const { dailyLimit, monthlyLimit } = req.body;
  const budget = {
    dailyLimit: parseFloat(dailyLimit) || 0,
    monthlyLimit: parseFloat(monthlyLimit) || 0,
  };
  fs.writeFileSync(BUDGET_PATH, JSON.stringify(budget, null, 2));
  auditLog(
    req,
    'budget_updated',
    `daily: $${budget.dailyLimit}, monthly: $${budget.monthlyLimit}`,
  );
  res.json({ ok: true });
});

router.get('/alerts', async (_req: Request, res: Response) => {
  const alerts: Array<{ type: string; message: string }> = [];
  const state = getState();
  const groups = nonWebGroups(state.registeredGroups());

  // Check offline channels
  for (const ch of state.channels) {
    if (!isChannelEnabledForRegisteredGroups(ch.name, groups)) continue;
    if (!ch.isConnected()) {
      alerts.push({
        type: 'error',
        message: `Channel "${ch.name}" is offline`,
      });
    }
  }

  // Check recent task failures
  try {
    const db = new Database(path.join(STORE_DIR, 'messages.db'), {
      readonly: true,
    });
    try {
      const failures = db
        .prepare(
          `SELECT COUNT(*) as count FROM task_run_logs
           WHERE status = 'error' AND started_at > datetime('now', '-24 hours')`,
        )
        .get() as { count: number } | undefined;
      if (failures && failures.count > 0) {
        alerts.push({
          type: 'warning',
          message: `${failures.count} failed task${failures.count > 1 ? 's' : ''} in the last 24 hours`,
        });
      }
    } catch {
      // table may not exist
    } finally {
      db.close();
    }
  } catch {
    // db not available
  }

  // Check error log recency
  try {
    const projectRoot = process.cwd();
    const errorLog = path.join(projectRoot, 'logs', 'error.log');
    if (fs.existsSync(errorLog)) {
      const stat = fs.statSync(errorLog);
      const lastModified = stat.mtimeMs;
      const oneHourAgo = Date.now() - 3600000;
      if (lastModified > oneHourAgo && stat.size > 0) {
        alerts.push({
          type: 'warning',
          message: 'Error log has recent entries (last hour)',
        });
      }
    }
  } catch {
    // log file not accessible
  }

  res.json(alerts);
});

// Agent identity
// --- Default Agent Provider ---

router.get('/provider', (_req: Request, res: Response) => {
  const { provider, model, modelsByProvider, baseUrlsByProvider } =
    getAgentProviderConfig();
  const codexAuth = getCodexAuthStatus();
  res.json({
    provider,
    model,
    modelsByProvider,
    baseUrlsByProvider,
    models: AGENT_PROVIDER_MODELS,
    defaults: DEFAULT_AGENT_MODELS,
    definitions: AGENT_PROVIDER_DEFINITIONS,
    available: getProviderAvailability(),
    profiles: loadProviderProfiles(),
    purposes: getProviderPurposeMetadata(),
    capabilityMatrix: getProviderCapabilityMatrix(),
    profileProbes: probeAllProviderProfiles(),
    probeHistory: getProviderProbeHistory(undefined, undefined, 100),
    auth: { codex: codexAuth },
  });
});

router.put('/provider', (req: Request, res: Response) => {
  const { provider, model, baseUrl, restartActive } = req.body;
  if (!isAgentProvider(provider)) {
    res.status(400).json({
      error: `provider must be one of: ${AGENT_PROVIDERS.join(', ')}`,
    });
    return;
  }
  const current = getAgentProviderConfig();
  const selectedModel =
    model ||
    current.modelsByProvider[provider] ||
    DEFAULT_AGENT_MODELS[provider];
  if (!isValidAgentModel(provider, selectedModel)) {
    res.status(400).json({
      error: `model is not valid for ${provider}`,
      models: AGENT_PROVIDER_MODELS[provider],
    });
    return;
  }
  const selectedBaseUrl =
    typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined;
  let codexAuth;
  if (provider === 'codex') {
    codexAuth = ensureCodexOAuth();
    if (!codexAuth.configured) {
      res.status(400).json({
        error: `Codex OAuth is not configured. Run codex login --device-auth with CODEX_HOME=${codexAuth.persistedDir}, or authenticate on the host and switch again to import it.`,
        auth: { codex: codexAuth },
      });
      return;
    }
  }
  writeAgentProviderConfig(provider, selectedModel, selectedBaseUrl);
  const closedContainers = restartActive
    ? getState().queue.closeActiveContainers('provider-switch')
    : 0;
  auditLog(req, 'provider_changed', `${provider}/${selectedModel}`);
  res.json({
    ok: true,
    provider,
    model: selectedModel,
    baseUrl: selectedBaseUrl,
    closedContainers,
    note:
      closedContainers > 0
        ? 'Active agent sessions are closing and will use this provider on restart'
        : 'New agent sessions will use this provider',
    auth: codexAuth ? { codex: codexAuth } : undefined,
  });
});

router.get('/provider/profiles', (_req: Request, res: Response) => {
  res.json({
    profiles: loadProviderProfiles(),
    purposes: getProviderPurposeMetadata(),
    capabilityMatrix: getProviderCapabilityMatrix(),
    models: AGENT_PROVIDER_MODELS,
    definitions: AGENT_PROVIDER_DEFINITIONS,
    probes: probeAllProviderProfiles(),
  });
});

router.put(
  '/provider/profiles/:id',
  requireRole('owner'),
  (req: Request, res: Response) => {
    const id = req.params.id as ProviderPurpose;
    if (!PROVIDER_PURPOSES.includes(id)) {
      res.status(400).json({
        error: `profile id must be one of: ${PROVIDER_PURPOSES.join(', ')}`,
      });
      return;
    }
    const { provider, model, baseUrl, temperature, maxOutputTokens } = req.body;
    const toolPolicy = req.body.toolPolicy || req.body.tool_policy;
    const fallbackProfileId =
      req.body.fallbackProfileId || req.body.fallback_profile_id || null;
    if (!isAgentProvider(provider)) {
      res.status(400).json({
        error: `provider must be one of: ${AGENT_PROVIDERS.join(', ')}`,
      });
      return;
    }
    const selectedModel =
      typeof model === 'string' && model.trim()
        ? model.trim()
        : DEFAULT_AGENT_MODELS[provider];
    if (!isValidAgentModel(provider, selectedModel)) {
      res.status(400).json({
        error: `model is not valid for ${provider}`,
        models: AGENT_PROVIDER_MODELS[provider],
      });
      return;
    }

    try {
      const profile = saveProviderProfile({
        id,
        purpose: id,
        provider,
        model: selectedModel,
        baseUrl:
          typeof baseUrl === 'string' && baseUrl.trim()
            ? baseUrl.trim()
            : undefined,
        temperature: typeof temperature === 'number' ? temperature : undefined,
        maxOutputTokens:
          typeof maxOutputTokens === 'number' ? maxOutputTokens : undefined,
        toolPolicy: toolPolicy || 'approval-required',
        fallbackProfileId: fallbackProfileId || null,
      });
      auditLog(
        req,
        'provider_profile_updated',
        `${profile.id} -> ${profile.provider}/${profile.model}`,
      );
      res.json({ ok: true, profile, probe: probeProviderProfile(profile) });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.get(
  '/provider/profiles/:id/probe',
  async (req: Request, res: Response) => {
    const id = req.params.id as ProviderPurpose;
    if (!PROVIDER_PURPOSES.includes(id)) {
      res.status(400).json({
        error: `profile id must be one of: ${PROVIDER_PURPOSES.join(', ')}`,
      });
      return;
    }
    const profile = loadProviderProfiles().find((item) => item.id === id);
    if (!profile) {
      res.status(404).json({ error: 'profile not found' });
      return;
    }
    try {
      const probe = await runLiveProviderProbe(profile);
      res.json(probe);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

router.get(
  '/provider/preflight/:provider',
  async (req: Request, res: Response) => {
    const provider = req.params.provider;
    if (!isAgentProvider(provider)) {
      res.status(400).json({
        error: `provider must be one of: ${AGENT_PROVIDERS.join(', ')}`,
      });
      return;
    }
    const definition = getAgentProviderDefinition(provider);
    const config = getAgentProviderConfig();

    const checks: Array<{
      id: string;
      label: string;
      ok: boolean;
      detail?: string;
    }> = [];

    if (provider === 'claude') {
      checks.push({
        id: 'runtime',
        label: 'Claude Agent SDK',
        ok: true,
        detail: 'Bundled in the agent container',
      });
    }

    if (definition.requiresCli) {
      let hostInstalled = false;
      try {
        execFileSync('which', [definition.requiresCli], { stdio: 'pipe' });
        hostInstalled = true;
      } catch {
        hostInstalled = false;
      }
      checks.push({
        id: `host-${definition.requiresCli}`,
        label: `Host ${definition.name}`,
        ok: hostInstalled,
        detail: hostInstalled
          ? `${definition.requiresCli} found on host`
          : `${definition.requiresCli} not found on host`,
      });
    }

    if (provider === 'codex') {
      const codexAuth = getCodexAuthStatus();
      checks.push({
        id: 'codex-auth',
        label: 'Container Codex OAuth',
        ok: codexAuth.configured,
        detail: codexAuth.configured
          ? `auth.json found in ${codexAuth.persistedDir}`
          : `Run CODEX_HOME=${codexAuth.persistedDir} codex login --device-auth`,
      });

      try {
        execFileSync(
          CONTAINER_RUNTIME_BIN,
          [
            'run',
            '--rm',
            '-v',
            `${DATA_DIR}/codex:/home/node/.codex`,
            '--entrypoint',
            'codex',
            CONTAINER_IMAGE,
            '--version',
          ],
          { stdio: 'pipe', timeout: 15000 },
        );
        checks.push({
          id: 'container-codex',
          label: 'Container Codex CLI',
          ok: true,
          detail: `${CONTAINER_IMAGE} can execute codex`,
        });
      } catch (err) {
        checks.push({
          id: 'container-codex',
          label: 'Container Codex CLI',
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (provider === 'opencode') {
      checks.push({
        id: 'opencode-auth',
        label: 'OpenCode auth/config',
        ok: true,
        detail:
          'Uses OpenCode auth.json, OPENCODE_CONFIG_CONTENT, or provider env vars inside the container',
      });
    }

    if (definition.runtime === 'openai-compatible') {
      const baseUrl =
        config.baseUrlsByProvider[provider] || definition.defaultBaseUrl || '';
      checks.push({
        id: 'base-url',
        label: `${definition.name} base URL`,
        ok: Boolean(baseUrl),
        detail: baseUrl || 'No base URL configured',
      });

      const envKey = providerApiKeyEnvKey(provider);
      const envFileValues = envKey ? readEnvFile([envKey]) : {};
      const apiKey = envKey ? process.env[envKey] || envFileValues[envKey] : '';
      if (envKey && definition.requiresAuth !== false) {
        checks.push({
          id: 'api-key',
          label: `${definition.name} API key`,
          ok: Boolean(apiKey),
          detail: apiKey
            ? `${envKey} is configured`
            : `Set ${envKey} in the environment or .env`,
        });
      }

      if (
        baseUrl &&
        (provider === 'ollama' || apiKey || definition.requiresAuth === false)
      ) {
        const modelsCheck = await fetchProviderModels(baseUrl, apiKey);
        checks.push({
          id: 'models-endpoint',
          label: `${definition.name} models endpoint`,
          ok: modelsCheck.ok,
          detail: modelsCheck.detail,
        });
      }

      const configuredKey = providerBaseUrlEnvKey(provider);
      checks.push({
        id: 'config-key',
        label: 'Config key',
        ok: true,
        detail: `Override with ${configuredKey}${definition.baseUrlEnvKey ? ` or ${definition.baseUrlEnvKey}` : ''}`,
      });
    }

    const ok = checks.every((c) => c.ok);
    res.json({ provider, ok, checks });
  },
);

router.get('/identity', (_req: Request, res: Response) => {
  res.json({
    name: ASSISTANT_NAME,
    trigger: DEFAULT_TRIGGER,
    edition: EDITION_NAME,
    editionShort: EDITION_SHORT,
    editionVersion: EDITION_VERSION,
    appVersion: APP_VERSION,
    nanocrabVersion: APP_VERSION,
    projectRoot: process.cwd(),
  });
});

router.put('/identity', (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  const newName = name.trim();
  const oldName = ASSISTANT_NAME;

  try {
    // Update .env
    writeEnvValue('ASSISTANT_NAME', newName);

    // Update groups/*/AGENTS.md — replace old name with new name
    if (fs.existsSync(GROUPS_DIR)) {
      const groups = fs.readdirSync(GROUPS_DIR).filter((d) => {
        try {
          return fs.statSync(path.join(GROUPS_DIR, d)).isDirectory();
        } catch {
          return false;
        }
      });

      for (const group of groups) {
        const groupDir = path.join(GROUPS_DIR, group);
        let content = readAgentInstructions(groupDir);
        if (content.includes(oldName)) {
          content = content.replace(
            new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
            newName,
          );
          writeAgentInstructions(groupDir, content);
        }
      }
    }

    auditLog(
      req,
      'identity_changed',
      `Renamed from "${oldName}" to "${newName}"`,
    );
    res.json({
      ok: true,
      message: `Agent renamed to "${newName}". Restart required for full effect.`,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to update agent identity');
    res.status(500).json({ error: 'Failed to update identity' });
  }
});

// Unregistered conversations — chats not in registered_groups
router.get('/unregistered', (_req: Request, res: Response) => {
  const db = new Database(path.join(STORE_DIR, 'messages.db'), {
    readonly: true,
  });
  try {
    const rows = db
      .prepare(
        `SELECT c.jid, c.name, c.channel, c.last_message_time, c.is_group
         FROM chats c
         LEFT JOIN registered_groups r ON c.jid = r.jid
         WHERE r.jid IS NULL
         ORDER BY c.last_message_time DESC`,
      )
      .all() as Array<{
      jid: string;
      name: string | null;
      channel: string | null;
      last_message_time: string | null;
      is_group: number;
    }>;

    // Also fetch recent messages from unregistered chats
    const unregJids = rows
      .map((r) => r.jid)
      .filter((j) => j !== '__group_sync__');
    let messages: Array<{
      chat_jid: string;
      sender_name: string;
      content: string;
      timestamp: string;
    }> = [];
    if (unregJids.length > 0) {
      const placeholders = unregJids.map(() => '?').join(',');
      messages = db
        .prepare(
          `SELECT chat_jid, sender_name, content, timestamp FROM messages
           WHERE chat_jid IN (${placeholders})
           ORDER BY timestamp DESC LIMIT 50`,
        )
        .all(...unregJids) as typeof messages;
    }

    res.json({
      chats: rows
        .filter((r) => r.jid !== '__group_sync__')
        .map((r) => ({
          jid: r.jid,
          name: r.name || r.jid,
          channel: r.channel || 'unknown',
          lastActivity: r.last_message_time,
          isGroup: !!r.is_group,
        })),
      messages,
    });
  } catch {
    res.json([]);
  } finally {
    db.close();
  }
});

// --- Scheduled Reports Config ---

const REPORT_CONFIG_PATH = path.join(STORE_DIR, 'report-config.json');

interface ReportConfig {
  enabled: boolean;
  schedule: string;
  targetJid: string;
  providerProfileId: ProviderPurpose;
  requireOutlineApproval: boolean;
  outputFormats: string[];
  sourceScopes: string[];
  deliverablesDir: string;
}

function loadReportConfig(): ReportConfig {
  try {
    return {
      enabled: false,
      schedule: 'weekly',
      targetJid: '',
      providerProfileId: 'default_reports',
      requireOutlineApproval: true,
      outputFormats: ['markdown'],
      sourceScopes: ['journal', 'memory'],
      deliverablesDir: 'store/deliverables',
      ...JSON.parse(fs.readFileSync(REPORT_CONFIG_PATH, 'utf-8')),
    };
  } catch {
    return {
      enabled: false,
      schedule: 'weekly',
      targetJid: '',
      providerProfileId: 'default_reports',
      requireOutlineApproval: true,
      outputFormats: ['markdown'],
      sourceScopes: ['journal', 'memory'],
      deliverablesDir: 'store/deliverables',
    };
  }
}

router.get('/report-config', (_req: Request, res: Response) => {
  res.json(loadReportConfig());
});

router.put('/report-config', (req: Request, res: Response) => {
  const {
    enabled,
    schedule,
    targetJid,
    providerProfileId,
    requireOutlineApproval,
    outputFormats,
    sourceScopes,
    deliverablesDir,
  } = req.body;
  const config: ReportConfig = {
    enabled: !!enabled,
    schedule: schedule === 'daily' ? 'daily' : 'weekly',
    targetJid: typeof targetJid === 'string' ? targetJid.trim() : '',
    providerProfileId:
      typeof providerProfileId === 'string' &&
      PROVIDER_PURPOSES.includes(providerProfileId as ProviderPurpose)
        ? (providerProfileId as ProviderPurpose)
        : 'default_reports',
    requireOutlineApproval: requireOutlineApproval !== false,
    outputFormats: Array.isArray(outputFormats)
      ? outputFormats
          .map((format) => String(format).trim().toLowerCase())
          .filter((format) =>
            ['markdown', 'docx', 'pdf', 'html'].includes(format),
          )
      : ['markdown'],
    sourceScopes: Array.isArray(sourceScopes)
      ? sourceScopes
          .map((scope) => String(scope).trim().toLowerCase())
          .filter((scope) =>
            ['journal', 'memory', 'github', 'wiki', 'kdrive', 'web'].includes(
              scope,
            ),
          )
      : ['journal', 'memory'],
    deliverablesDir:
      typeof deliverablesDir === 'string' && deliverablesDir.trim()
        ? deliverablesDir.trim()
        : 'store/deliverables',
  };
  if (config.outputFormats.length === 0) config.outputFormats = ['markdown'];
  if (config.sourceScopes.length === 0) config.sourceScopes = ['journal'];
  fs.mkdirSync(path.dirname(REPORT_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(REPORT_CONFIG_PATH, JSON.stringify(config, null, 2));
  auditLog(
    req,
    'report_config_updated',
    `enabled: ${config.enabled}, schedule: ${config.schedule}`,
  );
  res.json({ ok: true });
});

function formatUptime(ms: number): string {
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export default router;
