import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    channel = new SignalChannel('+4712345678', mockOpts as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isConnected returns false before connect', () => {
    expect(channel.isConnected()).toBe(false);
  });

  it('isConnected returns false after disconnect without connecting', async () => {
    await channel.disconnect();
    expect(channel.isConnected()).toBe(false);
  });

  it('startDaemon sets connected = true on RPC readiness', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: 'v1.2.3' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await channel.connect();

    expect(channel.isConnected()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/rpc'),
      expect.any(Object),
    );
  });
});
