import { describe, expect, it } from 'vitest';
import { formatOutbound } from './router.js';

describe('formatOutbound', () => {
  it('strips internal tags and preserves plain text', () => {
    expect(formatOutbound('hello world', 'wa:123')).toBe('hello world');
  });

  it('returns empty string when only internal tags are present', () => {
    expect(formatOutbound('<internal>hidden</internal>', 'wa:123')).toBe('');
  });

  it('strips markdown for Signal messages', () => {
    expect(formatOutbound('**Status** update', 'sig:123')).toBe(
      'Status update',
    );
    expect(formatOutbound('[link](http://example.com)', 'sig:123')).toBe(
      'link (http://example.com)',
    );
    expect(formatOutbound('Some `code` here', 'sig:123')).toBe(
      'Some code here',
    );
  });

  it('preserves markdown for non-Signal channels', () => {
    expect(formatOutbound('**Status** update', 'dc:123')).toBe(
      '**Status** update',
    );
    expect(formatOutbound('**Status** update', 'tg:123')).toBe(
      '**Status** update',
    );
    expect(formatOutbound('**Status** update', 'wa:123')).toBe(
      '**Status** update',
    );
  });
});
