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
import { appendTerminalTranscript } from '../terminal-transcripts.js';
import { getChannelHealth } from '../channel-health.js';

interface WsMessage {
  type: string;
  data: unknown;
  sessionId?: string;
}

let wss: WebSocketServer | null = null;
const logWatchers = new Map<WebSocket, fs.FSWatcher>();
const TERMINAL_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
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
            const input = msg.data as string;
            term.process.stdin?.write(input);
            appendTerminalTranscript({
              sessionId: msg.sessionId,
              owner: term.owner,
              type: 'input',
              data: input,
            });
            // Reset idle timer
            clearTimeout(term.idleTimer);
            term.idleTimer = setTimeout(() => {
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
          const term = terminals.get(msg.sessionId);
          if (term) {
            term.clients.add(ws);
            send(ws, {
              type: 'terminal_output',
              data: term.transcript.slice(-50000),
              sessionId: msg.sessionId,
            });
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

  logger.debug('WebSocket server initialized');
}

function sendStatus(ws: WebSocket): void {
  send(ws, { type: 'status', data: getStatusData() });
}

function getStatusData(): object {
  const state = getState();
  return {
    channels: state.channels.map(getChannelHealth),
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

  const idleTimer = setTimeout(() => {
    broadcastTerminal(
      sessionId,
      '\r\n[Session timed out after 30 minutes of inactivity]\r\n',
    );
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
  appendTerminalTranscript({
    sessionId,
    owner,
    type: 'spawn',
    data: `Terminal session spawned in ${process.cwd()}`,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.stderr?.on('data', (data: Buffer) => {
    broadcastTerminal(sessionId, data.toString());
  });
  proc.on('close', () => {
    broadcastTerminal(sessionId, '\r\n[Process exited]\r\n');
    appendTerminalTranscript({
      sessionId,
      owner,
      type: 'close',
      data: 'Process exited',
    });
    terminals.delete(sessionId);
  });

  logger.info({ sessionId }, 'Terminal session spawned');
}

function broadcastTerminal(sessionId: string, data: string): void {
  const term = terminals.get(sessionId);
  if (!term) return;
  term.transcript = `${term.transcript}${data}`.slice(-200000);
  appendTerminalTranscript({
    sessionId,
    owner: term.owner,
    type: 'output',
    data,
  });
  for (const client of term.clients) {
    send(client, { type: 'terminal_output', data, sessionId });
  }
}

export function listTerminalSessions(): Array<{
  id: string;
  name: string;
  owner: string;
  transcriptBytes: number;
}> {
  return [...terminals.entries()].map(([id, term]) => ({
    id,
    name: term.name,
    owner: term.owner,
    transcriptBytes: Buffer.byteLength(term.transcript),
  }));
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
