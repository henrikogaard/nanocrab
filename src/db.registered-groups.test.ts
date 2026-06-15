import { describe, it, expect, beforeAll } from 'vitest';
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
