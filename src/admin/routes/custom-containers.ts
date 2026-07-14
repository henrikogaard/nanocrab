/**
 * Custom container management — run arbitrary Docker containers alongside NanoCrab.
 * Config stored in store/custom-containers.json (gitignored, private to this instance).
 */
import { Router, Request, Response } from 'express';
import {
  execFileSync,
  spawn as _spawn,
  ChildProcess as _ChildProcess,
} from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from '../../config.js';
import { auditLog } from '../security.js';
import { logger } from '../../logger.js';

const router = Router();
const CONFIG_PATH = path.join(STORE_DIR, 'custom-containers.json');

interface ContainerConfig {
  id: string;
  name: string;
  description: string;
  image: string; // Docker image name or 'build:path/to/dir' for local Dockerfile
  buildContext?: string; // Path to directory with Dockerfile (if building locally)
  envVars: Record<string, string>; // Environment variables
  volumes: Array<{ host: string; container: string; readonly?: boolean }>;
  ports: Array<{ host: number; container: number }>;
  command?: string; // Override container command
  autoStart: boolean;
  schedule?: string; // Cron expression for scheduled runs (optional)
  createdAt: string;
}

interface ContainerState {
  id: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  containerId?: string;
  startedAt?: string;
  lastError?: string;
  lastLog?: string;
}

function loadConfig(): ContainerConfig[] {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveConfig(configs: ContainerConfig[]): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
}

function getContainerName(config: ContainerConfig): string {
  return `nanocrab-custom-${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

function getContainerStatus(config: ContainerConfig): ContainerState {
  const containerName = getContainerName(config);
  try {
    const output = execFileSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Status}}|{{.State.StartedAt}}|{{.Id}}',
        containerName,
      ],
      { encoding: 'utf-8', timeout: 5000 },
    ).trim();
    const [status, startedAt, containerId] = output.split('|');
    return {
      id: config.id,
      status: status === 'running' ? 'running' : 'stopped',
      containerId: containerId?.slice(0, 12),
      startedAt,
    };
  } catch {
    return { id: config.id, status: 'stopped' };
  }
}

// List all custom containers with status
router.get('/', (_req: Request, res: Response) => {
  const configs = loadConfig();
  const result = configs.map((c) => ({
    ...c,
    // Mask env var values
    envVars: Object.fromEntries(
      Object.entries(c.envVars).map(([k, v]) => [
        k,
        v.length > 8 ? v.slice(0, 4) + '...' : '***',
      ]),
    ),
    state: getContainerStatus(c),
  }));
  res.json(result);
});

// Get container details (with full env vars — only for editing)
router.get('/:id', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }
  res.json({ ...config, state: getContainerStatus(config) });
});

// Create a custom container config
router.post('/', (req: Request, res: Response) => {
  const {
    name,
    description,
    image,
    buildContext,
    envVars,
    volumes,
    ports,
    command,
    autoStart,
    schedule,
  } = req.body;
  if (!name || (!image && !buildContext)) {
    res
      .status(400)
      .json({ error: 'Name and image (or buildContext) required' });
    return;
  }

  const config: ContainerConfig = {
    id: crypto.randomUUID(),
    name,
    description: description || '',
    image: buildContext
      ? `nanocrab-custom-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
      : image,
    buildContext: buildContext || undefined,
    envVars: envVars || {},
    volumes: volumes || [],
    ports: ports || [],
    command: command || undefined,
    autoStart: !!autoStart,
    schedule: schedule || undefined,
    createdAt: new Date().toISOString(),
  };

  const configs = loadConfig();
  configs.push(config);
  saveConfig(configs);
  auditLog(req, 'custom_container_created', config.name);
  res.json({ ok: true, id: config.id });
});

// Update container config
router.put('/:id', (req: Request, res: Response) => {
  const configs = loadConfig();
  const idx = configs.findIndex((c) => c.id === (req.params.id as string));
  if (idx === -1) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const {
    name,
    description,
    image,
    buildContext,
    envVars,
    volumes,
    ports,
    command,
    autoStart,
    schedule,
  } = req.body;
  if (name !== undefined) configs[idx].name = name;
  if (description !== undefined) configs[idx].description = description;
  if (image !== undefined) configs[idx].image = image;
  if (buildContext !== undefined) configs[idx].buildContext = buildContext;
  if (envVars !== undefined) configs[idx].envVars = envVars;
  if (volumes !== undefined) configs[idx].volumes = volumes;
  if (ports !== undefined) configs[idx].ports = ports;
  if (command !== undefined) configs[idx].command = command;
  if (autoStart !== undefined) configs[idx].autoStart = autoStart;
  if (schedule !== undefined) configs[idx].schedule = schedule;

  saveConfig(configs);
  auditLog(req, 'custom_container_updated', configs[idx].name);
  res.json({ ok: true });
});

// Delete container config (stops it first)
router.delete('/:id', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  // Stop if running
  const containerName = getContainerName(config);
  try {
    execFileSync('docker', ['stop', containerName], {
      timeout: 10000,
      stdio: 'pipe',
    });
    execFileSync('docker', ['rm', containerName], {
      timeout: 5000,
      stdio: 'pipe',
    });
  } catch {
    /* not running */
  }

  saveConfig(configs.filter((c) => c.id !== config.id));
  auditLog(req, 'custom_container_deleted', config.name);
  res.json({ ok: true });
});

// Build container image (for buildContext-based containers)
router.post('/:id/build', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config || !config.buildContext) {
    res.status(400).json({ error: 'No build context configured' });
    return;
  }

  const buildPath = config.buildContext.replace(
    /^~/,
    process.env.HOME || '/root',
  );
  if (!fs.existsSync(buildPath)) {
    res.status(400).json({ error: `Build context not found: ${buildPath}` });
    return;
  }

  auditLog(req, 'custom_container_build', config.name);

  try {
    const output = execFileSync(
      'docker',
      ['build', '-t', config.image, buildPath],
      { encoding: 'utf-8', timeout: 300000 },
    );
    logger.info({ name: config.name }, 'Custom container built');
    res.json({ ok: true, output: output.slice(-500) });
  } catch (err: any) {
    res.status(500).json({
      error: `Build failed: ${(err.stderr || err.message || '').slice(0, 500)}`,
    });
  }
});

// Start container
router.post('/:id/start', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const containerName = getContainerName(config);

  // Stop existing if running
  try {
    execFileSync('docker', ['stop', containerName], {
      timeout: 10000,
      stdio: 'pipe',
    });
    execFileSync('docker', ['rm', containerName], {
      timeout: 5000,
      stdio: 'pipe',
    });
  } catch {
    /* not running */
  }

  // Build docker run args
  const args = [
    'run',
    '-d',
    '--name',
    containerName,
    '--restart',
    'unless-stopped',
  ];

  for (const [key, value] of Object.entries(config.envVars)) {
    args.push('-e', `${key}=${value}`);
  }

  for (const vol of config.volumes) {
    const hostPath = vol.host.replace(/^~/, process.env.HOME || '/root');
    if (vol.readonly) {
      args.push('-v', `${hostPath}:${vol.container}:ro`);
    } else {
      args.push('-v', `${hostPath}:${vol.container}`);
    }
  }

  for (const port of config.ports) {
    args.push('-p', `${port.host}:${port.container}`);
  }

  args.push(config.image);

  if (config.command) {
    args.push(...config.command.split(' '));
  }

  try {
    const containerId = execFileSync('docker', args, {
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();
    auditLog(req, 'custom_container_started', config.name);
    logger.info(
      { name: config.name, containerId: containerId.slice(0, 12) },
      'Custom container started',
    );
    res.json({ ok: true, containerId: containerId.slice(0, 12) });
  } catch (err: any) {
    res.status(500).json({
      error: `Start failed: ${(err.stderr || err.message || '').slice(0, 500)}`,
    });
  }
});

// Stop container
router.post('/:id/stop', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const containerName = getContainerName(config);
  try {
    execFileSync('docker', ['stop', containerName], {
      timeout: 15000,
      stdio: 'pipe',
    });
    execFileSync('docker', ['rm', containerName], {
      timeout: 5000,
      stdio: 'pipe',
    });
    auditLog(req, 'custom_container_stopped', config.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({
      error: `Stop failed: ${(err.stderr || err.message || '').slice(0, 300)}`,
    });
  }
});

// Get container logs
router.get('/:id/logs', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const containerName = getContainerName(config);
  const lines = Math.min(parseInt(req.query.lines as string) || 100, 500);
  try {
    const output = execFileSync(
      'docker',
      ['logs', '--tail', lines.toString(), containerName],
      { encoding: 'utf-8', timeout: 10000 },
    );
    res.json({ logs: output });
  } catch {
    res.json({ logs: 'Container not running or no logs available.' });
  }
});

// Restart container
router.post('/:id/restart', (req: Request, res: Response) => {
  const configs = loadConfig();
  const config = configs.find((c) => c.id === (req.params.id as string));
  if (!config) {
    res.status(404).json({ error: 'Container not found' });
    return;
  }

  const containerName = getContainerName(config);
  try {
    execFileSync('docker', ['restart', containerName], {
      timeout: 30000,
      stdio: 'pipe',
    });
    auditLog(req, 'custom_container_restarted', config.name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({
      error: `Restart failed: ${(err.stderr || err.message || '').slice(0, 300)}`,
    });
  }
});

export default router;
