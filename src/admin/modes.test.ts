import { describe, it, expect, beforeAll } from 'vitest';

// modes.js is a classic-script IIFE that assigns globalThis.NanoModes.
// Importing it for its side effect populates the global.
beforeAll(async () => {
  await import('./public/modes.js');
});

const M = () => (globalThis as any).NanoModes;

describe('MODES config', () => {
  it('exposes three modes in order', () => {
    expect(M().MODE_ORDER).toEqual(['chat', 'work', 'code']);
  });

  it('every mode page id is unique across modes', () => {
    const all = M().MODE_ORDER.flatMap((m: string) => M().MODES[m].pages);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('resolveMode', () => {
  it('maps a chat page to the chat mode', () => {
    expect(M().resolveMode('messages')).toBe('chat');
  });
  it('maps a work page to the work mode', () => {
    expect(M().resolveMode('approvals')).toBe('work');
  });
  it('maps a code page to the code mode', () => {
    expect(M().resolveMode('gitcode')).toBe('code');
  });
  it('returns null for an admin/ops (More) page', () => {
    expect(M().resolveMode('security')).toBeNull();
  });
  it('returns null for an unknown page', () => {
    expect(M().resolveMode('does-not-exist')).toBeNull();
  });
});

describe('navPagesForMode', () => {
  it('returns the page list for a mode (a copy, not the original)', () => {
    const pages = M().navPagesForMode('chat');
    expect(pages).toEqual(['chat', 'messages']);
    pages.push('tampered');
    expect(M().MODES.chat.pages).toEqual(['chat', 'messages']);
  });
  it('returns an empty array for an unknown mode', () => {
    expect(M().navPagesForMode('nope')).toEqual([]);
  });
});

function mkStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('loadActiveMode', () => {
  it('defaults to the first mode when storage is empty', () => {
    expect(M().loadActiveMode(mkStore())).toBe('chat');
  });
  it('returns the saved mode when valid', () => {
    const s = mkStore();
    s.setItem('active_mode', 'code');
    expect(M().loadActiveMode(s)).toBe('code');
  });
  it('falls back to the first mode when saved value is invalid', () => {
    const s = mkStore();
    s.setItem('active_mode', 'garbage');
    expect(M().loadActiveMode(s)).toBe('chat');
  });
});

describe('saveActiveMode', () => {
  it('persists a valid mode and reports success', () => {
    const s = mkStore();
    expect(M().saveActiveMode('work', s)).toBe(true);
    expect(s.getItem('active_mode')).toBe('work');
  });
  it('rejects an invalid mode without writing', () => {
    const s = mkStore();
    expect(M().saveActiveMode('garbage', s)).toBe(false);
    expect(s.getItem('active_mode')).toBeNull();
  });
});

describe('storage-throws resilience', () => {
  it('loadActiveMode returns the first mode when storage.getItem throws', () => {
    const s = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(M().loadActiveMode(s)).toBe('chat');
  });
  it('saveActiveMode returns false when storage.setItem throws', () => {
    const s = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    expect(M().saveActiveMode('work', s)).toBe(false);
  });
});
