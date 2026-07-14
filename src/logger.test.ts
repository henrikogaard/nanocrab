import { describe, expect, it } from 'vitest';

import { createStreamingLogRedactor, redactLogString } from './logger.js';

function everySplit(value: string): Array<[string, string]> {
  return Array.from({ length: value.length + 1 }, (_, index) => [
    value.slice(0, index),
    value.slice(index),
  ]);
}

describe('createStreamingLogRedactor', () => {
  it.each([
    'Authorization: Bearer abc.def.ghi',
    'OPENAI_API_KEY=sk-secret-token-value',
    'cookie=session-value-123456',
  ])('redacts pattern secrets across every chunk boundary: %s', (secret) => {
    for (const [left, right] of everySplit(secret)) {
      const redactor = createStreamingLogRedactor();
      const persisted =
        redactor.write(left) + redactor.write(right) + redactor.flush();
      expect(persisted).not.toContain(secret.split(/[:=]\s*/).at(-1));
      expect(persisted).toContain('[REDACTED]');
    }
  });

  it('redacts known literals across every boundary and ignores short values', () => {
    const secret = 'github-token-123456';
    for (const [left, right] of everySplit(secret)) {
      const redactor = createStreamingLogRedactor({
        knownSecrets: [secret, 'short'],
      });
      const persisted =
        redactor.write(left) + redactor.write(right) + redactor.flush();
      expect(persisted).not.toContain(secret);
      expect(persisted).toContain('[REDACTED]');
    }

    const redactor = createStreamingLogRedactor({ knownSecrets: ['short'] });
    expect(redactor.write('short') + redactor.flush()).toBe('short');
  });

  it('redacts a self-overlapping known literal across every boundary', () => {
    const secret = 'aaaaaaaa';
    for (const [left, right] of everySplit(secret)) {
      const redactor = createStreamingLogRedactor({ knownSecrets: [secret] });
      const persisted =
        redactor.write(left) + redactor.write(right) + redactor.flush();
      expect(persisted).toBe('[REDACTED]');
      expect(persisted).not.toContain(secret);
    }
  });

  it('flush emits a safe suffix exactly once', () => {
    const redactor = createStreamingLogRedactor();
    expect(redactor.write('Authorization: Bearer final-token')).toBe(
      'Authorization: ',
    );
    expect(redactor.flush()).toBe('Bearer [REDACTED]');
    expect(redactor.flush()).toBe('');
  });

  it('throws when write is called after flush', () => {
    const redactor = createStreamingLogRedactor();
    redactor.flush();
    expect(() => redactor.write('later')).toThrow(
      'Cannot write after streaming log redactor has been flushed',
    );
  });

  it('does not share carry between stdout and stderr instances', () => {
    const stdout = createStreamingLogRedactor();
    const stderr = createStreamingLogRedactor();

    expect(stdout.write('Authorization: Bearer stdout-secret')).toBe(
      'Authorization: ',
    );
    expect(stderr.write('ordinary stderr\n')).toBe('ordinary stderr\n');
    expect(stderr.flush()).toBe('');
    expect(stdout.flush()).toBe('Bearer [REDACTED]');
  });

  it('redacts an open token when the carry limit is reached', () => {
    const redactor = createStreamingLogRedactor({ carryLength: 16 });

    const persisted = redactor.write('Bearer token-without-delimiter');

    expect(persisted).toBe('Bearer [REDACTED]');
    expect(redactor.flush()).toBe('');
  });

  it('discards an overflowing open token until its delimiter', () => {
    const redactor = createStreamingLogRedactor({ carryLength: 16 });

    const persisted =
      redactor.write('Bearer abcdefghi') +
      redactor.write('jklmnop ') +
      redactor.flush();

    expect(persisted).toBe('Bearer [REDACTED] ');
    expect(persisted).not.toContain('jklmnop');
    expect(persisted).not.toContain('abcdefghijklmnop');
  });
});

describe('redactLogString', () => {
  it('retains complete-string redaction behavior', () => {
    expect(redactLogString('Bearer abc.def.ghi')).toBe('Bearer [REDACTED]');
    expect(redactLogString('sk-secret-token-value')).toBe('sk-[REDACTED]');
    expect(redactLogString('/__nanocrab/providers/openai/path')).toBe(
      '/__nanocrab/providers/[REDACTED]',
    );
    expect(redactLogString('cookie=session-value-123456')).toBe(
      'cookie=[REDACTED]',
    );
  });
});
