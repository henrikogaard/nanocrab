import { describe, expect, it } from 'vitest';
import {
  normalizeGeneratedThreadTitle,
  needsGeneratedThreadTitle,
  withThreadTitleRequest,
} from './web-thread-title.js';
import type { RegisteredGroup } from './types.js';

function webGroup(title?: string): RegisteredGroup {
  return {
    name: 'Web Conversation',
    folder: 'web-test',
    trigger: '^',
    added_at: '2026-06-17T00:00:00Z',
    kind: 'web',
    requiresTrigger: false,
    ...(title !== undefined ? { title } : {}),
  };
}

describe('needsGeneratedThreadTitle', () => {
  it('requests generated titles only for untitled web threads', () => {
    expect(needsGeneratedThreadTitle(webGroup())).toBe(true);
    expect(needsGeneratedThreadTitle(webGroup('   '))).toBe(true);
    expect(needsGeneratedThreadTitle(webGroup('Launch notes'))).toBe(false);
    expect(needsGeneratedThreadTitle({ ...webGroup(), kind: undefined })).toBe(
      false,
    );
  });
});

describe('withThreadTitleRequest', () => {
  it('prepends a hidden marker instruction for untitled web threads', () => {
    const prompt = withThreadTitleRequest('User: hello', webGroup());

    expect(prompt).toContain('<thread_title title="');
    expect(prompt).toContain('User: hello');
  });

  it('leaves titled threads untouched', () => {
    expect(
      withThreadTitleRequest('User: hello', webGroup('Launch notes')),
    ).toBe('User: hello');
  });
});

describe('normalizeGeneratedThreadTitle', () => {
  it('trims quotes, tags, and excessive length', () => {
    expect(normalizeGeneratedThreadTitle(' "<b>Deploy Plan Review</b>" ')).toBe(
      'Deploy Plan Review',
    );
    expect(normalizeGeneratedThreadTitle('a'.repeat(90))).toHaveLength(60);
  });

  it('rejects empty titles', () => {
    expect(normalizeGeneratedThreadTitle('   ')).toBeNull();
  });
});
