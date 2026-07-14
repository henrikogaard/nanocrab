import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env.js', () => ({
  readEnvFile: () => ({}),
}));

import {
  CONTAINER_TIMEOUT,
  DEVIN_BUILTIN_MODEL_ALIASES,
  parseDevinCliModelAliases,
  parsePositiveMilliseconds,
} from './config.js';

describe('Devin runner configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('merges operator Devin aliases without overriding built-ins', () => {
    expect(
      parseDevinCliModelAliases(
        JSON.stringify({ 'claude/claude-haiku-4-5': 'claude-haiku-4.5' }),
      ),
    ).toEqual({
      'claude/claude-sonnet-4-6': 'claude-sonnet-4',
      'claude/claude-opus-4-6': 'claude-opus-4.6',
      'claude/claude-haiku-4-5': 'claude-haiku-4.5',
    });
  });

  it.each([
    ['[]', 'must be a JSON object'],
    ['{"unknown/model":"alias"}', 'unknown provider'],
    ['{"claude/claude-sonnet-4-6":"replacement"}', 'cannot override built-in'],
    ['{"claude/model":""}', 'non-empty string'],
  ])('rejects invalid DEVIN_CLI_MODEL_ALIASES_JSON %s', (raw, message) => {
    expect(() => parseDevinCliModelAliases(raw)).toThrow(message);
  });

  it('returns an immutable alias map', () => {
    expect(Object.isFrozen(DEVIN_BUILTIN_MODEL_ALIASES)).toBe(true);
    expect(Object.isFrozen(parseDevinCliModelAliases(undefined))).toBe(true);
  });

  it.each([
    [undefined, CONTAINER_TIMEOUT],
    ['45000', 45000],
  ])('parses positive millisecond value %s', (raw, expected) => {
    expect(
      parsePositiveMilliseconds(raw, CONTAINER_TIMEOUT, 'TEST_TIMEOUT_MS'),
    ).toBe(expected);
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '1.5'])(
    'rejects invalid positive millisecond value %s',
    (raw) => {
      expect(() =>
        parsePositiveMilliseconds(raw, CONTAINER_TIMEOUT, 'TEST_TIMEOUT_MS'),
      ).toThrow('TEST_TIMEOUT_MS');
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    'rejects invalid fallback millisecond value %s',
    (fallback) => {
      expect(() =>
        parsePositiveMilliseconds(undefined, fallback, 'TEST_TIMEOUT_MS'),
      ).toThrow('TEST_TIMEOUT_MS');
    },
  );

  it('uses null when DEVIN_CREDENTIAL_PATH is omitted', async () => {
    vi.stubEnv('DEVIN_CREDENTIAL_PATH', '');

    const { DEVIN_CREDENTIAL_PATH } = await import('./config.js');

    expect(DEVIN_CREDENTIAL_PATH).toBeNull();
  });

  it('rejects a relative DEVIN_CREDENTIAL_PATH', async () => {
    vi.stubEnv('DEVIN_CREDENTIAL_PATH', '.config/devin/credentials.json');

    await expect(import('./config.js')).rejects.toThrow(
      'DEVIN_CREDENTIAL_PATH must be an absolute path',
    );
  });
});
