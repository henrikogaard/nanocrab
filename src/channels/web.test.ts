import { describe, it, expect, vi } from 'vitest';
import { createWebChannel } from './web.js';

const opts = {
  onMessage: vi.fn(),
  onChatMetadata: vi.fn(),
  registeredGroups: () => ({}),
};

describe('web channel', () => {
  it('owns only web: jids', () => {
    const ch = createWebChannel(opts);
    expect(ch.ownsJid('web:abc')).toBe(true);
    expect(ch.ownsJid('123@g.us')).toBe(false);
  });

  it('is always connected and sendMessage is a no-op that resolves', async () => {
    const ch = createWebChannel(opts);
    expect(ch.isConnected()).toBe(true);
    await expect(ch.sendMessage('web:abc', 'hi')).resolves.toBeUndefined();
  });

  it('connect/disconnect resolve without error', async () => {
    const ch = createWebChannel(opts);
    await expect(ch.connect()).resolves.toBeUndefined();
    await expect(ch.disconnect()).resolves.toBeUndefined();
  });
});
