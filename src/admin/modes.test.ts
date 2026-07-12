import { describe, it, expect, beforeAll } from 'vitest';

// modes.js is a classic-script IIFE that assigns globalThis.NanoModes.
// Importing it for its side effect populates the global.
beforeAll(async () => {
  // @ts-expect-error -- classic browser script, no type declarations; imported for its side effect
  await import('./public/modes.js');
});

const M = () => (globalThis as any).NanoModes;

describe('MODES config', () => {
  it('exposes three modes in order', () => {
    expect(M().MODE_ORDER).toEqual(['chat', 'cowork', 'code']);
  });

  it('labels the top-level focus modes', () => {
    expect(M().MODES.chat.label).toBe('Chat');
    expect(M().MODES.cowork.label).toBe('Cowork');
    expect(M().MODES.code.label).toBe('Code');
  });

  it('describes when to use each focus mode', () => {
    expect(M().modeGuidance('chat')).toContain('Plain chat');
    expect(M().modeGuidance('cowork')).toContain('Projects, files');
    expect(M().modeGuidance('code')).toContain('Repos');
    expect(M().modeGuidance('unknown')).toBe('');
  });

  it('every mode page id is unique across modes', () => {
    const all = M().MODE_ORDER.flatMap((m: string) => M().MODES[m].pages);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('resolveMode', () => {
  it('maps a chat page to the chat mode', () => {
    expect(M().resolveMode('chat')).toBe('chat');
  });
  it('keeps cowork tools behind More instead of the primary Cowork route', () => {
    expect(M().resolveMode('approvals')).toBeNull();
    expect(M().MORE_IDS).toContain('approvals');
  });
  it('maps Projects to the cowork mode', () => {
    expect(M().resolveMode('projects')).toBe('cowork');
  });
  it('keeps document outputs in More while preserving Cowork access', () => {
    expect(M().resolveMode('reports')).toBeNull();
    expect(M().resolveMode('artifacts')).toBeNull();
    expect(M().navPagesForMode('cowork')).toEqual(['projects']);
    expect(M().MORE_IDS).toContain('reports');
    expect(M().MORE_IDS).toContain('artifacts');
  });
  it('maps hidden project chat routes to the cowork mode', () => {
    expect(M().resolveMode('project-chat')).toBe('cowork');
    expect(M().navPagesForMode('cowork')).not.toContain('project-chat');
  });
  it('maps a code page to the code mode', () => {
    expect(M().resolveMode('gitcode')).toBe('code');
  });
  it('keeps GitHub Copilot behind More while Code stays focused on the repo workspace', () => {
    expect(M().resolveMode('copilot')).toBeNull();
    expect(M().navPagesForMode('code')).toEqual(['gitcode']);
    expect(M().MORE_IDS).toContain('copilot');
  });
  it('returns null for an admin/ops (More) page', () => {
    expect(M().resolveMode('security')).toBeNull();
  });
  it('keeps personal knowledge pages in More', () => {
    expect(M().resolveMode('memory')).toBeNull();
    expect(M().resolveMode('skills')).toBeNull();
    expect(M().resolveMode('settings')).toBeNull();
    expect(M().MORE_IDS).toContain('settings');
  });
  it('keeps channel administration in More instead of a focus mode', () => {
    expect(M().resolveMode('channels')).toBeNull();
    expect(M().MORE_IDS).toContain('channels');
  });
  it('returns null for an unknown page', () => {
    expect(M().resolveMode('does-not-exist')).toBeNull();
  });
});

describe('navPagesForMode', () => {
  it('returns the page list for a mode (a copy, not the original)', () => {
    const pages = M().navPagesForMode('chat');
    expect(pages).toEqual(['chat']);
    pages.push('tampered');
    expect(M().MODES.chat.pages).toEqual(['chat']);
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
  it('migrates the previous work mode to cowork', () => {
    const s = mkStore();
    s.setItem('active_mode', 'work');
    expect(M().loadActiveMode(s)).toBe('cowork');
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
    expect(M().saveActiveMode('cowork', s)).toBe(true);
    expect(s.getItem('active_mode')).toBe('cowork');
  });
  it('rejects an invalid mode without writing', () => {
    const s = mkStore();
    expect(M().saveActiveMode('garbage', s)).toBe(false);
    expect(s.getItem('active_mode')).toBeNull();
  });
});

describe('storage-throws resilience', () => {
  it('loadActiveMode returns the first mode when storage.getItem throws', () => {
    const s = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {},
    };
    expect(M().loadActiveMode(s)).toBe('chat');
  });
  it('saveActiveMode returns false when storage.setItem throws', () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(M().saveActiveMode('work', s)).toBe(false);
  });
});
