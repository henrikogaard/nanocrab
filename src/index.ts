import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { initAdminServer, broadcastMessage } from './admin/index.js';

import {
  ASSISTANT_NAME,
  CREDENTIAL_PROXY_PORT,
  DEFAULT_TRIGGER,
  getTriggerPattern,
  GROUPS_DIR,
  IDLE_TIMEOUT,
  MAX_MESSAGES_PER_PROMPT,
  POLL_INTERVAL,
  STORE_DIR,
  TIMEZONE,
} from './config.js';
import { startCredentialProxy } from './credential-proxy.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
  PROXY_BIND_HOST,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  deleteSession,
  getAllTasks,
  getLastBotMessageTimestamp,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
  storeMessageDirect,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import {
  restoreRemoteControl,
  startRemoteControl,
  stopRemoteControl,
} from './remote-control.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import { startSessionCleanup } from './session-cleanup.js';
import { getAgentProviderConfig } from './agent-provider.js';
import {
  AGENT_INSTRUCTIONS_FILE,
  copyAgentInstructionsTemplate,
} from './agent-instructions.js';
import { APP_VERSION, EDITION_NAME, EDITION_VERSION } from './edition.js';
import { extractStructuredMarkers, stripStructuredMarkers } from './admin/chat-workflow.js';
import {
  broadcastToolCall,
  broadcastToolResult,
  broadcastApprovalRequest,
  broadcastTaskProgress,
} from './admin/websocket.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { startProbeScheduler } from './probe-scheduler.js';
import { getAllProviders } from './providers/index.js';
import { liveProbeService } from './providers/live-probe.js';
import {
  getProviderCapabilityMatrix,
  loadProviderProfiles,
} from './provider-router.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();
const STARTUP_NOTICE_ENABLED =
  (process.env.NANOCRAB_STARTUP_NOTICE || '').toLowerCase() !== 'false';
const STARTUP_NOTICE_TEXT =
  process.env.NANOCRAB_STARTUP_NOTICE_TEXT ||
  `${ASSISTANT_NAME} er tilbake på nett etter omstart.`;
const STARTUP_NOTICE_MIN_INTERVAL_MS =
  Number.parseInt(
    process.env.NANOCRAB_STARTUP_NOTICE_MIN_INTERVAL_MS || '',
    10,
  ) || 5 * 60 * 1000;

let startupNoticeSentThisProcess = false;

function startNanoCrabUpdate(startedBy: string): {
  logPath: string;
  pid: number | undefined;
} {
  const scriptPath = path.join(process.cwd(), 'scripts', 'update-nanocrab.mjs');
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Updater script not found: ${scriptPath}`);
  }

  const updateDir = path.join(STORE_DIR, 'updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = path.join(updateDir, `update-${stamp}.log`);
  const out = fs.openSync(logPath, 'a');
  fs.writeSync(
    out,
    `NanoCrab update requested by ${startedBy} at ${new Date().toISOString()}\n\n`,
  );

  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      NANOCRAB_UPDATE_STARTED_BY: startedBy,
    },
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.closeSync(out);

  return { logPath, pid: child.pid };
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

/**
 * Return the message cursor for a group, recovering from the last bot reply
 * if lastAgentTimestamp is missing (new group, corrupted state, restart).
 */
function getOrRecoverCursor(chatJid: string): string {
  const existing = lastAgentTimestamp[chatJid];
  if (existing) return existing;

  const botTs = getLastBotMessageTimestamp(chatJid, ASSISTANT_NAME);
  if (botTs) {
    logger.info(
      { chatJid, recoveredFrom: botTs },
      'Recovered message cursor from last bot reply',
    );
    lastAgentTimestamp[chatJid] = botTs;
    saveState();
    return botTs;
  }
  return '';
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

function isGroupEnabled(group: RegisteredGroup | undefined): boolean {
  return group?.enabled !== false;
}

function isPrimaryBot(jid: string, group: RegisteredGroup): boolean {
  if (!group.isMain || !isGroupEnabled(group)) return false;

  const explicitPrimary = Object.entries(registeredGroups).find(
    ([, candidate]) =>
      candidate.isMain === true &&
      candidate.isPrimary === true &&
      isGroupEnabled(candidate),
  );
  if (explicitPrimary) return explicitPrimary[0] === jid;

  const fallbackPrimary = Object.entries(registeredGroups)
    .filter(
      ([, candidate]) => candidate.isMain === true && isGroupEnabled(candidate),
    )
    .sort((a, b) => a[1].added_at.localeCompare(b[1].added_at))[0];
  return fallbackPrimary?.[0] === jid;
}

async function sendStartupNotice(): Promise<void> {
  if (!STARTUP_NOTICE_ENABLED || startupNoticeSentThisProcess) return;

  const text = STARTUP_NOTICE_TEXT.trim();
  if (!text) return;

  const lastNotice = getRouterState('last_startup_notice_at');
  if (lastNotice) {
    const elapsed = Date.now() - Date.parse(lastNotice);
    if (Number.isFinite(elapsed) && elapsed < STARTUP_NOTICE_MIN_INTERVAL_MS) {
      logger.info(
        { lastNotice, minIntervalMs: STARTUP_NOTICE_MIN_INTERVAL_MS },
        'Startup notice skipped due to rate limit',
      );
      return;
    }
  }

  startupNoticeSentThisProcess = true;
  const timestamp = new Date().toISOString();
  let sentCount = 0;

  for (const [jid, group] of Object.entries(registeredGroups)) {
    if (!isPrimaryBot(jid, group)) continue;

    const channel = findChannel(channels, jid);
    if (!channel) {
      logger.warn({ group: group.name, jid }, 'Startup notice skipped');
      continue;
    }

    try {
      await channel.sendMessage(jid, text);
      sentCount += 1;
      storeMessageDirect({
        id: `startup-${Date.now()}-${sentCount}`,
        chat_jid: jid,
        sender: ASSISTANT_NAME,
        sender_name: ASSISTANT_NAME,
        content: text,
        timestamp,
        is_from_me: true,
        is_bot_message: true,
      });
      broadcastMessage({
        sender_name: ASSISTANT_NAME,
        content: text,
        chat_jid: jid,
        timestamp,
      });
      logger.info({ group: group.name, jid }, 'Startup notice sent');
    } catch (err) {
      logger.warn({ err, group: group.name, jid }, 'Startup notice failed');
    }
  }

  if (sentCount > 0) {
    setRouterState('last_startup_notice_at', timestamp);
  }
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Copy AGENTS.md template into the new group folder so agents have
  // identity and instructions from the first run.  (Fixes #1391)
  if (
    copyAgentInstructionsTemplate(
      path.join(GROUPS_DIR, group.isMain ? 'main' : 'global'),
      groupDir,
    )
  ) {
    if (ASSISTANT_NAME !== 'Andy') {
      const groupMdFile = path.join(groupDir, AGENT_INSTRUCTIONS_FILE);
      let content = fs.readFileSync(groupMdFile, 'utf-8');
      content = content.replace(/^# Andy$/m, `# ${ASSISTANT_NAME}`);
      content = content.replace(/You are Andy/g, `You are ${ASSISTANT_NAME}`);
      fs.writeFileSync(groupMdFile, content);
    }
    logger.info({ folder: group.folder }, 'Created AGENTS.md from template');
  }

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;
  if (!isGroupEnabled(group)) {
    logger.info(
      { chatJid, group: group.name },
      'Skipping queue processing for disabled bot agent',
    );
    return true;
  }

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  const isMainGroup = group.isMain === true;

  const missedMessages = getMessagesSince(
    chatJid,
    getOrRecoverCursor(chatJid),
    ASSISTANT_NAME,
    MAX_MESSAGES_PER_PROMPT,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const triggerPattern = getTriggerPattern(group.trigger);
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        triggerPattern.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  // Main groups use persistent containers — no idle timeout
  const persistentContainer = isMainGroup;
  const effectiveIdleTimeout = persistentContainer
    ? 24 * 60 * 60 * 1000
    : IDLE_TIMEOUT; // 24h for main, default for others

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (persistentContainer) return; // Never close persistent containers on idle
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, effectiveIdleTimeout);
  };

  await channel.setTyping?.(chatJid, true);
  // Telegram typing indicator expires after ~5s, so refresh it periodically
  const typingInterval = setInterval(() => {
    channel.setTyping?.(chatJid, true)?.catch(() => {});
  }, 4000);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const noInternal = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      // Extract structured markers
      const markers = extractStructuredMarkers(noInternal);
      const text = stripStructuredMarkers(noInternal).trim();

      // Broadcast markers as typed WS events
      for (const marker of markers) {
        const now = new Date().toISOString();
        if (marker.type === 'tool_call') {
          broadcastToolCall({ id: marker.id, name: marker.name, input: marker.input, groupJid: chatJid, timestamp: now });
        } else if (marker.type === 'tool_result') {
          broadcastToolResult({ id: marker.id, output: marker.output, duration: marker.duration, groupJid: chatJid });
        } else if (marker.type === 'approval_request') {
          broadcastApprovalRequest({ id: marker.id, tool: marker.tool, reason: marker.reason, input: marker.input, groupJid: chatJid });
        } else if (marker.type === 'progress') {
          broadcastTaskProgress({ phase: marker.phase, pct: marker.pct, message: marker.message, groupJid: chatJid });
        }
      }

      logger.info({ group: group.name }, `Agent output: ${raw.length} chars`);
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
        // Store bot response in database for dashboard feed
        storeMessageDirect({
          id: `bot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          chat_jid: chatJid,
          sender: ASSISTANT_NAME,
          sender_name: ASSISTANT_NAME,
          content: text,
          timestamp: new Date().toISOString(),
          is_from_me: true,
          is_bot_message: true,
        });
        broadcastMessage({
          sender_name: ASSISTANT_NAME,
          content: text,
          chat_jid: chatJid,
          timestamp: new Date().toISOString(),
        });
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });

  clearInterval(typingInterval);
  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    // Auto-restart persistent containers for main groups after error
    if (persistentContainer) {
      logger.info(
        { group: group.name },
        'Persistent container exited with error, restarting in 5s',
      );
      setTimeout(() => queue.enqueueMessageCheck(chatJid), 5000);
    }
    return false;
  }

  // Auto-restart persistent containers for main groups after clean exit
  if (persistentContainer) {
    logger.info(
      { group: group.name },
      'Persistent container exited cleanly, restarting in 5s',
    );
    setTimeout(() => queue.enqueueMessageCheck(chatJid), 5000);
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];
  const defaultProvider = getAgentProviderConfig().provider;
  const effectiveProvider = group.containerConfig?.provider || defaultProvider;
  const effectiveModel =
    group.containerConfig?.model ||
    group.containerConfig?.models?.[effectiveProvider];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      script: t.script || undefined,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
        allowedMcpServers: group.containerConfig?.allowedMcpServers,
        provider: group.containerConfig?.provider,
        model: effectiveModel,
        providerFallbackPurpose: 'default_chat',
        providerFallbackAction: 'read',
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      // Detect stale/corrupt session — clear it so the next retry starts fresh.
      // The session .jsonl can go missing after a crash mid-write, manual
      // deletion, or disk-full. The existing backoff in group-queue.ts
      // handles the retry; we just need to remove the broken session ID.
      const isStaleSession =
        sessionId &&
        output.error &&
        /no conversation found|ENOENT.*\.jsonl|session.*not found/i.test(
          output.error,
        );

      if (isStaleSession) {
        logger.warn(
          { group: group.name, staleSessionId: sessionId, error: output.error },
          'Stale session detected — clearing for next retry',
        );
        delete sessions[group.folder];
        deleteSession(group.folder);
      }

      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoCrab running (default trigger: ${DEFAULT_TRIGGER})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;
          if (!isGroupEnabled(group)) {
            logger.info(
              { chatJid, group: group.name },
              'Skipping disabled bot agent',
            );
            continue;
          }

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const triggerPattern = getTriggerPattern(group.trigger);
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                triggerPattern.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            getOrRecoverCursor(chatJid),
            ASSISTANT_NAME,
            MAX_MESSAGES_PER_PROMPT,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    if (!isGroupEnabled(group)) continue;
    const pending = getMessagesSince(
      chatJid,
      getOrRecoverCursor(chatJid),
      ASSISTANT_NAME,
      MAX_MESSAGES_PER_PROMPT,
    );
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info(
    {
      edition: EDITION_NAME,
      editionVersion: EDITION_VERSION,
      appVersion: APP_VERSION,
      nodeVersion: process.version,
    },
    'NanoCrab service starting',
  );
  logger.info('Database initialized');
  loadState();
  restoreRemoteControl();

  // Start credential proxy (containers route API calls through this)
  const proxyServer = await startCredentialProxy(
    CREDENTIAL_PROXY_PORT,
    PROXY_BIND_HOST,
  );

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    proxyServer.close();
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle /remote-control and /remote-control-end commands
  async function handleRemoteControl(
    command: string,
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    if (!group?.isMain) {
      logger.warn(
        { chatJid, sender: msg.sender },
        'Remote control rejected: not main group',
      );
      return;
    }

    const channel = findChannel(channels, chatJid);
    if (!channel) return;

    if (command === '/remote-control') {
      const result = await startRemoteControl(
        msg.sender,
        chatJid,
        process.cwd(),
      );
      if (result.ok) {
        await channel.sendMessage(chatJid, result.url);
      } else {
        await channel.sendMessage(
          chatJid,
          `Remote Control failed: ${result.error}`,
        );
      }
    } else {
      const result = stopRemoteControl();
      if (result.ok) {
        await channel.sendMessage(chatJid, 'Remote Control session ended.');
      } else {
        await channel.sendMessage(chatJid, result.error);
      }
    }
  }

  async function handleNanoCrabUpdate(
    chatJid: string,
    msg: NewMessage,
  ): Promise<void> {
    const group = registeredGroups[chatJid];
    const channel = findChannel(channels, chatJid);
    if (!group?.isMain || !channel) {
      logger.warn(
        { chatJid, sender: msg.sender },
        'NanoCrab update rejected: not main group',
      );
      return;
    }

    try {
      const result = startNanoCrabUpdate(msg.sender);
      const relativeLogPath = path.relative(process.cwd(), result.logPath);
      await channel.sendMessage(
        chatJid,
        [
          'NanoCrab update started from the latest GitHub release.',
          `Log: ${relativeLogPath}`,
          result.pid ? `PID: ${result.pid}` : '',
          'The service may restart automatically when the update completes.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      logger.info(
        {
          chatJid,
          sender: msg.sender,
          logPath: result.logPath,
          pid: result.pid,
        },
        'NanoCrab update started',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, chatJid }, 'NanoCrab update command failed');
      await channel.sendMessage(
        chatJid,
        `NanoCrab update could not start: ${message}`,
      );
    }
  }

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      const registeredGroup = registeredGroups[chatJid];
      const botAgentDisabled =
        registeredGroup !== undefined && !isGroupEnabled(registeredGroup);

      if (botAgentDisabled) {
        storeMessage(msg);
        broadcastMessage({
          sender_name: msg.sender_name,
          content: msg.content,
          chat_jid: msg.chat_jid,
          timestamp: msg.timestamp,
        });
        logger.debug(
          { chatJid, group: registeredGroup.name },
          'Message stored for disabled bot agent',
        );
        return;
      }

      // Host control commands — intercept before storage
      const trimmed = msg.content.trim();
      if (trimmed === '/remote-control' || trimmed === '/remote-control-end') {
        handleRemoteControl(trimmed, chatJid, msg).catch((err) =>
          logger.error({ err, chatJid }, 'Remote control command error'),
        );
        return;
      }
      if (trimmed === '/update-nanocrab') {
        handleNanoCrabUpdate(chatJid, msg).catch((err) =>
          logger.error({ err, chatJid }, 'NanoCrab update command error'),
        );
        return;
      }

      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      storeMessage(msg);
      broadcastMessage({
        sender_name: msg.sender_name,
        content: msg.content,
        chat_jid: msg.chat_jid,
        timestamp: msg.timestamp,
      });
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Initialize provider registry
  const providerRegistry = getAllProviders();
  logger.info(
    { providerCount: providerRegistry.length },
    'Provider registry initialized',
  );
  for (const provider of providerRegistry) {
    logger.info(
      { provider: provider.id, name: provider.name },
      'Provider registered',
    );
  }

  // Log provider capability matrix
  const capabilityMatrix = getProviderCapabilityMatrix();
  logger.info(
    { providerCount: Object.keys(capabilityMatrix).length },
    'Provider capability matrix loaded',
  );

  // Log configured provider profiles
  const profiles = loadProviderProfiles();
  for (const profile of profiles) {
    const config = getAgentProviderConfig();
    const isActive = profile.provider === config.provider;
    logger.info(
      {
        purpose: profile.id,
        provider: profile.provider,
        model: profile.model,
        active: isActive,
      },
      `Provider profile loaded`,
    );
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const group = registeredGroups[jid];
      if (group && !isGroupEnabled(group)) {
        logger.info({ jid, group: group.name }, 'Scheduled send skipped');
        return;
      }
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText, jid);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const group = registeredGroups[jid];
      if (group && !isGroupEnabled(group)) {
        throw new Error(`Bot agent "${group.name}" is disabled`);
      }
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    sendFile: async (jid, filePath, filename, caption) => {
      const group = registeredGroups[jid];
      if (group && !isGroupEnabled(group)) {
        throw new Error(`Bot agent "${group.name}" is disabled`);
      }
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      if (
        'sendFile' in channel &&
        typeof (channel as any).sendFile === 'function'
      ) {
        await (channel as any).sendFile(jid, filePath, filename, caption);
      } else {
        logger.warn({ jid }, 'Channel does not support file sending');
      }
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
    onTasksChanged: () => {
      const tasks = getAllTasks();
      const taskRows = tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        script: t.script || undefined,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      }));
      for (const group of Object.values(registeredGroups)) {
        writeTasksSnapshot(group.folder, group.isMain === true, taskRows);
      }
    },
  });
  startSessionCleanup();
  startProbeScheduler();
  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });

  // Start admin dashboard
  await initAdminServer({
    channels,
    registeredGroups: () => registeredGroups,
    updateRegisteredGroup: (jid, group) => {
      registeredGroups[jid] = group;
    },
    queue,
    sendMessage: async (jid, text) => {
      const group = registeredGroups[jid];
      if (group && !isGroupEnabled(group)) {
        throw new Error(`Bot agent "${group.name}" is disabled`);
      }
      const channel = findChannel(channels, jid);
      if (channel) await channel.sendMessage(jid, text);
    },
    startTime: Date.now(),
  });
  setTimeout(() => {
    sendStartupNotice().catch((err) =>
      logger.warn({ err }, 'Startup notice failed'),
    );
  }, 1000);
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoCrab');
    process.exit(1);
  });
}
