import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket } from 'ws';

const TEST_DIR = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('path').join(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('os').tmpdir(),
    `nanocrab-terminal-auth-${Date.now()}`,
  ),
);

vi.mock('../config.js', () => ({
  SESSIONS_DIR: TEST_DIR,
  TERMINAL_IDLE_TIMEOUT_MS: 7200000,
  MAX_SESSION_LOG_BYTES: 1024 * 1024,
  MAX_SESSION_RETENTION_DAYS: 90,
  MAX_SESSIONS_COUNT: 100,
  SESSION_PRUNE_INTERVAL_MS: 3600000,
}));

vi.mock('../logger.js', () => ({
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
  getSessionUser: vi.fn((token: string) => {
    if (token === 'viewer') {
      return { id: 'viewer', username: 'viewer', role: 'viewer' };
    }
    if (token === 'admin') {
      return { id: 'admin', username: 'admin', role: 'admin' };
    }
    if (token === 'owner-bob') {
      return { id: 'bob', username: 'bob', role: 'owner' };
    }
    return { id: 'alice', username: 'alice', role: 'owner' };
  }),
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
  data: unknown;
  sessionId?: string;
};

async function connect(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return ws;
}

async function collectAfter(
  ws: WebSocket,
  messages: Array<Record<string, unknown>>,
): Promise<ServerMessage[]> {
  const received: ServerMessage[] = [];
  const listener = (raw: Buffer) => {
    received.push(JSON.parse(raw.toString()) as ServerMessage);
  };
  ws.on('message', listener);
  for (const message of messages) ws.send(JSON.stringify(message));
  await new Promise((resolve) => setTimeout(resolve, 75));
  ws.off('message', listener);
  return received;
}

describe('terminal websocket authorization', () => {
  let server: http.Server;
  let port: number;
  const clients: WebSocket[] = [];

  beforeAll(async () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(TEST_DIR, 'index.json'),
      JSON.stringify([
        {
          id: 'alice-history',
          name: 'alice-history',
          owner: 'alice',
          createdAt: '2026-07-01T10:00:00.000Z',
          endedAt: '2026-07-01T11:00:00.000Z',
          bytes: 18,
        },
      ]),
    );
    fs.writeFileSync(
      path.join(TEST_DIR, 'alice-history.log'),
      'private transcript\n',
    );

    server = http.createServer();
    initWebSocket(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not bind to a port');
    }
    port = address.port;
  });

  afterAll(async () => {
    for (const client of clients) client.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it.each(['viewer', 'admin'])(
    'denies every terminal operation to a %s client',
    async (role) => {
      const ws = await connect(port, role);
      clients.push(ws);
      const messages = await collectAfter(ws, [
        { type: 'terminal_spawn', data: 'new-session' },
        { type: 'terminal_attach', sessionId: 'alice-history' },
        { type: 'terminal_input', sessionId: 'alice-history', data: 'pwd\n' },
        { type: 'terminal_close', sessionId: 'alice-history' },
      ]);

      expect(
        messages
          .filter((message) => message.type === 'terminal_denied')
          .map((message) => (message.data as { operation: string }).operation),
      ).toEqual(['spawn', 'attach', 'input', 'close']);
      expect(JSON.stringify(messages)).not.toContain('private transcript');
    },
  );

  it('denies attach, input, and close to a different owner', async () => {
    const ws = await connect(port, 'owner-bob');
    clients.push(ws);
    const messages = await collectAfter(ws, [
      { type: 'terminal_attach', sessionId: 'alice-history' },
      { type: 'terminal_input', sessionId: 'alice-history', data: 'pwd\n' },
      { type: 'terminal_close', sessionId: 'alice-history' },
    ]);

    expect(
      messages
        .filter((message) => message.type === 'terminal_denied')
        .map((message) => (message.data as { operation: string }).operation),
    ).toEqual(['attach', 'input', 'close']);
    expect(JSON.stringify(messages)).not.toContain('private transcript');
  });

  it('returns an explicit read-only historical attach result to the owner', async () => {
    const ws = await connect(port, 'owner-alice');
    clients.push(ws);
    const messages = await collectAfter(ws, [
      { type: 'terminal_attach', sessionId: 'alice-history' },
    ]);

    expect(messages).toContainEqual({
      type: 'terminal_attach_result',
      sessionId: 'alice-history',
      data: { status: 'historical', readOnly: true },
    });
    expect(JSON.stringify(messages)).toContain('private transcript');
  });
});
