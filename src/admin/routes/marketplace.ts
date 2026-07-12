/**
 * Plugin marketplace — install/uninstall plugins from git URLs.
 * Plugins are cloned into the plugins/ directory (gitignored).
 */
import { Router, Request, Response } from 'express';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { auditLog } from '../security.js';
import { logger } from '../../logger.js';
import { getPluginsDir } from '../plugins/loader.js';

const router = Router();

interface InstalledPlugin {
  name: string;
  dir: string;
  version: string;
  description: string;
  author: string;
  source: string;
  installedAt: string;
}

function getMetaPath(): string {
  return path.join(getPluginsDir(), '.installed.json');
}

function loadInstalled(): InstalledPlugin[] {
  try {
    return JSON.parse(fs.readFileSync(getMetaPath(), 'utf-8'));
  } catch {
    return [];
  }
}

function saveInstalled(plugins: InstalledPlugin[]): void {
  fs.writeFileSync(getMetaPath(), JSON.stringify(plugins, null, 2));
}

// List installed marketplace plugins
router.get('/', (_req: Request, res: Response) => {
  res.json(loadInstalled());
});

// Install a plugin from git URL
router.post('/install', async (req: Request, res: Response) => {
  const { url, name } = req.body;
  if (!url) {
    res.status(400).json({ error: 'Git URL required' });
    return;
  }

  // Derive plugin name from URL if not provided
  const pluginName =
    name || url.split('/').pop()?.replace('.git', '') || 'unknown';
  const pluginDir = path.join(getPluginsDir(), pluginName);

  if (fs.existsSync(pluginDir)) {
    res.status(409).json({ error: `Plugin "${pluginName}" already installed` });
    return;
  }

  try {
    // Clone the repo
    logger.info({ url, pluginName }, 'Installing plugin from git');
    execFileSync('git', ['clone', '--depth', '1', url, pluginDir], {
      stdio: 'pipe',
      timeout: 60000,
    });

    // Install dependencies if package.json exists
    const pkgPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        execFileSync('npm', ['install', '--production'], {
          cwd: pluginDir,
          stdio: 'pipe',
          timeout: 120000,
        });
      } catch (err: any) {
        logger.warn({ err: err.message }, 'npm install failed for plugin');
      }
    }

    // Build if build script exists
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.build) {
        try {
          execFileSync('npm', ['run', 'build'], {
            cwd: pluginDir,
            stdio: 'pipe',
            timeout: 60000,
          });
        } catch {
          // intentional
        }
      }
    }

    // Read plugin metadata
    let meta: any = {};
    const pluginJsonPath = path.join(pluginDir, 'plugin.json');
    if (fs.existsSync(pluginJsonPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
      } catch {
        // intentional
      }
    }

    // Save install record
    const installed = loadInstalled();
    installed.push({
      name: meta.name || pluginName,
      dir: pluginName,
      version: meta.version || '0.0.0',
      description: meta.description || '',
      author: meta.author || '',
      source: url,
      installedAt: new Date().toISOString(),
    });
    saveInstalled(installed);

    auditLog(req, 'plugin_installed', `${pluginName} from ${url}`);
    res.json({
      ok: true,
      name: pluginName,
      note: 'Restart NanoCrab to activate the plugin',
    });
  } catch (err: any) {
    // Clean up on failure
    try {
      fs.rmSync(pluginDir, { recursive: true, force: true });
    } catch {
      // intentional
    }
    logger.error({ err: err.message, url }, 'Plugin install failed');
    res.status(500).json({ error: `Install failed: ${err.message}` });
  }
});

// Uninstall a plugin
router.delete('/:name', (req: Request, res: Response) => {
  const { name } = req.params;
  const pluginDir = path.join(getPluginsDir(), name as string);

  if (!fs.existsSync(pluginDir)) {
    res.status(404).json({ error: 'Plugin not found' });
    return;
  }

  try {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    const installed = loadInstalled().filter((p) => p.dir !== name);
    saveInstalled(installed);
    auditLog(req, 'plugin_uninstalled', name as string);
    res.json({ ok: true, note: 'Restart NanoCrab to fully remove' });
  } catch (err: any) {
    res.status(500).json({ error: `Uninstall failed: ${err.message}` });
  }
});

// Update a plugin (git pull)
router.post('/:name/update', (req: Request, res: Response) => {
  const { name } = req.params;
  const pluginDir = path.join(getPluginsDir(), name as string);

  if (!fs.existsSync(pluginDir)) {
    res.status(404).json({ error: 'Plugin not found' });
    return;
  }

  try {
    execFileSync('git', ['pull', '--ff-only'], {
      cwd: pluginDir,
      stdio: 'pipe',
      timeout: 30000,
    });

    // Rebuild if needed
    const pkgPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.build) {
        execFileSync('npm', ['run', 'build'], {
          cwd: pluginDir,
          stdio: 'pipe',
          timeout: 60000,
        });
      }
    }

    auditLog(req, 'plugin_updated', name as string);
    res.json({ ok: true, note: 'Restart NanoCrab to apply updates' });
  } catch (err: any) {
    res.status(500).json({ error: `Update failed: ${err.message}` });
  }
});

// Serve plugin frontend JS
router.get('/:name/frontend', (req: Request, res: Response) => {
  const { name } = req.params;
  const pluginDir = path.join(getPluginsDir(), name as string);

  // Check marketplace plugins dir
  let frontendPath = path.join(pluginDir, 'frontend.js');
  if (!fs.existsSync(frontendPath)) {
    // Check built-in plugins dir
    frontendPath = path.join(
      process.cwd(),
      'dist',
      'admin',
      'plugins',
      name as string,
      'frontend.js',
    );
  }
  if (!fs.existsSync(frontendPath)) {
    // Check src pages dir as fallback
    frontendPath = path.join(
      process.cwd(),
      'dist',
      'admin',
      'public',
      'pages',
      `${name}.js`,
    );
  }

  if (!fs.existsSync(frontendPath)) {
    res.status(404).json({ error: 'No frontend for this plugin' });
    return;
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(frontendPath);
});

export default router;
