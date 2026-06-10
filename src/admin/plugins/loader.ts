/**
 * Dynamic plugin loader — discovers and loads plugins from:
 *   1. plugins/ directory (marketplace-installed, gitignored)
 *   2. src/admin/plugins/ (optional built-in plugins that may be gitignored)
 *
 * This allows personal/regional plugins to exist locally without being
 * committed to the public repo.
 */
import fs from 'fs';
import path from 'path';
import { registerPlugin, getPlugins } from './registry.js';
import { logger } from '../../logger.js';

const PLUGINS_DIR = path.join(process.cwd(), 'plugins');

async function tryLoadPlugin(dir: string, label: string): Promise<boolean> {
  const distIndex = path.join(dir, 'dist', 'index.js');
  const srcIndex = path.join(dir, 'index.js');
  const tsIndex = path.join(dir, 'index.ts');

  const loadPath = fs.existsSync(distIndex)
    ? distIndex
    : fs.existsSync(srcIndex)
      ? srcIndex
      : fs.existsSync(tsIndex)
        ? tsIndex
        : null;

  if (!loadPath) return false;

  try {
    const mod = await import(`file://${loadPath}`);
    const plugin = mod.default;
    if (!plugin?.id || !plugin?.router) {
      logger.warn(
        { dir: label },
        'Plugin does not export a valid AdminPlugin, skipping',
      );
      return false;
    }

    if (getPlugins().some((p) => p.id === plugin.id)) {
      return false;
    }

    const pluginJsonPath = path.join(dir, 'plugin.json');
    if (fs.existsSync(pluginJsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf-8'));
        if (meta.name) plugin.name = meta.name;
        if (meta.version) plugin.version = meta.version;
        if (meta.description) plugin.description = meta.description;
      } catch (err) {
        logger.debug({ err, dir: label }, 'Failed to read plugin metadata');
      }
    }

    registerPlugin(plugin);
    logger.info({ id: plugin.id, name: plugin.name }, `${label} plugin loaded`);
    return true;
  } catch (err) {
    logger.debug({ err, dir: label }, 'Failed to load optional plugin');
    return false;
  }
}

export async function loadExternalPlugins(): Promise<number> {
  let loaded = 0;

  const builtinDir = path.join(process.cwd(), 'dist', 'admin', 'plugins');
  if (fs.existsSync(builtinDir)) {
    const dirs = fs.readdirSync(builtinDir).filter((d) => {
      const full = path.join(builtinDir, d);
      return fs.statSync(full).isDirectory() && d !== 'node_modules';
    });
    for (const dir of dirs) {
      if (await tryLoadPlugin(path.join(builtinDir, dir), `builtin/${dir}`)) {
        loaded++;
      }
    }
  }

  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  const dirs = fs.readdirSync(PLUGINS_DIR).filter((d) => {
    const full = path.join(PLUGINS_DIR, d);
    return fs.statSync(full).isDirectory();
  });
  for (const dir of dirs) {
    if (
      await tryLoadPlugin(path.join(PLUGINS_DIR, dir), `marketplace/${dir}`)
    ) {
      loaded++;
    }
  }

  return loaded;
}

export function getPluginsDir(): string {
  return PLUGINS_DIR;
}
