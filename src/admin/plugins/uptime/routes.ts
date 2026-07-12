/**
 * Uptime monitoring — health probes for websites and services.
 * Checks URLs on an interval, logs status, alerts via bot when down.
 * Config stored in store/uptime-monitors.json (gitignored).
 */
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../../../config.js';
import { auditLog } from '../../security.js';
import { getState } from '../../state.js';
import { logger } from '../../../logger.js';

const router = Router();
const CONFIG_PATH = path.join(STORE_DIR, 'uptime-monitors.json');
const HISTORY_PATH = path.join(STORE_DIR, 'uptime-history.jsonl');

interface Monitor {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  checkType?: 'http' | 'file-freshness'; // default: http
  filePath?: string; // for file-freshness: local file to check
  maxAgeMinutes?: number; // for file-freshness: alert if older than N minutes
  expectedStatus: number;
  interval: number; // seconds (60, 300, 600, etc.)
  timeout: number; // ms
  headers?: Record<string, string>;
  body?: string;
  expectedBody?: string; // JSON path check, e.g. "ok=true" or "status=ready"
  enabled: boolean;
  alertJid: string; // which channel to alert
  alertAfter: number; // alert after N consecutive failures
  createdAt: string;
  // Runtime state (updated by the checker)
  lastCheck?: string;
  lastStatus?: number;
  lastResponseTime?: number;
  lastError?: string;
  consecutiveFailures: number;
  isDown: boolean;
  lastAlertSent?: string;
}

interface CheckResult {
  monitorId: string;
  timestamp: string;
  status: number | null;
  responseTime: number;
  ok: boolean;
  error?: string;
}

function loadMonitors(): Monitor[] {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveMonitors(monitors: Monitor[]): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(monitors, null, 2));
}

function logCheck(result: CheckResult): void {
  try {
    fs.appendFileSync(HISTORY_PATH, JSON.stringify(result) + '\n');
    // Keep last 5000 lines
    try {
      const content = fs.readFileSync(HISTORY_PATH, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      if (lines.length > 5000) {
        fs.writeFileSync(HISTORY_PATH, lines.slice(-5000).join('\n') + '\n');
      }
    } catch {
      /* ok */
    }
  } catch {
    /* non-fatal */
  }
}

// List all monitors with current status
router.get('/', (_req: Request, res: Response) => {
  res.json(loadMonitors());
});

// Create a monitor
router.post('/', (req: Request, res: Response) => {
  const {
    name,
    url,
    method,
    expectedStatus,
    interval,
    timeout,
    headers,
    body,
    alertJid,
    alertAfter,
    expectedBody,
  } = req.body;
  if (!name || !url) {
    res.status(400).json({ error: 'Name and URL required' });
    return;
  }

  const monitor: Monitor = {
    id: crypto.randomUUID(),
    name,
    url,
    method: method || 'GET',
    expectedStatus: parseInt(expectedStatus) || 200,
    interval: Math.max(30, parseInt(interval) || 300),
    timeout: Math.max(1000, parseInt(timeout) || 10000),
    headers: headers || undefined,
    body: body || undefined,
    expectedBody: expectedBody || undefined,
    enabled: true,
    alertJid: alertJid || '',
    alertAfter: parseInt(alertAfter) || 3,
    createdAt: new Date().toISOString(),
    consecutiveFailures: 0,
    isDown: false,
  };

  const monitors = loadMonitors();
  monitors.push(monitor);
  saveMonitors(monitors);
  auditLog(req, 'monitor_created', `${name}: ${url}`);
  res.json({ ok: true, id: monitor.id });
});

// Update a monitor
router.put('/:id', (req: Request, res: Response) => {
  const monitors = loadMonitors();
  const idx = monitors.findIndex((m) => m.id === (req.params.id as string));
  if (idx === -1) {
    res.status(404).json({ error: 'Monitor not found' });
    return;
  }

  const fields = [
    'name',
    'url',
    'method',
    'expectedStatus',
    'interval',
    'timeout',
    'headers',
    'body',
    'enabled',
    'alertJid',
    'alertAfter',
    'expectedBody',
  ];
  for (const f of fields) {
    if (req.body[f] !== undefined) (monitors[idx] as any)[f] = req.body[f];
  }
  saveMonitors(monitors);
  auditLog(req, 'monitor_updated', monitors[idx].name);
  res.json({ ok: true });
});

// Delete a monitor
router.delete('/:id', (req: Request, res: Response) => {
  const monitors = loadMonitors();
  const monitor = monitors.find((m) => m.id === (req.params.id as string));
  if (!monitor) {
    res.status(404).json({ error: 'Monitor not found' });
    return;
  }
  saveMonitors(monitors.filter((m) => m.id !== monitor.id));
  auditLog(req, 'monitor_deleted', monitor.name);
  res.json({ ok: true });
});

// Get check history for a monitor
router.get('/:id/history', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  try {
    const content = fs.readFileSync(HISTORY_PATH, 'utf-8');
    const lines = content.split('\n').filter(Boolean).reverse();
    const results: CheckResult[] = [];
    for (const line of lines) {
      if (results.length >= limit) break;
      try {
        const r = JSON.parse(line);
        if (r.monitorId === id) results.push(r);
      } catch {
        /* skip */
      }
    }
    res.json(results);
  } catch {
    res.json([]);
  }
});

// Manual check
router.post('/:id/check', async (req: Request, res: Response) => {
  const monitors = loadMonitors();
  const monitor = monitors.find((m) => m.id === (req.params.id as string));
  if (!monitor) {
    res.status(404).json({ error: 'Monitor not found' });
    return;
  }

  const result = await checkMonitor(monitor);
  // Update monitor state
  const idx = monitors.findIndex((m) => m.id === monitor.id);
  monitors[idx] = monitor;
  saveMonitors(monitors);
  res.json(result);
});

// Overall status summary
router.get('/status/summary', (_req: Request, res: Response) => {
  const monitors = loadMonitors();
  const enabled = monitors.filter((m) => m.enabled);
  const up = enabled.filter((m) => !m.isDown);
  const down = enabled.filter((m) => m.isDown);
  res.json({
    total: enabled.length,
    up: up.length,
    down: down.length,
    allUp: down.length === 0,
    monitors: enabled.map((m) => ({
      id: m.id,
      name: m.name,
      url: m.url,
      isDown: m.isDown,
      lastCheck: m.lastCheck,
      lastResponseTime: m.lastResponseTime,
      consecutiveFailures: m.consecutiveFailures,
    })),
  });
});

// --- Health check engine ---

async function checkMonitor(monitor: Monitor): Promise<CheckResult> {
  // File freshness check — verify a local file was recently modified
  if (monitor.checkType === 'file-freshness' && monitor.filePath) {
    const startTime = Date.now();
    try {
      const stat = fs.statSync(monitor.filePath);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
      const maxAge = monitor.maxAgeMinutes || 60;
      const ok = ageMinutes <= maxAge;
      return {
        monitorId: monitor.id,
        timestamp: new Date().toISOString(),
        ok,
        status: ok ? 200 : 0,
        responseTime: Date.now() - startTime,
        error: ok
          ? undefined
          : `File is ${Math.round(ageMinutes)} min old (max ${maxAge})`,
      };
    } catch (_err: any) {
      return {
        monitorId: monitor.id,
        timestamp: new Date().toISOString(),
        ok: false,
        status: 0,
        responseTime: Date.now() - startTime,
        error: `File not found: ${monitor.filePath}`,
      };
    }
  }

  const startTime = Date.now();
  let status: number | null = null;
  let error: string | undefined;
  let ok = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), monitor.timeout);

    const fetchOpts: RequestInit = {
      method: monitor.method,
      signal: controller.signal,
      headers: monitor.headers || {},
      redirect: 'follow',
    };
    if (monitor.body && monitor.method === 'POST') {
      fetchOpts.body = monitor.body;
    }

    const res = await fetch(monitor.url, fetchOpts);
    clearTimeout(timeoutId);
    status = res.status;
    ok = status === monitor.expectedStatus;

    // Body validation (e.g. "ok=true" or "status=ready")
    if (ok && monitor.expectedBody) {
      try {
        const bodyText = await res.text();
        const bodyJson = JSON.parse(bodyText);
        const checks = monitor.expectedBody.split(',').map((c) => c.trim());
        for (const check of checks) {
          const [keyPath, expectedVal] = check.split('=');
          const actualVal = keyPath
            .split('.')
            .reduce((obj: any, key) => obj?.[key], bodyJson);
          if (String(actualVal) !== expectedVal) {
            ok = false;
            error = `Body check failed: ${keyPath}=${actualVal} (expected ${expectedVal})`;
            break;
          }
        }
      } catch {
        ok = false;
        error = 'Body validation failed (invalid JSON)';
      }
    }
  } catch (err: any) {
    error =
      err.name === 'AbortError'
        ? 'Timeout'
        : (err.message || String(err)).slice(0, 200);
  }

  const responseTime = Date.now() - startTime;

  // Update monitor state
  monitor.lastCheck = new Date().toISOString();
  monitor.lastStatus = status ?? undefined;
  monitor.lastResponseTime = responseTime;
  monitor.lastError = error;

  if (ok) {
    if (monitor.isDown) {
      // Recovery — send recovery alert
      monitor.isDown = false;
      monitor.consecutiveFailures = 0;
      await sendAlert(monitor, 'recovered', responseTime);
    } else {
      monitor.consecutiveFailures = 0;
    }
  } else {
    monitor.consecutiveFailures++;
    if (monitor.consecutiveFailures >= monitor.alertAfter && !monitor.isDown) {
      monitor.isDown = true;
      await sendAlert(
        monitor,
        'down',
        responseTime,
        error || `Status ${status}`,
      );
    }
  }

  const result: CheckResult = {
    monitorId: monitor.id,
    timestamp: new Date().toISOString(),
    status,
    responseTime,
    ok,
    error,
  };
  logCheck(result);
  return result;
}

async function sendAlert(
  monitor: Monitor,
  type: 'down' | 'recovered',
  responseTime: number,
  error?: string,
): Promise<void> {
  const jid = monitor.alertJid;
  if (!jid) return;

  const now = new Date().toISOString();
  // Don't spam — max 1 alert per 5 minutes per monitor
  if (monitor.lastAlertSent) {
    const diff = Date.now() - new Date(monitor.lastAlertSent).getTime();
    if (diff < 300000) return;
  }

  try {
    const state = getState();
    if (type === 'down') {
      await state.sendMessage(
        jid,
        `\u26A0 ALERT: ${monitor.name} is DOWN\n` +
          `URL: ${monitor.url}\n` +
          `Error: ${error || 'Unknown'}\n` +
          `Failures: ${monitor.consecutiveFailures}\n` +
          `Response time: ${responseTime}ms`,
      );
    } else {
      await state.sendMessage(
        jid,
        `\u2705 RECOVERED: ${monitor.name} is back UP\n` +
          `URL: ${monitor.url}\n` +
          `Response time: ${responseTime}ms`,
      );
    }
    monitor.lastAlertSent = now;
    logger.info({ monitor: monitor.name, type }, 'Uptime alert sent');
  } catch (err) {
    logger.warn({ err, monitor: monitor.name }, 'Failed to send uptime alert');
  }
}

// --- Periodic checker (called from index.ts) ---

const checkTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function startUptimeChecker(): void {
  const monitors = loadMonitors();
  // Clear old timers
  for (const timer of checkTimers.values()) clearTimeout(timer);
  checkTimers.clear();

  for (const monitor of monitors) {
    if (!monitor.enabled) continue;
    scheduleCheck(monitor);
  }
  logger.info(
    { count: monitors.filter((m) => m.enabled).length },
    'Uptime checker started',
  );
}

function scheduleCheck(monitor: Monitor): void {
  const run = async () => {
    // Reload monitor in case config changed
    const monitors = loadMonitors();
    const current = monitors.find((m) => m.id === monitor.id);
    if (!current || !current.enabled) {
      checkTimers.delete(monitor.id);
      return;
    }

    await checkMonitor(current);

    // Save updated state
    const updated = loadMonitors();
    const idx = updated.findIndex((m) => m.id === current.id);
    if (idx !== -1) {
      updated[idx] = current;
      saveMonitors(updated);
    }

    // Schedule next check
    checkTimers.set(monitor.id, setTimeout(run, current.interval * 1000));
  };

  // First check after a short delay
  checkTimers.set(monitor.id, setTimeout(run, 5000 + Math.random() * 5000));
}

// Reload monitors when config changes (called after create/update/delete)
export function reloadUptimeChecker(): void {
  startUptimeChecker();
}

export default router;
