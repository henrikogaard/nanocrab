import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as db from './db.js';

describe('registered group kind/title round-trip', () => {
  beforeAll(() => {
    // db.js opens its database on import; tests use the same instance.
  });

  it('persists and reads back kind and title', () => {
    const jid = 'web:test-kind-title';
    db.setRegisteredGroup(jid, {
      name: 'Web Conversation',
      title: 'My thread',
      kind: 'web',
      folder: 'web-chat-test-kind-title',
      trigger: '^',
      added_at: new Date('2026-06-15T00:00:00Z').toISOString(),
      requiresTrigger: false,
    });
    const all = db.getAllRegisteredGroups();
    expect(all[jid].kind).toBe('web');
    expect(all[jid].title).toBe('My thread');
    const one = db.getRegisteredGroup(jid);
    expect(one?.kind).toBe('web');
    expect(one?.title).toBe('My thread');
  });

  it('reads a non-web group with kind undefined', () => {
    const jid = 'plain:test-no-kind';
    db.setRegisteredGroup(jid, {
      name: 'Plain',
      folder: 'plain-test-no-kind',
      trigger: '^',
      added_at: new Date('2026-06-15T00:00:00Z').toISOString(),
    });
    expect(db.getAllRegisteredGroups()[jid].kind).toBeUndefined();
  });
});

describe('web vs non-web partition', () => {
  it('getNonWebRegisteredGroups excludes web threads; getWebThreads returns only web', () => {
    const webJid = 'web:partition-1';
    const realJid = 'real:partition-2';
    db.setRegisteredGroup(webJid, {
      name: 'Web', title: 'T', kind: 'web', folder: 'web-partition-1',
      trigger: '^', added_at: '2026-06-15T00:00:00Z', requiresTrigger: false,
    });
    db.setRegisteredGroup(realJid, {
      name: 'Real', folder: 'real-partition-2', trigger: '^',
      added_at: '2026-06-15T00:00:00Z',
    });
    const nonWeb = db.getNonWebRegisteredGroups();
    expect(nonWeb[webJid]).toBeUndefined();
    expect(nonWeb[realJid]).toBeDefined();
    const web = db.getWebThreads();
    expect(web[webJid]).toBeDefined();
    expect(web[realJid]).toBeUndefined();
  });
});

describe('deleteRegisteredGroup round-trip', () => {
  beforeEach(() => {
    try { db._closeDatabase(); } catch { /* may not be initialized */ }
    db._initTestDatabase();
  });
  afterEach(() => {
    try { db._closeDatabase(); } catch { /* ok */ }
  });

  it('deletes a group so getRegisteredGroup returns undefined and it is absent from getAllRegisteredGroups', () => {
    const jid = 'web:delete-roundtrip';
    db.setRegisteredGroup(jid, {
      name: 'Web Conversation',
      title: 'To be deleted',
      kind: 'web',
      folder: 'web-delete-roundtrip',
      trigger: '^',
      added_at: '2026-06-15T00:00:00Z',
      requiresTrigger: false,
    });

    // Sanity: confirm it was stored
    expect(db.getRegisteredGroup(jid)).toBeDefined();

    db.deleteRegisteredGroup(jid);

    expect(db.getRegisteredGroup(jid)).toBeUndefined();
    expect(db.getAllRegisteredGroups()[jid]).toBeUndefined();
  });

  it('deleting a non-existent jid does not throw', () => {
    expect(() => db.deleteRegisteredGroup('web:no-such-thread')).not.toThrow();
  });
});

describe('deleteMessagesForJid round-trip', () => {
  beforeEach(() => {
    try { db._closeDatabase(); } catch { /* may not be initialized */ }
    db._initTestDatabase();
  });
  afterEach(() => {
    try { db._closeDatabase(); } catch { /* ok */ }
  });

  it('deleteMessagesForJid with no messages does not throw', () => {
    expect(() => db.deleteMessagesForJid('web:no-messages-here')).not.toThrow();
  });

  it('deletes stored messages so storeMessage + deleteMessagesForJid leaves no rows', () => {
    const jid = 'web:msgs-delete-test';

    // Store a chat row (required by FK constraint) and a message
    db.storeMessageDirect({
      id: 'msg-1',
      chat_jid: jid,
      sender: 'user',
      sender_name: 'Tester',
      content: 'Hello world',
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    });

    // deleteMessagesForJid should delete the message and the chat row without error
    expect(() => db.deleteMessagesForJid(jid)).not.toThrow();

    // After deletion no new messages should be retrievable for that jid
    // (We verify via getNewMessages which is exported and accepts an array of jids)
    const { messages } = db.getNewMessages([jid], '1970-01-01T00:00:00.000Z', '__bot__', 100);
    expect(messages).toHaveLength(0);
  });
});
