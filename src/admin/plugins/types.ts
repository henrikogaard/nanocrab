/**
 * Plugin system types.
 *
 * Plugins are self-contained features that register routes, sidebar items,
 * and startup hooks. They can be enabled/disabled from the dashboard.
 */
import { Router } from 'express';

export interface PluginSidebarItem {
  id: string;
  icon: string;
  label: string;
}

export interface AdminPlugin {
  /** Unique plugin identifier (kebab-case) */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Plugin version */
  version: string;
  /** Sidebar entry — if null, plugin has no page */
  sidebar: PluginSidebarItem | null;
  /** Express router for API routes (mounted at /api/plugins/<id>) */
  router: Router;
  /** Called once on startup after routes are mounted */
  onInit?: () => void | Promise<void>;
  /** Called on shutdown */
  onDestroy?: () => void;
  /** Frontend page ID (must match a render function in app.js) */
  pageId?: string;
}
