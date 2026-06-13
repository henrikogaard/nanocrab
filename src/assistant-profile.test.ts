import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-assistant-profile-${Date.now()}`,
);

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

const {
  BUILTIN_AVATARS,
  getAssistantProfile,
  listAssistantAvatars,
  saveAssistantAvatarSelection,
} = await import('./assistant-profile.js');

describe('assistant profile avatars', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('ships the default mark, uploaded slot, and at least five built-in avatars', () => {
    const avatars = listAssistantAvatars();

    expect(avatars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'default',
          kind: 'default',
          available: true,
        }),
        expect.objectContaining({ id: 'uploaded', kind: 'uploaded' }),
      ]),
    );
    expect(BUILTIN_AVATARS).toHaveLength(5);
    expect(avatars.filter((avatar) => avatar.kind === 'builtin')).toHaveLength(
      5,
    );
  });

  it('points built-in metadata at existing SVG assets', () => {
    for (const avatar of BUILTIN_AVATARS) {
      const relativePath = avatar.url.replace(/^\//, '');
      const filePath = path.join(
        process.cwd(),
        'src/admin/public',
        relativePath,
      );

      expect(avatar.url).toMatch(/^\/static\/avatars\/.+\.svg$/);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toContain('<svg');
    }
  });

  it('persists a built-in avatar selection and rejects unavailable uploads', () => {
    const saved = saveAssistantAvatarSelection('tidal-crab');

    expect(saved.selectedAvatar).toMatchObject({
      id: 'tidal-crab',
      kind: 'builtin',
    });
    expect(getAssistantProfile().selectedAvatarId).toBe('tidal-crab');
    expect(() => saveAssistantAvatarSelection('uploaded')).toThrow(
      'avatar option is not available',
    );
  });
});
