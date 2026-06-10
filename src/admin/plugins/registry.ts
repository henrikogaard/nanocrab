/**
 * Plugin registry — discovers, loads, and manages plugins.
 *
 * Plugins are stored in src/admin/plugins/<name>/index.ts.
 * Enable/disable state persisted in store/plugins.json.
 */
import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';

import { STORE_DIR } from '../../config.js';
import { logger } from '../../logger.js';
import { AdminPlugin } from './types.js';

const PLUGINS_STATE_PATH = path.join(STORE_DIR, 'plugins.json');

interface PluginState {
  [pluginId: string]: { enabled: boolean };
}

const plugins = new Map<string, AdminPlugin>();

function loadState(): PluginState {
  try {
    return JSON.parse(fs.readFileSync(PLUGINS_STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state: PluginState): void {
  fs.mkdirSync(path.dirname(PLUGINS_STATE_PATH), { recursive: true });
  fs.writeFileSync(PLUGINS_STATE_PATH, JSON.stringify(state, null, 2));
}

export function registerPlugin(plugin: AdminPlugin): void {
  if (plugins.has(plugin.id)) {
    logger.warn({ id: plugin.id }, 'Plugin already registered, skipping');
    return;
  }

  const state = loadState();
  // Default to enabled for new plugins
  if (state[plugin.id] === undefined) {
    state[plugin.id] = { enabled: true };
    saveState(state);
  }

  plugins.set(plugin.id, plugin);
  logger.info({ id: plugin.id, name: plugin.name }, 'Plugin registered');
}

export function getPlugins(): AdminPlugin[] {
  return Array.from(plugins.values());
}

export function getEnabledPlugins(): AdminPlugin[] {
  const state = loadState();
  return Array.from(plugins.values()).filter(
    (p) => state[p.id]?.enabled !== false,
  );
}

export function isPluginEnabled(id: string): boolean {
  const state = loadState();
  return state[id]?.enabled !== false;
}

export function setPluginEnabled(id: string, enabled: boolean): boolean {
  if (!plugins.has(id)) return false;
  const state = loadState();
  state[id] = { enabled };
  saveState(state);
  return true;
}

/** Mount all enabled plugin routes under /api/<id> (preserves existing API paths) */
export function mountPlugins(parentRouter: Router): void {
  const state = loadState();
  for (const plugin of plugins.values()) {
    if (state[plugin.id]?.enabled === false) continue;
    parentRouter.use(`/${plugin.id}`, plugin.router);
    logger.debug({ id: plugin.id }, 'Plugin routes mounted');
  }
}

/** Run onInit for all enabled plugins */
export async function initPlugins(): Promise<void> {
  const state = loadState();
  for (const plugin of plugins.values()) {
    if (state[plugin.id]?.enabled === false) continue;
    if (plugin.onInit) {
      try {
        await plugin.onInit();
        logger.info({ id: plugin.id }, 'Plugin initialized');
      } catch (err) {
        logger.error({ err, id: plugin.id }, 'Plugin init failed');
      }
    }
  }
}

/** API routes for managing plugins */
export function pluginManagementRouter(): Router {
  const router = Router();

  // List all plugins with their state
  router.get('/', (_req: Request, res: Response) => {
    const state = loadState();
    const list = Array.from(plugins.values()).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      enabled: state[p.id]?.enabled !== false,
      sidebar: p.sidebar,
      pageId: p.pageId,
    }));
    res.json(list);
  });

  // Enable/disable a plugin
  router.put('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) required' });
      return;
    }
    if (!setPluginEnabled(id as string, enabled)) {
      res.status(404).json({ error: 'Plugin not found' });
      return;
    }
    res.json({
      ok: true,
      note: 'Restart required for route changes to take effect',
    });
  });

  return router;
}
