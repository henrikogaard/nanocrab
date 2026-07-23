/**
 * Admin dashboard Express server.
 * Runs in the same process as NanoCrab, bound to 0.0.0.0.
 *
 * Security layers:
 *   1. Upstream firewall (IP restriction on port 9743)
 *   2. Caddy reverse proxy (TLS termination)
 *   3. IP allowlist (application-level, optional)
 *   4. Rate limiting (login attempts)
 *   5. Security headers (CSP, HSTS, X-Frame-Options)
 *   6. Session auth (bcrypt + HttpOnly cookies)
 *   7. Audit logging (all admin actions)
 */
import { createServer } from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import Database from 'better-sqlite3';

import { STORE_DIR, SESSIONS_DIR } from '../config.js';
import { logger } from '../logger.js';
import {
  buildChannelStatus,
  isChannelEnabledForRegisteredGroups,
} from '../channel-status.js';
import { NanoCrabState, setState, getState, nonWebGroups } from './state.js';
import { initAuth } from './auth.js';
import { requireAuth, requireRole } from './middleware.js';
import { initWebSocket } from './websocket.js';
import {
  securityHeaders,
  ipAllowlist,
  apiRateLimit,
  initRateLimiter,
} from './security.js';
import { checkAutoBackup } from './routes/backup.js';

// Core routes (always loaded)
import authRoutes from './routes/auth.js';
import channelsRoutes from './routes/channels.js';
import groupsRoutes from './routes/groups.js';
import messagesRoutes from './routes/messages.js';
import containersRoutes from './routes/containers.js';
import tasksRoutes from './routes/tasks.js';
import credentialsRoutes from './routes/credentials.js';
import logsRoutes from './routes/logs.js';
import systemRoutes from './routes/system.js';
import skillsRoutes from './routes/skills.js';
import dockerRoutes from './routes/docker.js';
import filesRoutes from './routes/files.js';
import mcpRoutes from './routes/mcp.js';
import providersRoutes from './routes/providers.js';
import memoryRoutes from './routes/memory.js';
import journalRoutes from './routes/journal.js';
import reportsRoutes from './routes/reports.js';
import artifactsRoutes from './routes/artifacts.js';
import missionsRoutes from './routes/missions.js';
import briefingsRoutes from './routes/briefings.js';
import briefingAnalyticsRoutes from './routes/briefing-analytics.js';
import researchRoutes from './routes/research.js';
import usageRoutes from './routes/usage.js';
import sessionsRoutes from './routes/sessions.js';
import mountsRoutes from './routes/mounts.js';
import webhooksRoutes, { handleGithubWebhook } from './routes/webhooks.js';
import backupRoutes from './routes/backup.js';
import customContainersRoutes from './routes/custom-containers.js';
import tokensRoutes from './routes/tokens.js';
import agentsRoutes from './routes/agents.js';
import agentProfilesRoutes from './routes/agent-profiles.js';
import marketplaceRoutes from './routes/marketplace.js';
import pushRoutes from './routes/push.js';
import { loadExternalPlugins } from './plugins/loader.js';
import agentMessagesRoutes, {
  initAgentMessagesDb,
} from './routes/agent-messages.js';
import questionsRoutes, { initQuestionsDb } from './routes/questions.js';
import approvalsRoutes from './routes/approvals.js';
import auditRoutes from './routes/audit.js';
import chatRoutes from './routes/chat.js';
import developerRoutes, {
  recordMonitoringSnapshot,
} from './routes/developer.js';
import assistantProfileRoutes from './routes/assistant-profile.js';
import threadsRoutes from './routes/threads.js';
import projectsRoutes from './routes/projects.js';
import controlPlaneRoutes from './routes/control-plane.js';
import githubRoutes from './routes/github.js';
import githubViewsRoutes from './routes/github-views.js';
import learningProposalsRoutes from './routes/learning-proposals.js';
import sourceCollectionsRoutes from './routes/source-collections.js';

// Plugin system
import {
  registerPlugin,
  mountPlugins,
  initPlugins,
  pluginManagementRouter,
} from './plugins/registry.js';
import chatPlugin from './plugins/chat/index.js';
import wikiPlugin from './plugins/wiki/index.js';
import workflowsPlugin from './plugins/workflows/index.js';
import copilotPlugin from './plugins/copilot/index.js';
import copilotRoutes from './plugins/copilot/routes.js';
import uptimePlugin from './plugins/uptime/index.js';
import autofixPlugin from './plugins/autofix/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '', 10) || 9744;

export async function initAdminServer(state: NanoCrabState): Promise<void> {
  setState(state);

  // Ensure sessions directory exists
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const db = new Database(path.join(STORE_DIR, 'messages.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      user_id TEXT
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      ip TEXT PRIMARY KEY,
      attempts INTEGER DEFAULT 0,
      last_attempt TEXT NOT NULL,
      locked_until TEXT
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      created_at TEXT NOT NULL,
      last_login TEXT
    );
  `);
  // Migration: add user_id column to admin_sessions if missing
  try {
    db.exec('ALTER TABLE admin_sessions ADD COLUMN user_id TEXT');
  } catch {
    // Column already exists
  }
  initAuth(db);
  initRateLimiter(db);
  initQuestionsDb();
  initAgentMessagesDb();

  // Register plugins
  registerPlugin(chatPlugin);
  registerPlugin(wikiPlugin);
  registerPlugin(workflowsPlugin);
  registerPlugin(copilotPlugin);
  registerPlugin(uptimePlugin);
  registerPlugin(autofixPlugin);

  // Load marketplace-installed plugins from plugins/ directory
  const externalCount = await loadExternalPlugins();
  if (externalCount > 0) {
    logger.info({ count: externalCount }, 'External plugins loaded');
  }

  const app = express();

  // Security middleware (applied to ALL requests)
  app.use(securityHeaders);
  app.use(ipAllowlist);

  // GitHub webhook needs raw body for HMAC — register before JSON parser
  app.post(
    '/api/webhooks/github',
    express.raw({ type: 'application/json' }),
    handleGithubWebhook,
  );

  app.use(express.json());
  app.use('/api', apiRateLimit);
  app.set('trust proxy', 1);

  // Static files — no-store for JS/CSS to prevent stale dashboard
  app.use(
    express.static(path.join(__dirname, 'public'), {
      etag: false,
      lastModified: false,
      setHeaders(res, filePath) {
        if (
          filePath.endsWith('.js') ||
          filePath.endsWith('.css') ||
          filePath.endsWith('.html')
        ) {
          res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate',
          );
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    }),
  );

  // Public health endpoint (no auth required)
  app.get('/health', (_req, res) => {
    const state = getState();
    const groups = nonWebGroups(state.registeredGroups());
    const channels = state.channels
      .filter((ch) => isChannelEnabledForRegisteredGroups(ch.name, groups))
      .map((ch) => buildChannelStatus(ch));
    const allUp = channels.every((c) => c.connected);
    res.status(allUp ? 200 : 503).json({
      status: allUp ? 'healthy' : 'degraded',
      uptime: Date.now() - state.startTime,
      channels,
    });
  });

  // OAuth callback (no auth — user redirects from GitHub)
  app.use('/api/copilot/oauth/callback', copilotRoutes);

  // Auth routes (login has its own rate limiting)
  app.use('/api', authRoutes);

  // Runtime audit is separate from the auth/security audit log exposed by authRoutes.
  app.use('/api/runtime-audit', requireAuth, auditRoutes);

  // Core API routes — role-based access control
  // Any authenticated user (viewer+)
  app.use('/api/channels', requireAuth, channelsRoutes);
  app.use('/api/groups', requireAuth, groupsRoutes);
  app.use('/api/messages', requireAuth, messagesRoutes);
  app.use('/api/containers', requireAuth, containersRoutes);
  app.use('/api/tasks', requireAuth, tasksRoutes);
  app.use('/api/logs', requireAuth, logsRoutes);
  app.use('/api/system', requireAuth, systemRoutes);
  app.use('/api/files', requireAuth, filesRoutes);
  app.use('/api/providers', requireAuth, providersRoutes);
  app.use('/api/memory', requireAuth, memoryRoutes);
  app.use('/api/journal', requireAuth, journalRoutes);
  app.use('/api/reports', requireAuth, reportsRoutes);
  app.use('/api/artifacts', requireAuth, artifactsRoutes);
  app.use('/api/missions', requireAuth, missionsRoutes);
  app.use('/api/briefings', requireAuth, briefingsRoutes);
  app.use('/api/briefing-analytics', requireAuth, briefingAnalyticsRoutes);
  app.use('/api/research', requireAuth, researchRoutes);
  app.use('/api/usage', requireAuth, usageRoutes);
  app.use('/api/sessions', requireAuth, sessionsRoutes);
  app.use('/api/mounts', requireAuth, mountsRoutes);
  app.use('/api/webhooks', requireAuth, webhooksRoutes);
  app.use('/api/agents', requireAuth, agentsRoutes);
  app.use('/api/agent-profiles', requireAuth, agentProfilesRoutes);
  app.use('/api/push', requireAuth, pushRoutes);
  app.use('/api/agents', requireAuth, agentMessagesRoutes);
  app.use('/api/questions', requireAuth, questionsRoutes);
  app.use('/api/approvals', requireAuth, approvalsRoutes);
  app.use('/api/chat', requireAuth, chatRoutes);
  app.use('/api/threads', requireAuth, threadsRoutes);
  app.use('/api/projects', requireAuth, projectsRoutes);
  app.use('/api/github', requireAuth, requireRole('admin'), githubRoutes);
  app.use('/api/github-views', requireAuth, requireRole('admin'), githubViewsRoutes);
  app.use('/api/assistant-profile', requireAuth, assistantProfileRoutes);
  app.use(
    '/api/control-plane',
    requireAuth,
    requireRole('admin'),
    controlPlaneRoutes,
  );
  app.use(
    '/api/learning-proposals',
    requireAuth,
    requireRole('admin'),
    learningProposalsRoutes,
  );
  app.use(
    '/api/source-collections',
    requireAuth,
    requireRole('admin'),
    sourceCollectionsRoutes,
  );

  // Admin role required
  app.use('/api/mcp', requireAuth, requireRole('admin'), mcpRoutes);
  app.use('/api/skills', requireAuth, requireRole('admin'), skillsRoutes);
  app.use(
    '/api/custom-containers',
    requireAuth,
    requireRole('admin'),
    customContainersRoutes,
  );
  app.use('/api/docker', requireAuth, requireRole('admin'), dockerRoutes);
  app.use('/api/dev', requireAuth, requireRole('admin'), developerRoutes);
  app.use(
    '/api/marketplace',
    requireAuth,
    requireRole('admin'),
    marketplaceRoutes,
  );

  // Owner role required
  app.use(
    '/api/credentials',
    requireAuth,
    requireRole('owner'),
    credentialsRoutes,
  );
  app.use('/api/backup', requireAuth, requireRole('owner'), backupRoutes);
  app.use('/api/tokens', requireAuth, requireRole('owner'), tokensRoutes);

  // Plugin management API
  app.use('/api/plugins', requireAuth, pluginManagementRouter());

  // Mount enabled plugin routes (under /api/plugins/<id>)
  const pluginRouter = express.Router();
  mountPlugins(pluginRouter);
  app.use('/api', requireAuth, pluginRouter);

  // Initialize plugins (runs onInit hooks — alert timers, uptime checker, etc.)
  await initPlugins();

  // SPA fallback
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const server = createServer(app);
  initWebSocket(server);

  server.listen(ADMIN_PORT, '0.0.0.0', () => {
    logger.info({ port: ADMIN_PORT }, 'Admin dashboard started');
    console.log(`\n  Admin dashboard: http://localhost:${ADMIN_PORT}\n`);
  });

  // Auto-backup check every hour
  setInterval(() => {
    checkAutoBackup().catch((err) => {
      logger.warn({ err }, 'Auto-backup check failed');
    });
  }, 3600000);

  // Server monitoring snapshot every 5 minutes
  setInterval(recordMonitoringSnapshot, 300000);
}

export { broadcastMessage } from './websocket.js';
