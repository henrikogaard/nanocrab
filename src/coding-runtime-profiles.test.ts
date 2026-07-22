import { afterEach, describe, expect, it, vi } from 'vitest';

const store = `/tmp/nanocrab-runtime-profiles-${Date.now()}`;

vi.mock('./config.js', () => ({
  STORE_DIR: store,
  DEVIN_CLI_MODEL_ALIASES: {
    'claude/claude-sonnet-4-6': 'claude-sonnet-4',
  },
}));

const {
  buildCodingRuntimeProfile,
  deleteCodingRuntimeProfile,
  getCodingRuntimeProfile,
  listCodingRuntimeProfiles,
  resolveCodingRuntimeProfile,
  saveCodingRuntimeProfile,
  isBuiltInCodingRuntimeProfile,
} = await import('./coding-runtime-profiles.js');

describe('coding runtime profiles', () => {
  afterEach(() => {
    for (const profile of listCodingRuntimeProfiles()) {
      if (!isBuiltInCodingRuntimeProfile(profile.id)) {
        deleteCodingRuntimeProfile(profile.id);
      }
    }
  });

  it('exposes a safe default profile backed by the coding provider default', () => {
    const profile = getCodingRuntimeProfile('default');
    expect(profile).toMatchObject({
      id: 'default',
      label: 'Default coding runtime',
      runtime: expect.objectContaining({
        cli: expect.any(String),
        provider: expect.any(String),
        model: expect.any(String),
      }),
      enabled: true,
    });
    expect(listCodingRuntimeProfiles().map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'claude-default',
        'codex-default',
        'opencode-default',
      ]),
    );
  });

  it('validates and persists a named profile', () => {
    const profile = buildCodingRuntimeProfile({
      id: 'local-opencode',
      label: 'Local OpenCode',
      description: 'Use the local coding model',
      runtime: { cli: 'opencode', provider: 'ollama', model: 'qwen3-coder' },
    });
    expect(saveCodingRuntimeProfile(profile)).toMatchObject({
      id: profile.id,
      label: profile.label,
      runtime: profile.runtime,
      enabled: profile.enabled,
    });
    expect(resolveCodingRuntimeProfile('local-opencode')).toEqual(
      profile.runtime,
    );
    expect(resolveCodingRuntimeProfile(' LOCAL-OPENCODE ')).toEqual(
      profile.runtime,
    );
  });

  it('rejects incompatible or malformed profiles', () => {
    expect(() =>
      buildCodingRuntimeProfile({
        id: 'bad profile',
        label: 'Bad',
        runtime: { cli: 'opencode', provider: 'claude', model: 'x' },
      }),
    ).toThrow(/id|compatible/i);
  });

  it('fails closed for unknown profiles', () => {
    expect(() => resolveCodingRuntimeProfile('missing')).toThrow(
      /coding runtime profile not found/i,
    );
  });

  it('keeps disabled profiles visible for an operator to re-enable', () => {
    const profile = buildCodingRuntimeProfile({
      id: 'paused-codex',
      label: 'Paused Codex',
      enabled: false,
      runtime: { cli: 'codex', provider: 'codex', model: 'gpt-5.4' },
    });
    saveCodingRuntimeProfile(profile);
    expect(getCodingRuntimeProfile('paused-codex')).toMatchObject({
      enabled: false,
    });
    expect(() => resolveCodingRuntimeProfile('paused-codex')).toThrow(
      /disabled/i,
    );
  });

  it('does not expose an unverified Cursor profile by default', () => {
    expect(
      listCodingRuntimeProfiles().map((profile) => profile.id),
    ).not.toContain('cursor-default');
  });

  it('accepts an explicitly configured Cursor profile without making it healthy', () => {
    const profile = buildCodingRuntimeProfile({
      id: 'cursor-host',
      label: 'Cursor Agent (host isolated)',
      runtime: { cli: 'cursor', provider: 'cursor', model: 'gpt-5' },
    });
    expect(saveCodingRuntimeProfile(profile)).toMatchObject({
      id: 'cursor-host',
      runtime: { cli: 'cursor', provider: 'cursor', model: 'gpt-5' },
    });
  });
});
