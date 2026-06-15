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
