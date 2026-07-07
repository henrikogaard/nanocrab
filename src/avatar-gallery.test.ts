import { describe, expect, it } from 'vitest';

import { avatarAssetExists, listAvatarGallery } from './avatar-gallery.js';

describe('avatar gallery', () => {
  it('includes the default logo and at least five built-in SVG avatars', () => {
    const gallery = listAvatarGallery();

    expect(gallery.find((item) => item.kind === 'default')).toMatchObject({
      id: 'nanocrab-default',
    });
    expect(gallery.filter((item) => item.kind === 'builtin')).toHaveLength(5);
    expect(gallery.filter((item) => item.url.endsWith('.svg'))).toHaveLength(5);
  });

  it('declares assets that exist in the admin public static tree', () => {
    for (const item of listAvatarGallery()) {
      expect(avatarAssetExists(item), item.id).toBe(true);
    }
  });
});
