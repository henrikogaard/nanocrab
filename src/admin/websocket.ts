/**
 * WebSocket server for real-time dashboard updates.
 * Broadcasts: channel status, new messages, container activity, log lines.
 */
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { createStreamingLogRedactor, logger } from '../logger.js';
import {
  buildChannelStatus,
  isChannelEnabledForRegisteredGroups,
} from '../channel-status.js';
import { getState, nonWebGroups } from './state.js';
import { validateSession, getSessionUser, AdminUser } from './auth.js';
import {
  SESSIONS_DIR,
  TERMINAL_IDLE_TIMEOUT_MS,
  MAX_SESSION_LOG_BYTES,
  MAX_SESSION_RETENTION_DAYS,
  MAX_SESSIONS_COUNT,
  SESSION_PRUNE_INTERVAL_MS,
} from '../config.js';
import { redactTerminalTranscript } from '../terminal-transcripts.js';

interface WsMessage {
  type: string;
  data: unknown;
  sessionId?: string;
  sessionToken?: string;
  group?: string;
}

type TerminalLifecycleState =
  | 'ready'
  | 'historical'
  | 'exited'
  | 'idle-timeout'
  | 'unavailable';

type TerminalLifecycleReason =
  | 'session-ended'
  | 'process-exit'
  | 'operator-terminated'
  | 'idle-timeout'
  | 'spawn-failed'
  | 'max-terminals'
  | 'invalid-session-id'
  | 'denied';

let wss: WebSocketServer | null = null;
type WatchFileListener = (curr: fs.Stats, prev: fs.Stats) => void;

type LogWatcher = {
  filePath: string;
  listener: WatchFileListener;
};

const logWatchers = new Map<WebSocket, LogWatcher>();
const terminals = new Map<
  string,
  {
    process: ChildProcess;
    clients: Set<WebSocket>;
    transcript: string;
    name: string;
    idleTimer: ReturnType<typeof setTimeout>;
    owner: string;
    sessionToken: string;
    group: string;
    ended: boolean;
  }
>();
const MAX_TERMINALS = 3;
const historicalSessions = new Map<string, string>();

const INDEX_PATH = path.join(SESSIONS_DIR, 'index.json');
const SAFE_SESSION_ID = /^[A-Za-z0-9_.-]+$/;

interface SessionMetadata {
  id: string;
  name: string;
  owner?: string;
  group?: string;
  createdAt: string;
  endedAt: string | null;
  bytes: number;
  terminationReason?:
    | 'operator-terminated'
    | 'idle-timeout'
    | 'process-exit'
    | 'service-restart';
}

type TerminalOperation = 'spawn' | 'attach' | 'input' | 'close' | 'reconnect';

function terminalSessionOwner(sessionId: string): string | undefined {
  return (
    terminals.get(sessionId)?.owner ||
    loadSessionIndex().find((entry) => entry.id === sessionId)?.owner
  );
}

export type TerminalSessionAccess = 'allowed' | 'forbidden' | 'not-found';

export function authorizeTerminalSessionAccess(
  sessionId: string,
  username: string,
  operation: 'read' | 'delete' = 'read',
): TerminalSessionAccess {
  const indexed = loadSessionIndex().find((entry) => entry.id === sessionId);
  const active = terminals.get(sessionId);
  if (!indexed && !active) {
    const logPath = sessionLogPath(sessionId);
    const diskOnlyOrphan = Boolean(
      historicalSessions.has(sessionId) || (logPath && fs.existsSync(logPath)),
    );
    return diskOnlyOrphan ? 'forbidden' : 'not-found';
  }
  const owner = active?.owner || indexed?.owner;
  if (owner) return owner === username ? 'allowed' : 'forbidden';
  return operation === 'read' ? 'allowed' : 'forbidden';
}

function denyTerminalOperation(
  ws: WebSocket,
  operation: TerminalOperation,
  sessionId: string,
  reason: string,
): void {
  send(ws, {
    type: 'terminal_denied',
    sessionId,
    data: { operation, reason },
  });
  sendTerminalLifecycle(ws, sessionId, 'unavailable', true, 'denied');
}

function sendTerminalLifecycle(
  ws: WebSocket,
  sessionId: string,
  state: TerminalLifecycleState,
  readOnly: boolean,
  reason?: TerminalLifecycleReason,
): void {
  send(ws, {
    type: 'terminal_lifecycle',
    sessionId,
    data: { state, readOnly, ...(reason ? { reason } : {}) },
  });
}

function broadcastTerminalLifecycle(
  sessionId: string,
  state: TerminalLifecycleState,
  readOnly: boolean,
  reason?: TerminalLifecycleReason,
): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  for (const client of term.clients) {
    sendTerminalLifecycle(client, sessionId, state, readOnly, reason);
  }
}

function finishTerminalSession(
  sessionId: string,
  state: 'exited' | 'idle-timeout' | 'unavailable',
  terminationReason: SessionMetadata['terminationReason'],
  lifecycleReason: TerminalLifecycleReason,
  killProcess: boolean,
): boolean {
  const term = terminals.get(sessionId);
  if (!term || term.ended) return false;
  term.ended = true;
  clearTimeout(term.idleTimer);
  broadcastTerminalLifecycle(sessionId, state, true, lifecycleReason);
  finalizeSessionFile(sessionId, terminationReason);
  terminals.delete(sessionId);
  if (killProcess) term.process.kill();
  return true;
}

function authorizeTerminalOperation(
  ws: WebSocket,
  user: AdminUser | null,
  operation: TerminalOperation,
  sessionId: string,
): boolean {
  if (user?.role !== 'owner') {
    denyTerminalOperation(
      ws,
      operation,
      sessionId,
      'Terminal operations require owner role.',
    );
    return false;
  }

  const sessionOwner = terminalSessionOwner(sessionId);
  if (sessionOwner && sessionOwner !== user.username) {
    denyTerminalOperation(
      ws,
      operation,
      sessionId,
      'Terminal session belongs to a different owner.',
    );
    return false;
  }

  if (
    (operation === 'input' || operation === 'close') &&
    !terminals.has(sessionId) &&
    historicalSessions.has(sessionId)
  ) {
    denyTerminalOperation(
      ws,
      operation,
      sessionId,
      'Historical terminal sessions are read-only.',
    );
    return false;
  }

  return true;
}

export interface CockpitStreamEvent {
  id: string;
  type: 'tool_call' | 'tool_result' | 'progress';
  groupJid: string;
  timestamp: string;
  title: string;
  detail: string;
  status: 'running' | 'completed' | 'failed';
  pct?: number;
  phase?: string;
  toolName?: string;
  duration?: string;
}

const cockpitStreamEvents: CockpitStreamEvent[] = [];

function recordCockpitStreamEvent(event: CockpitStreamEvent): void {
  cockpitStreamEvents.push(event);
  if (cockpitStreamEvents.length > 200) {
    cockpitStreamEvents.splice(0, cockpitStreamEvents.length - 200);
  }
}

export function listCockpitStreamEvents(input: {
  group?: string;
  limit?: number;
}): CockpitStreamEvent[] {
  const limit = Math.max(1, Math.min(input.limit || 50, 100));
  return cockpitStreamEvents
    .filter((event) => !input.group || event.groupJid === input.group)
    .slice(-limit);
}

function loadSessionIndex(): SessionMetadata[] {
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveSessionIndex(index: SessionMetadata[]): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function generateSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function terminalTokenMatches(
  expectedToken: string,
  providedToken: string | undefined,
): boolean {
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(
    typeof providedToken === 'string' ? providedToken : '',
  );
  return (
    expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided)
  );
}

export function isSafeTerminalSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}

function sessionLogPath(sessionId: string): string | null {
  if (!isSafeTerminalSessionId(sessionId)) return null;
  return path.join(SESSIONS_DIR, `${sessionId}.log`);
}

export function createSessionFile(
  sessionId: string,
  owner = 'owner',
  group?: string,
): boolean {
  if (!isSafeTerminalSessionId(sessionId)) return false;
  const index = loadSessionIndex();
  if (index.some((entry) => entry.id === sessionId)) return false;
  index.push({
    id: sessionId,
    name: sessionId,
    owner,
    group: group || owner,
    createdAt: new Date().toISOString(),
    endedAt: null,
    bytes: 0,
  });
  saveSessionIndex(index);
  return true;
}

// Sessions whose log has hit the byte cap — used to warn only once per session.
const maxSizeWarned = new Set<string>();
const sessionRedactors = new Map<
  string,
  ReturnType<typeof createStreamingLogRedactor>
>();

export function redactTerminalOutput(data: string): string {
  return redactTerminalTranscript(data);
}

// Truncate a UTF-8 buffer to at most maxBytes without splitting a multi-byte
// codepoint (which would write an invalid byte sequence to the log file).
function safeUtf8Slice(buf: Buffer, maxBytes: number): Buffer {
  let end = Math.min(maxBytes, buf.length);
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--;
  }
  return buf.subarray(0, end);
}

export function finalizeSessionFile(
  sessionId: string,
  terminationReason: SessionMetadata['terminationReason'] = 'process-exit',
): void {
  const redactor = sessionRedactors.get(sessionId);
  if (redactor) {
    writeSessionLog(sessionId, redactor.flush());
    sessionRedactors.delete(sessionId);
  }
  maxSizeWarned.delete(sessionId);
  const index = loadSessionIndex();
  const entry = index.find((e) => e.id === sessionId);
  if (entry) {
    entry.endedAt ||= new Date().toISOString();
    entry.terminationReason ||= terminationReason;
    const logPath = sessionLogPath(sessionId);
    try {
      entry.bytes = logPath ? fs.statSync(logPath).size : 0;
    } catch {
      // intentional
    }
    saveSessionIndex(index);
  }
  if (entry) historicalSessions.set(sessionId, readSessionLog(sessionId));
}

export function reconcileInterruptedTerminalSessions(
  interruptedAt = new Date().toISOString(),
): number {
  const index = loadSessionIndex();
  let reconciled = 0;
  for (const entry of index) {
    if (entry.endedAt || terminals.has(entry.id)) continue;
    entry.endedAt = interruptedAt;
    entry.terminationReason = 'service-restart';
    const logPath = sessionLogPath(entry.id);
    try {
      entry.bytes = logPath ? fs.statSync(logPath).size : 0;
    } catch {
      entry.bytes = 0;
    }
    reconciled++;
  }
  if (reconciled > 0) saveSessionIndex(index);
  return reconciled;
}

export type TerminalSessionAttachment =
  | { status: 'historical'; transcript: string }
  | { status: 'not-found' };

export function getTerminalSessionAttachment(
  sessionId: string,
): TerminalSessionAttachment {
  if (!historicalSessions.has(sessionId)) return { status: 'not-found' };
  return {
    status: 'historical',
    transcript: historicalSessions.get(sessionId) || '',
  };
}

function writeSessionLog(sessionId: string, redacted: string): void {
  if (!redacted) return;
  const logPath = sessionLogPath(sessionId);
  if (!logPath) return;
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    // Enforce a byte-accurate size cap. Terminal output may contain multi-byte
    // UTF-8, so we measure and slice on bytes rather than string length.
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      if (stat.size >= MAX_SESSION_LOG_BYTES) {
        if (!maxSizeWarned.has(sessionId)) {
          maxSizeWarned.add(sessionId);
          logger.warn(
            { sessionId, size: stat.size },
            'Session log reached max size, dropping further output',
          );
        }
        return;
      }
      const remaining = MAX_SESSION_LOG_BYTES - stat.size;
      const buf = Buffer.from(redacted, 'utf-8');
      if (buf.length > remaining) {
        fs.appendFileSync(logPath, safeUtf8Slice(buf, remaining));
        if (!maxSizeWarned.has(sessionId)) {
          maxSizeWarned.add(sessionId);
          logger.warn(
            { sessionId },
            'Session log reached max size, dropping further output',
          );
        }
        return;
      }
    }
    fs.appendFileSync(logPath, redacted, 'utf-8');
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to append to session log');
  }
}

function redactTerminalChunk(sessionId: string, data: string): string {
  let redactor = sessionRedactors.get(sessionId);
  if (!redactor) {
    redactor = createStreamingLogRedactor();
    sessionRedactors.set(sessionId, redactor);
  }
  return redactor.write(data);
}

export function appendToSessionLog(sessionId: string, data: string): void {
  if (!data) return;
  writeSessionLog(sessionId, redactTerminalChunk(sessionId, data));
}

export function readSessionLog(sessionId: string): string {
  const logPath = sessionLogPath(sessionId);
  if (!logPath) return '';
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

export function loadHistoricalSessions(): number {
  try {
    historicalSessions.clear();
    if (!fs.existsSync(SESSIONS_DIR)) return 0;
    const files = fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.log'));
    let count = 0;
    for (const file of files) {
      const sessionId = file.replace('.log', '');
      try {
        const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
        historicalSessions.set(sessionId, content);
        count++;
      } catch {
        // skip files that can't be read
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function pruneOldSessions(): number {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return 0;
    const indexPath = path.join(SESSIONS_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) return 0;
    let index: SessionMetadata[] = JSON.parse(
      fs.readFileSync(indexPath, 'utf-8'),
    );
    const originalIndex = [...index];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - MAX_SESSION_RETENTION_DAYS);
    index = index.filter((entry) => {
      if (!entry.endedAt) return true; // keep active sessions
      return new Date(entry.endedAt) >= cutoff;
    });
    // Also cap total count
    if (index.length > MAX_SESSIONS_COUNT) {
      index.sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || ''),
      );
      index = index.slice(0, MAX_SESSIONS_COUNT);
    }
    const retainedIds = new Set(index.map((entry) => entry.id));
    const prunedIds = originalIndex
      .filter((entry) => !retainedIds.has(entry.id))
      .map((entry) => entry.id);
    saveSessionIndex(index);
    for (const sessionId of prunedIds) {
      removeTerminalSessionArtifacts(sessionId);
    }
    const pruned = prunedIds.length;
    if (pruned > 0) {
      logger.info({ pruned }, 'Pruned old terminal sessions');
    }
    // Remove orphan .log files not in index
    const indexIds = new Set(index.map((e) => e.id));
    const logFiles = fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith('.log'));
    for (const file of logFiles) {
      const sessionId = file.replace('.log', '');
      if (!indexIds.has(sessionId)) {
        removeTerminalSessionArtifacts(sessionId);
      }
    }
    return pruned;
  } catch {
    return 0;
  }
}

function removeTerminalSessionArtifacts(sessionId: string): void {
  closeTerminalSession(sessionId);
  historicalSessions.delete(sessionId);
  maxSizeWarned.delete(sessionId);
  sessionRedactors.delete(sessionId);
  const logPath = sessionLogPath(sessionId);
  try {
    if (logPath && fs.existsSync(logPath)) fs.unlinkSync(logPath);
  } catch {
    // best-effort cleanup; the index/cache state is still made coherent
  }
}

export function deleteTerminalSession(sessionId: string): boolean {
  if (!isSafeTerminalSessionId(sessionId)) return false;
  const index = loadSessionIndex();
  const indexed = index.some((entry) => entry.id === sessionId);
  const logPath = sessionLogPath(sessionId);
  const exists =
    indexed ||
    terminals.has(sessionId) ||
    historicalSessions.has(sessionId) ||
    Boolean(logPath && fs.existsSync(logPath));
  if (!exists) return false;

  saveSessionIndex(index.filter((entry) => entry.id !== sessionId));
  removeTerminalSessionArtifacts(sessionId);
  return true;
}

export function initWebSocket(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // Authenticate via query param
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token') || '';
    if (!validateSession(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Resolve user role for this connection
    const wsUser = getSessionUser(token);

    // Send initial state
    sendStatus(ws);

    // Handle client messages (e.g., subscribe to log streaming)
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WsMessage;
        if (msg.type === 'subscribe_logs') {
          startLogStream(ws, msg.data as string);
        }
        if (msg.type === 'unsubscribe_logs') {
          stopLogStream(ws);
        }
        if (msg.type === 'terminal_spawn') {
          const sessionId = msg.data as string;
          if (authorizeTerminalOperation(ws, wsUser, 'spawn', sessionId)) {
            spawnTerminal(ws, sessionId, wsUser!.username);
          }
        }
        if (msg.type === 'terminal_input' && msg.sessionId) {
          if (!authorizeTerminalOperation(ws, wsUser, 'input', msg.sessionId)) {
            return;
          }
          const term = terminals.get(msg.sessionId);
          if (term && term.clients.has(ws)) {
            term.process.stdin?.write(msg.data as string);
            // Reset idle timer
            clearTimeout(term.idleTimer);
            term.idleTimer = setTimeout(() => {
              broadcastTerminal(
                msg.sessionId!,
                '\r\n[Session timed out after 30 minutes of inactivity]\r\n',
              );
              finishTerminalSession(
                msg.sessionId!,
                'idle-timeout',
                'idle-timeout',
                'idle-timeout',
                true,
              );
            }, TERMINAL_IDLE_TIMEOUT_MS);
          }
        }
        if (msg.type === 'terminal_attach' && msg.sessionId) {
          const sid = msg.sessionId as string;
          if (!authorizeTerminalOperation(ws, wsUser, 'attach', sid)) {
            return;
          }
          const term = terminals.get(sid);
          if (term) {
            if (!terminalTokenMatches(term.sessionToken, msg.sessionToken)) {
              denyTerminalOperation(
                ws,
                'attach',
                sid,
                'Invalid or missing terminal session token.',
              );
              return;
            }
            term.clients.add(ws);
            send(ws, {
              type: 'terminal_attach_result',
              data: { status: 'active', readOnly: false },
              sessionId: sid,
            });
            sendTerminalLifecycle(ws, sid, 'ready', false);
            send(ws, {
              type: 'terminal_output',
              data: term.transcript.slice(-50000),
              sessionId: sid,
            });
          } else {
            const attachment = getTerminalSessionAttachment(sid);
            if (attachment.status === 'historical') {
              send(ws, {
                type: 'terminal_attach_result',
                data: { status: 'historical', readOnly: true },
                sessionId: sid,
              });
              sendTerminalLifecycle(
                ws,
                sid,
                'historical',
                true,
                'session-ended',
              );
              send(ws, {
                type: 'terminal_output',
                data: attachment.transcript.slice(-50000),
                sessionId: sid,
              });
              send(ws, {
                type: 'terminal_output',
                data: '\r\n[Session ended — read-only view. Close this and spawn a new session to continue.]\r\n',
                sessionId: sid,
              });
            } else {
              send(ws, {
                type: 'terminal_attach_result',
                data: { status: 'not-found', readOnly: false },
                sessionId: sid,
              });
            }
          }
        }
        if (msg.type === 'terminal_reconnect' && msg.sessionId) {
          const sid = msg.sessionId as string;
          if (!authorizeTerminalOperation(ws, wsUser, 'reconnect', sid)) {
            return;
          }
          const term = terminals.get(sid);
          if (!term) {
            send(ws, {
              type: 'terminal_attach_result',
              data: { status: 'not-found', readOnly: false },
              sessionId: sid,
            });
            return;
          }
          if (!terminalTokenMatches(term.sessionToken, msg.sessionToken)) {
            denyTerminalOperation(
              ws,
              'reconnect',
              sid,
              'Invalid or missing terminal session token.',
            );
            return;
          }
          term.clients.add(ws);
          send(ws, {
            type: 'terminal_attach_result',
            data: { status: 'active', readOnly: false },
            sessionId: sid,
          });
          sendTerminalLifecycle(ws, sid, 'ready', false);
          send(ws, {
            type: 'terminal_output',
            data: term.transcript.slice(-50000),
            sessionId: sid,
          });
        }
        if (msg.type === 'terminal_close' && msg.sessionId) {
          if (authorizeTerminalOperation(ws, wsUser, 'close', msg.sessionId)) {
            closeTerminalSession(msg.sessionId);
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      stopLogStream(ws);
      for (const term of terminals.values()) term.clients.delete(ws);
    });
  });

  // Broadcast status updates every 3 seconds
  setInterval(() => {
    broadcast({ type: 'status', data: getStatusData() });
  }, 3000);

  reconcileInterruptedTerminalSessions();
  pruneOldSessions();
  loadHistoricalSessions();
  // Enforce retention periodically, not only at startup, so long-running
  // servers do not accumulate sessions unbounded between restarts.
  setInterval(() => pruneOldSessions(), SESSION_PRUNE_INTERVAL_MS).unref();
  logger.debug('WebSocket server initialized');
}

function sendStatus(ws: WebSocket): void {
  send(ws, { type: 'status', data: getStatusData() });
}

function getStatusData(): object {
  const state = getState();
  const groups = nonWebGroups(state.registeredGroups());
  return {
    channels: state.channels
      .filter((ch) => isChannelEnabledForRegisteredGroups(ch.name, groups))
      .map((ch) => buildChannelStatus(ch)),
    containers: state.queue.getActiveContainers(),
    uptime: Date.now() - state.startTime,
  };
}

export function startLogStream(ws: WebSocket, logFile: string): void {
  stopLogStream(ws);

  const projectRoot = process.cwd();
  let filePath: string;

  if (logFile === 'system') {
    filePath = path.join(projectRoot, 'logs', 'nanocrab.log');
  } else if (logFile === 'errors') {
    filePath = path.join(projectRoot, 'logs', 'nanocrab.error.log');
  } else {
    return; // Only system/error logs for now
  }

  if (!fs.existsSync(filePath)) return;

  // Send last 50 lines initially
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(-50);
  send(ws, { type: 'log_lines', data: { file: logFile, lines } });

  // Watch for changes
  let lastSize = fs.statSync(filePath).size;
  const listener: WatchFileListener = () => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > lastSize) {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(stat.size - lastSize);
        fs.readSync(fd, buf, 0, buf.length, lastSize);
        fs.closeSync(fd);
        const newLines = buf.toString('utf-8').split('\n').filter(Boolean);
        if (newLines.length > 0) {
          send(ws, {
            type: 'log_lines',
            data: { file: logFile, lines: newLines },
          });
        }
        lastSize = stat.size;
      } else if (stat.size < lastSize) {
        // File was truncated/rotated
        lastSize = stat.size;
      }
    } catch {
      // ignore
    }
  };

  fs.watchFile(filePath, { interval: 1000 }, listener);
  logWatchers.set(ws, { filePath, listener });
}

export function stopLogStream(ws: WebSocket): void {
  const watcher = logWatchers.get(ws);
  if (watcher) {
    fs.unwatchFile(watcher.filePath, watcher.listener);
    logWatchers.delete(ws);
  }
}

function spawnTerminal(ws: WebSocket, sessionId: string, owner: string): void {
  if (!isSafeTerminalSessionId(sessionId)) {
    sendTerminalLifecycle(
      ws,
      sessionId,
      'unavailable',
      true,
      'invalid-session-id',
    );
    return;
  }

  const existing = terminals.get(sessionId);
  if (existing) {
    existing.clients.add(ws);
    sendTerminalLifecycle(ws, sessionId, 'ready', false);
    send(ws, {
      type: 'terminal_output',
      data: existing.transcript.slice(-50000),
      sessionId,
    });
    return;
  }

  if (
    historicalSessions.has(sessionId) ||
    loadSessionIndex().some((entry) => entry.id === sessionId)
  ) {
    denyTerminalOperation(
      ws,
      'spawn',
      sessionId,
      'Historical terminal session ids cannot be reused.',
    );
    return;
  }

  if (terminals.size >= MAX_TERMINALS) {
    sendTerminalLifecycle(ws, sessionId, 'unavailable', true, 'max-terminals');
    return;
  }

  let proc: ChildProcess;
  try {
    proc = spawn('bash', ['-i'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
      cwd: process.cwd(),
    });
  } catch {
    sendTerminalLifecycle(ws, sessionId, 'unavailable', true, 'spawn-failed');
    return;
  }

  const sessionToken = generateSessionToken();
  const group = owner;
  createSessionFile(sessionId, owner, group);
  appendToSessionLog(
    sessionId,
    `[Session started at ${new Date().toISOString()}]\r\n`,
  );

  const idleTimer = setTimeout(() => {
    broadcastTerminal(
      sessionId,
      '\r\n[Session timed out after 30 minutes of inactivity]\r\n',
    );
    finishTerminalSession(
      sessionId,
      'idle-timeout',
      'idle-timeout',
      'idle-timeout',
      true,
    );
  }, TERMINAL_IDLE_TIMEOUT_MS);

  terminals.set(sessionId, {
    process: proc,
    clients: new Set([ws]),
    transcript: '',
    name: sessionId,
    idleTimer,
    owner,
    sessionToken,
    group,
    ended: false,
  });

  // Hand the reconnect token to the spawning client only; it is never
  // broadcast or included in session listings.
  send(ws, {
    type: 'terminal_session',
    sessionId,
    data: { sessionToken },
  });
  sendTerminalLifecycle(ws, sessionId, 'ready', false);

  proc.stdout?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.stderr?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.on('error', () => {
    finishTerminalSession(
      sessionId,
      'unavailable',
      'process-exit',
      'spawn-failed',
      false,
    );
  });
  proc.on('close', () => {
    finishTerminalSession(
      sessionId,
      'exited',
      'process-exit',
      'process-exit',
      false,
    );
  });

  logger.info({ sessionId }, 'Terminal session spawned');
}

// Terminate an active terminal session: finalize its log, clear the idle timer,
// and kill the process. Returns true if a live session was closed. The process
// 'close' handler removes it from the terminals map.
export function closeTerminalSession(sessionId: string): boolean {
  return finishTerminalSession(
    sessionId,
    'exited',
    'operator-terminated',
    'operator-terminated',
    true,
  );
}

function broadcastTerminal(sessionId: string, data: string): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  const redacted = redactTerminalChunk(sessionId, data);
  if (!redacted) return;
  term.transcript = `${term.transcript}${redacted}`.slice(-200000);
  writeSessionLog(sessionId, redacted);
  for (const client of term.clients) {
    send(client, { type: 'terminal_output', data: redacted, sessionId });
  }
}

export function listTerminalSessions(): Array<{
  id: string;
  name: string;
  owner: string;
  transcriptBytes: number;
  active: boolean;
}> {
  const active = [...terminals.entries()].map(([id, term]) => ({
    id,
    name: term.name,
    owner: term.owner,
    transcriptBytes: Buffer.byteLength(term.transcript),
    active: true,
  }));
  const indexById = new Map(
    loadSessionIndex().map((entry) => [entry.id, entry]),
  );
  const historical = [...historicalSessions.entries()].map(
    ([id, transcript]) => ({
      id,
      name: id,
      owner: indexById.get(id)?.owner || 'unknown',
      transcriptBytes: Buffer.byteLength(transcript),
      active: false,
    }),
  );
  return [...active, ...historical];
}

function send(ws: WebSocket, msg: WsMessage & { sessionId?: string }): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function broadcast(msg: WsMessage): void {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

/**
 * Call this from index.ts when a new message arrives to push to dashboard.
 */
export function broadcastMessage(message: {
  sender_name: string;
  content: string;
  chat_jid: string;
  timestamp: string;
  channel?: string;
}): void {
  broadcast({ type: 'new_message', data: message });
}

export function broadcastToolCall(data: {
  id: string;
  name: string;
  input: string;
  groupJid: string;
  timestamp: string;
}): void {
  recordCockpitStreamEvent({
    id: data.id,
    type: 'tool_call',
    groupJid: data.groupJid,
    timestamp: data.timestamp,
    title: data.name,
    detail: data.input,
    status: 'running',
    toolName: data.name,
  });
  broadcast({ type: 'tool_call', data });
}

export function broadcastToolResult(data: {
  id: string;
  output: string;
  duration: string;
  groupJid: string;
}): void {
  recordCockpitStreamEvent({
    id: data.id,
    type: 'tool_result',
    groupJid: data.groupJid,
    timestamp: new Date().toISOString(),
    title: `Result ${data.id}`,
    detail: data.output,
    status: 'completed',
    duration: data.duration,
  });
  broadcast({ type: 'tool_result', data });
}

export function broadcastApprovalRequest(data: {
  id: string;
  tool: string;
  reason: string;
  input: string;
  groupJid: string;
}): void {
  broadcast({ type: 'approval_request', data });
}

export function broadcastTaskProgress(data: {
  phase: string;
  pct: number;
  message: string;
  groupJid: string;
}): void {
  recordCockpitStreamEvent({
    id: `progress-${data.groupJid}-${Date.now()}`,
    type: 'progress',
    groupJid: data.groupJid,
    timestamp: new Date().toISOString(),
    title: data.phase,
    detail: data.message,
    status: data.pct >= 100 || data.phase === 'done' ? 'completed' : 'running',
    pct: data.pct,
    phase: data.phase,
  });
  broadcast({ type: 'task_progress', data });
}

export function broadcastThreadTitle(data: {
  groupJid: string;
  title: string;
  timestamp: string;
}): void {
  broadcast({ type: 'thread_title', data });
}

export function broadcastCockpitSessionUpdate(data: {
  id: string;
  group: string;
  provider?: string;
  model?: string;
  status: string;
  updatedAt: string;
  lastEventAt?: string;
  currentStep?: string;
}): void {
  broadcast({ type: 'cockpit_session_update', data });
}

export function broadcastApprovalResult(data: {
  id: string;
  groupJid: string;
  approved: boolean;
}): void {
  broadcast({ type: 'approval_result', data });
}
