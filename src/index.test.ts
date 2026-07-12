import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { Channel, NewMessage, RegisteredGroup } from './types.js';

vi.mock('./admin/index.js', () => ({
  initAdminServer: vi.fn(),
  broadcastMessage: vi.fn(),
}));

vi.mock('./db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db.js')>();
  return {
    ...actual,
    storeMessageDirect: vi.fn(),
  };
});

vi.mock('./channels/index.js', () => ({}));

vi.mock('./control-plane/commands.js', () => ({
  parseControlPlaneCommand: vi.fn(),
  executeControlPlaneCommand: vi.fn(),
  resetControlPlaneCommandCache: vi.fn(),
}));

vi.mock('./sender-allowlist.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sender-allowlist.js')>();
  return {
    ...actual,
    isSenderAllowed: vi.fn(),
  };
});

import { isSenderAllowed } from './sender-allowlist.js';
import {
  executeControlPlaneCommand,
  parseControlPlaneCommand,
} from './control-plane/commands.js';
import { processControlPlaneCommand } from './index.js';

function fakeChannel(): Channel {
  return {
    name: 'test',
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    sendMessage: vi.fn(),
    ownsJid: vi.fn(() => true),
  } as unknown as Channel;
}

function fakeGroup(trigger: string = '@Andy'): RegisteredGroup {
  return {
    name: 'Test',
    folder: 'test',
    trigger,
    isMain: false,
    added_at: '2024-01-01T00:00:00.000Z',
  };
}

function fakeMessage(content: string): NewMessage {
  return {
    id: 'm1',
    chat_jid: 'test:123',
    sender: 'u1',
    sender_name: 'Alice',
    content,
    timestamp: '2026-07-12T10:00:00.000Z',
    is_from_me: false,
  };
}

describe('processControlPlaneCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects and executes a control-plane command', async () => {
    vi.mocked(parseControlPlaneCommand).mockReturnValue({
      action: 'status',
      issueNumber: 128,
    });
    vi.mocked(executeControlPlaneCommand).mockResolvedValue({
      text: 'Issue henrikogaard/nanocrab#128 is in planning stage.',
      decisionId: null,
      actions: [],
    });
    vi.mocked(isSenderAllowed).mockReturnValue(true);

    const channel = fakeChannel();
    const result = await processControlPlaneCommand(
      channel,
      'test:123',
      fakeGroup('@Andy'),
      [fakeMessage('@Andy status #128')],
    );

    expect(result).toBe(true);
    expect(parseControlPlaneCommand).toHaveBeenCalledWith('@Andy status #128', {
      trigger: '@Andy',
    });
    expect(executeControlPlaneCommand).toHaveBeenCalledWith(
      { action: 'status', issueNumber: 128 },
      expect.objectContaining({
        channel: 'test',
        chatJid: 'test:123',
        senderId: 'u1',
        senderName: 'Alice',
        isAuthorized: true,
        actor: 'owner',
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith(
      'test:123',
      expect.stringContaining('planning stage'),
    );
  });

  it('returns false for non-control-plane messages', async () => {
    vi.mocked(parseControlPlaneCommand).mockReturnValue(null);

    const channel = fakeChannel();
    const result = await processControlPlaneCommand(
      channel,
      'test:123',
      fakeGroup(),
      [fakeMessage('hello there')],
    );

    expect(result).toBe(false);
    expect(executeControlPlaneCommand).not.toHaveBeenCalled();
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('passes unauthorized state to execute', async () => {
    vi.mocked(parseControlPlaneCommand).mockReturnValue({
      action: 'approve',
      issueNumber: 128,
      targetStage: 'implement',
    });
    vi.mocked(executeControlPlaneCommand).mockResolvedValue({
      text: 'Unauthorized. Only authorized operators may approve test:123#128.',
      decisionId: null,
      actions: [],
    });
    vi.mocked(isSenderAllowed).mockReturnValue(false);

    const channel = fakeChannel();
    const result = await processControlPlaneCommand(
      channel,
      'test:123',
      fakeGroup(),
      [fakeMessage('@Andy approve #128 to implement')],
    );

    expect(result).toBe(true);
    expect(executeControlPlaneCommand).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approve', issueNumber: 128 }),
      expect.objectContaining({
        isAuthorized: false,
        actor: 'u1',
      }),
    );
    expect(channel.sendMessage).toHaveBeenCalled();
  });
});
