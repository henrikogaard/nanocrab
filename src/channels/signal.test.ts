import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execSync, spawn } from 'child_process';

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({ SIGNAL_PHONE_NUMBER: '+4712345678' })),
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const { EventEmitter } = require('events');
    const { PassThrough } = require('stream');
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
  }),
  execSync: vi.fn(() => ''),
}));

import { SignalChannel } from './signal.js';

describe('SignalChannel connection status', () => {
  let channel: SignalChannel;
  const mockOpts = {
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: vi.fn(() => ({})),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new SignalChannel('+4712345678', mockOpts as any);
  });

  afterEach(async () => {
    await channel.disconnect();
    vi.unstubAllGlobals();
  });

  it('isConnected returns false before connect', () => {
    expect(channel.isConnected()).toBe(false);
  });

  it('isConnected returns false after disconnect without connecting', async () => {
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('reuses an existing RPC-ready daemon without killing host daemons', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/events')) {
        return eventResponse('');
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 'v1.2.3' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(channel.getStatus()).toMatchObject({
      connected: true,
      status: 'healthy',
      reason: 'signal-cli RPC endpoint is ready',
    });
    expect(channel.getStatus().lastActiveAt).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/rpc'),
      expect.any(Object),
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(execSync).not.toHaveBeenCalled();
  });

  it('delivers Signal HTTP event stream messages to onMessage', async () => {
    mockOpts.registeredGroups.mockReturnValue({
      'sig:+4747303055': {
        jid: 'sig:+4747303055',
        name: 'Henrik Signal',
        folder: 'signal_main',
        trigger: '@Taskekrabben',
        enabled: true,
      },
    });

    const event = {
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        envelope: {
          sourceNumber: '+4747303055',
          sourceUuid: '9d83cde4-e0c4-4676-a04d-9a14328e5356',
          sourceName: 'Henrik',
          timestamp: 1782255000000,
          dataMessage: {
            timestamp: 1782255000000,
            message: 'Har jeg noen nye mailer?',
          },
        },
        account: '+4712345678',
      },
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/events')) {
        return eventResponse(`data: ${JSON.stringify(event)}\n\n`);
      }
      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: 1, result: 'v1.2.3' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await channel.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockOpts.onChatMetadata).toHaveBeenCalledWith(
      'sig:+4747303055',
      '2026-06-23T22:50:00.000Z',
      'Henrik',
      'signal',
      false,
    );
    expect(mockOpts.onMessage).toHaveBeenCalledWith(
      'sig:+4747303055',
      expect.objectContaining({
        chat_jid: 'sig:+4747303055',
        sender: '+4747303055',
        sender_name: 'Henrik',
        content: 'Har jeg noen nye mailer?',
        is_from_me: false,
      }),
    );
  });

  it('resolves UUID-only direct messages to a registered phone JID', async () => {
    mockOpts.registeredGroups.mockReturnValue({
      'sig:+4747303055': {
        jid: 'sig:+4747303055',
        name: 'Henrik Signal',
        folder: 'signal_main',
        trigger: '@Taskekrabben',
        enabled: true,
      },
    });

    const uuid = '9d83cde4-e0c4-4676-a04d-9a14328e5356';
    const event = {
      jsonrpc: '2.0',
      method: 'receive',
      params: {
        envelope: {
          sourceUuid: uuid,
          sourceName: 'Henrik',
          timestamp: 1782255060000,
          dataMessage: {
            timestamp: 1782255060000,
            message: '@Taskekrabben ping',
          },
        },
        account: '+4712345678',
      },
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v1/events')) {
        return eventResponse(`data: ${JSON.stringify(event)}\n\n`);
      }

      const body =
        typeof init?.body === 'string'
          ? JSON.parse(init.body)
          : { method: 'version' };
      if (body.method === 'listContacts') {
        return {
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: body.id,
            result: [{ uuid, number: '+4747303055' }],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ jsonrpc: '2.0', id: body.id, result: 'v1.2.3' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    await channel.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mockOpts.onMessage).toHaveBeenCalledWith(
      'sig:+4747303055',
      expect.objectContaining({
        chat_jid: 'sig:+4747303055',
        sender: '+4747303055',
        sender_name: 'Henrik',
        content: '@Taskekrabben ping',
      }),
    );
  });

  it('reports a diagnostic reason after disconnect', async () => {
    await channel.disconnect();

    expect(channel.getStatus()).toMatchObject({
      connected: false,
      status: 'down',
      lastActiveAt: null,
      reason: 'Signal channel disconnected',
    });
  });
});

function eventResponse(data: string) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        if (data) controller.enqueue(new TextEncoder().encode(data));
        controller.close();
      },
    }),
  };
}
