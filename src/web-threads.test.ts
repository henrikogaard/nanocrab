import { describe, it, expect } from 'vitest';
import { isWebJid, newWebJid, buildThreadGroup } from './web-threads.js';
import type { ContainerConfig } from './types.js';

describe('isWebJid', () => {
  it('matches only web: jids', () => {
    expect(isWebJid('web:abc')).toBe(true);
    expect(isWebJid('123@g.us')).toBe(false);
    expect(isWebJid('')).toBe(false);
  });
});

describe('newWebJid', () => {
  it('produces a unique web: jid', () => {
    const a = newWebJid();
    const b = newWebJid();
    expect(a.startsWith('web:')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('buildThreadGroup', () => {
  it('builds an isolated web group from a template config', () => {
    const jid = 'web:fixed-id';
    const g = buildThreadGroup({
      jid,
      title: 'Deploy review',
      addedAt: '2026-06-15T00:00:00Z',
      config: {
        provider: 'codex',
        model: 'gpt-5.4',
        allowedMcpServers: ['nanocrab'],
      },
    });
    expect(g.kind).toBe('web');
    expect(g.title).toBe('Deploy review');
    expect(g.requiresTrigger).toBe(false);
    expect(g.enabled).toBe(true);
    expect(g.isMain).toBeFalsy();
    expect(g.folder).toBe('web-fixed-id');
    expect(g.containerConfig).toEqual({
      provider: 'codex',
      model: 'gpt-5.4',
      allowedMcpServers: ['nanocrab'],
    });
  });

  it('leaves title unset and tolerates no config', () => {
    const g = buildThreadGroup({
      jid: 'web:x',
      addedAt: '2026-06-15T00:00:00Z',
    });
    expect(g.title).toBeUndefined();
    expect(g.containerConfig).toBeUndefined();
    expect(g.folder).toBe('web-x');
  });

  it('does not mutate the source config (deep clone)', () => {
    const config: ContainerConfig = {
      provider: 'codex',
      model: 'gpt-5.4',
      allowedMcpServers: ['nanocrab'],
    };
    const g = buildThreadGroup({
      jid: 'web:iso',
      addedAt: '2026-06-15T00:00:00Z',
      config,
    });
    (g.containerConfig!.allowedMcpServers as string[]).push('tampered');
    g.containerConfig!.provider = 'openai-compatible';
    expect(config.allowedMcpServers).toEqual(['nanocrab']);
    expect(config.provider).toBe('codex');
  });

  it('leaves a whitespace-only title unset', () => {
    const g = buildThreadGroup({
      jid: 'web:ws',
      title: '   ',
      addedAt: '2026-06-15T00:00:00Z',
    });
    expect(g.title).toBeUndefined();
  });

  it('throws on a non-web jid', () => {
    expect(() =>
      buildThreadGroup({ jid: '123@g.us', addedAt: '2026-06-15T00:00:00Z' }),
    ).toThrow();
  });
});
