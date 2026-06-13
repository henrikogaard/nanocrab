import { describe, expect, it } from 'vitest';

import { validateAvatarUpload } from './system.js';

describe('system routes', () => {
  it('rejects avatar uploads that are not image bytes', () => {
    expect(() =>
      validateAvatarUpload(Buffer.from('not an image')),
    ).toThrow('avatar must be a JPEG, PNG, or WebP image');
  });

  it('rejects avatar uploads over the size limit', () => {
    expect(() =>
      validateAvatarUpload(Buffer.alloc(2 * 1024 * 1024)),
    ).toThrow('avatar must be 1 MB or smaller');
  });

  it('accepts JPEG avatar bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    expect(validateAvatarUpload(jpeg)).toEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
    });
  });
});
