import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocket } from 'ws';

const TEST_DIR = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('path').join(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('os').tmpdir(),
    `nanocrab-terminal-lifecycle-${Date.now()}`,
  ),
);

type FakeProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

const spawnState = vi.hoisted(() => ({
  processes: [] as FakeProcess[],
  throwNext: false,
}));

vi.mock('child_process', async () => {
  const { EventEmitter: MockEmitter } = await import('node:events');
  return {
    spawn: vi.fn(() => {
      if (spawnState.throwNext) {
        spawnState.throwNext = false;
        throw new Error('synchronous host failure secret');
      }
      const process = new MockEmitter() as FakeProcess;
      process.stdout = new MockEmitter();
      process.stderr = new MockEmitter();
      process.stdin = { write: vi.fn() };
      process.kill = vi.fn();
      spawnState.processes.push(process);
      return process;
    }),
  };
});

vi.mock('../config.js', () => ({
  SESSIONS_DIR: TEST_DIR,
  DATA_DIR: TEST_DIR + '/data',
  TERMINAL_IDLE_TIMEOUT_MS: 40,
  MAX_SESSION_LOG_BYTES: 1024 * 1024,
  MAX_SESSION_RETENTION_DAYS: 90,
  MAX_SESSIONS_COUNT: 100,
  SESSION_PRUNE_INTERVAL_MS: 3600000,
}));

vi.mock('../logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../logger.js')>()),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('./auth.js', () => ({
  validateSession: vi.fn(() => true),
  getSessionUser: vi.fn(() => ({
    id: 'alice',
    username: 'alice',
    role: 'owner',
  })),
}));

vi.mock('./state.js', () => ({
  getState: () => ({
    channels: [],
    queue: { getActiveContainers: () => [] },
    registeredGroups: () => ({}),
    startTime: Date.now(),
  }),
  nonWebGroups: () => ({}),
}));

const { initWebSocket } = await import('./websocket.js');

type ServerMessage = {
  type: string;
  data: Record<string, unknown> | string;
  sessionId?: string;
};

function messageState(message: ServerMessage): unknown {
  return typeof message.data === 'object' ? message.data.state : undefined;
}

async function connect(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=owner`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

function collect(ws: WebSocket): {
  messages: ServerMessage[];
  stop(): void;
} {
  const messages: ServerMessage[] = [];
  const listener = (raw: Buffer) => {
    messages.push(JSON.parse(raw.toString()) as ServerMessage);
  };
  ws.on('message', listener);
  return { messages, stop: () => ws.off('message', listener) };
}

async function waitFor(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const match = messages.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for terminal lifecycle message');
}

describe('typed terminal lifecycle websocket contract', () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    server = http.createServer();
    initWebSocket(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    port = address.port;
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('keeps sentinel-like stdout ordinary and emits exited before cleanup', async () => {
    const ws = await connect(port);
    clients.push(ws);
    const stream = collect(ws);
    ws.send(JSON.stringify({ type: 'terminal_spawn', data: 'literal-output' }));
    await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'literal-output' &&
        messageState(message) === 'ready',
    );
    const process = spawnState.processes.at(-1)!;
    process.stdout.emit('data', Buffer.from('[Process exited]\n'));
    await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_output' &&
        message.sessionId === 'literal-output',
    );
    expect(
      stream.messages.filter(
        (message) =>
          message.type === 'terminal_lifecycle' &&
          messageState(message) === 'exited',
      ),
    ).toHaveLength(0);

    process.emit('close', 0);
    const exited = await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'literal-output' &&
        messageState(message) === 'exited',
    );
    expect(exited.data).toEqual({
      state: 'exited',
      readOnly: true,
      reason: 'process-exit',
    });
    stream.stop();
  });

  it('emits idle-timeout once before killing the process', async () => {
    const ws = await connect(port);
    clients.push(ws);
    const stream = collect(ws);
    ws.send(JSON.stringify({ type: 'terminal_spawn', data: 'idle-session' }));
    await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'idle-session' &&
        messageState(message) === 'ready',
    );
    const process = spawnState.processes.at(-1)!;
    const idle = await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'idle-session' &&
        messageState(message) === 'idle-timeout',
    );
    expect(idle.data).toEqual({
      state: 'idle-timeout',
      readOnly: true,
      reason: 'idle-timeout',
    });
    expect(process.kill).toHaveBeenCalledTimes(1);
    const websocketSource = fs.readFileSync(
      new URL('./websocket.ts', import.meta.url),
      'utf8',
    );
    const finishSource = websocketSource.slice(
      websocketSource.indexOf('function finishTerminalSession('),
      websocketSource.indexOf('\nfunction authorizeTerminalOperation('),
    );
    expect(finishSource.indexOf('broadcastTerminalLifecycle(')).toBeLessThan(
      finishSource.indexOf('terminals.delete('),
    );
    process.emit('close', 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      stream.messages.filter(
        (message) =>
          message.type === 'terminal_lifecycle' &&
          ['idle-timeout', 'exited'].includes(String(messageState(message))),
      ),
    ).toHaveLength(1);
    stream.stop();
  });

  it('emits unavailable for spawn errors and max-terminal refusal', async () => {
    const ws = await connect(port);
    clients.push(ws);
    const stream = collect(ws);
    spawnState.throwNext = true;
    ws.send(JSON.stringify({ type: 'terminal_spawn', data: 'sync-error' }));
    const syncFailed = await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'sync-error' &&
        messageState(message) === 'unavailable',
    );
    expect(syncFailed.data).toEqual({
      state: 'unavailable',
      readOnly: true,
      reason: 'spawn-failed',
    });
    expect(JSON.stringify(syncFailed)).not.toContain('host failure secret');

    ws.send(JSON.stringify({ type: 'terminal_spawn', data: 'spawn-error' }));
    await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'spawn-error' &&
        messageState(message) === 'ready',
    );
    spawnState.processes
      .at(-1)!
      .emit('error', new Error('host failure secret'));
    const failed = await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'spawn-error' &&
        messageState(message) === 'unavailable',
    );
    expect(failed.data).toEqual({
      state: 'unavailable',
      readOnly: true,
      reason: 'spawn-failed',
    });
    expect(JSON.stringify(failed)).not.toContain('host failure secret');

    for (const id of ['max-a', 'max-b', 'max-c', 'max-d']) {
      ws.send(JSON.stringify({ type: 'terminal_spawn', data: id }));
    }
    const refused = await waitFor(
      stream.messages,
      (message) =>
        message.type === 'terminal_lifecycle' &&
        message.sessionId === 'max-d' &&
        messageState(message) === 'unavailable',
    );
    expect(refused.data).toEqual({
      state: 'unavailable',
      readOnly: true,
      reason: 'max-terminals',
    });
    stream.stop();
  });
});
