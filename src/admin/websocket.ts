/**
 * WebSocket server for real-time dashboard updates.
 * Broadcasts: channel status, new messages, container activity, log lines.
 */
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { getState } from './state.js';
import { validateSession, getSessionUser, AdminUser } from './auth.js';
import { SESSIONS_DIR, TERMINAL_IDLE_TIMEOUT_MS } from '../config.js';

interface WsMessage {
  type: string;
  data: unknown;
  sessionId?: string;
}

let wss: WebSocketServer | null = null;
const logWatchers = new Map<WebSocket, fs.FSWatcher>();
const terminals = new Map<
  string,
  {
    process: ChildProcess;
    clients: Set<WebSocket>;
    transcript: string;
    name: string;
    idleTimer: ReturnType<typeof setTimeout>;
    owner: string;
  }
>();
const MAX_TERMINALS = 3;
const historicalSessions = new Map<string, string>();

const INDEX_PATH = path.join(SESSIONS_DIR, 'index.json');

interface SessionMetadata {
  id: string;
  name: string;
  owner: string;
  createdAt: string;
  endedAt: string | null;
  bytes: number;
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

export function createSessionFile(sessionId: string): void {
  let index = loadSessionIndex();
  index = index.filter(e => e.id !== sessionId);
  index.push({
    id: sessionId,
    name: sessionId,
    owner: 'owner',
    createdAt: new Date().toISOString(),
    endedAt: null,
    bytes: 0,
  });
  saveSessionIndex(index);
}

export function finalizeSessionFile(sessionId: string): void {
  const index = loadSessionIndex();
  const entry = index.find(e => e.id === sessionId);
  if (entry) {
    entry.endedAt = new Date().toISOString();
    const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
    try {
      entry.bytes = fs.statSync(logPath).size;
    } catch {}
    saveSessionIndex(index);
  }
}

export function appendToSessionLog(sessionId: string, data: string): void {
  if (!data) return;
  const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.appendFileSync(logPath, data, 'utf-8');
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to append to session log');
  }
}

export function readSessionLog(sessionId: string): string {
  const logPath = path.join(SESSIONS_DIR, `${sessionId}.log`);
  try {
    return fs.readFileSync(logPath, 'utf-8');
  } catch {
    return '';
  }
}

export function loadHistoricalSessions(): number {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return 0;
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.log'));
    let count = 0;
    for (const file of files) {
      const sessionId = file.replace('.log', '');
      const content = fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf-8');
      historicalSessions.set(sessionId, content);
      count++;
    }
    return count;
  } catch {
    return 0;
  }
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
          // Only owner can open terminal sessions
          if (wsUser?.role !== 'owner') {
            send(ws, {
              type: 'terminal_output',
              data: 'Permission denied: terminal requires owner role.\r\n',
              sessionId: msg.data as string,
            });
            return;
          }
          spawnTerminal(ws, msg.data as string, wsUser?.username || 'owner');
        }
        if (msg.type === 'terminal_input' && msg.sessionId) {
          const term = terminals.get(msg.sessionId);
          if (term && term.clients.has(ws)) {
            term.process.stdin?.write(msg.data as string);
            // Reset idle timer
            clearTimeout(term.idleTimer);
            term.idleTimer = setTimeout(() => {
              finalizeSessionFile(msg.sessionId!);
              term.process.kill();
              terminals.delete(msg.sessionId!);
              broadcastTerminal(
                msg.sessionId!,
                '\r\n[Session timed out after 30 minutes of inactivity]\r\n',
              );
            }, TERMINAL_IDLE_TIMEOUT_MS);
          }
        }
        if (msg.type === 'terminal_attach' && msg.sessionId) {
          const sid = msg.sessionId as string;
          const term = terminals.get(sid);
          if (term) {
            term.clients.add(ws);
            send(ws, {
              type: 'terminal_output',
              data: term.transcript.slice(-50000),
              sessionId: sid,
            });
          } else {
            const historical = historicalSessions.get(sid);
            if (historical) {
              send(ws, {
                type: 'terminal_output',
                data: historical.slice(-50000),
                sessionId: sid,
              });
              send(ws, {
                type: 'terminal_output',
                data: '\r\n[Session ended — read-only view. Close this and spawn a new session to continue.]\r\n',
                sessionId: sid,
              });
            }
          }
        }
        if (msg.type === 'terminal_close' && msg.sessionId) {
          const term = terminals.get(msg.sessionId);
          if (term) term.process.kill();
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

  loadHistoricalSessions();
  logger.debug('WebSocket server initialized');
}

function sendStatus(ws: WebSocket): void {
  send(ws, { type: 'status', data: getStatusData() });
}

function getStatusData(): object {
  const state = getState();
  return {
    channels: state.channels.map((ch) => ({
      name: ch.name,
      connected: ch.isConnected(),
    })),
    containers: state.queue.getActiveContainers(),
    uptime: Date.now() - state.startTime,
  };
}

function startLogStream(ws: WebSocket, logFile: string): void {
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
  const watcher = fs.watchFile(filePath, { interval: 1000 }, () => {
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
  });

  logWatchers.set(ws, watcher as unknown as fs.FSWatcher);
}

function stopLogStream(ws: WebSocket): void {
  const watcher = logWatchers.get(ws);
  if (watcher) {
    fs.unwatchFile(watcher as unknown as string);
    logWatchers.delete(ws);
  }
}

function spawnTerminal(ws: WebSocket, sessionId: string, owner: string): void {
  const existing = terminals.get(sessionId);
  if (existing) {
    existing.clients.add(ws);
    send(ws, {
      type: 'terminal_output',
      data: existing.transcript.slice(-50000),
      sessionId,
    });
    return;
  }

  if (terminals.size >= MAX_TERMINALS) {
    send(ws, {
      type: 'terminal_output',
      data: 'Max terminal sessions reached.\r\n',
      sessionId,
    });
    return;
  }

  const proc = spawn('bash', ['-i'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'xterm-256color' },
    cwd: process.cwd(),
  });

  createSessionFile(sessionId);
  appendToSessionLog(sessionId, `[Session started at ${new Date().toISOString()}]\r\n`);

  const idleTimer = setTimeout(() => {
    broadcastTerminal(
      sessionId,
      '\r\n[Session timed out after 30 minutes of inactivity]\r\n',
    );
    finalizeSessionFile(sessionId);
    proc.kill();
    terminals.delete(sessionId);
  }, TERMINAL_IDLE_TIMEOUT_MS);

  terminals.set(sessionId, {
    process: proc,
    clients: new Set([ws]),
    transcript: '',
    name: sessionId,
    idleTimer,
    owner,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.stderr?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.on('close', () => {
    broadcastTerminal(sessionId, '\r\n[Process exited]\r\n');
    finalizeSessionFile(sessionId);
    terminals.delete(sessionId);
  });

  logger.info({ sessionId }, 'Terminal session spawned');
}

function broadcastTerminal(sessionId: string, data: string): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  term.transcript = `${term.transcript}${data}`.slice(-200000);
  appendToSessionLog(sessionId, data);
  for (const client of term.clients) {
    send(client, { type: 'terminal_output', data, sessionId });
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
  const historical = [...historicalSessions.entries()].map(([id, transcript]) => ({
    id,
    name: id,
    owner: 'unknown',
    transcriptBytes: Buffer.byteLength(transcript),
    active: false,
  }));
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
  broadcast({ type: 'tool_call', data });
}

export function broadcastToolResult(data: {
  id: string;
  output: string;
  duration: string;
  groupJid: string;
}): void {
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
  broadcast({ type: 'task_progress', data });
}

export function broadcastApprovalResult(data: {
  id: string;
  groupJid: string;
  approved: boolean;
}): void {
  broadcast({ type: 'approval_result', data });
}
