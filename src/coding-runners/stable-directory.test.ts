import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fdDirectoryPath,
  openStableDirectory,
  openStableDirectoryAt,
} from './stable-directory.js';

describe('stable directory', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('opens a real directory and returns a stable fd path', async () => {
    const dir = path.join(tmp, 'real');
    fs.mkdirSync(dir);

    const handle = await openStableDirectory(dir, 'test');

    expect(handle.fd).toBeGreaterThanOrEqual(0);
    expect(handle.path).toBe(fdDirectoryPath(handle.fd));
    expect(handle.path).toMatch(/^\/proc\/self\/fd\/\d+$/);
    const stat = await handle.stat();
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    await handle.close();
  });

  it('rejects a symlink to a directory', async () => {
    const real = path.join(tmp, 'real');
    const link = path.join(tmp, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);

    await expect(openStableDirectory(link, 'test')).rejects.toThrow(
      /not a stable directory/i,
    );
  });

  it('rejects a file', async () => {
    const file = path.join(tmp, 'file');
    fs.writeFileSync(file, 'not a directory');

    await expect(openStableDirectory(file, 'test')).rejects.toThrow(
      /not a stable directory/i,
    );
  });

  it('opens a child directory relative to a stable parent', async () => {
    const parentPath = path.join(tmp, 'parent');
    const childPath = path.join(parentPath, 'child');
    fs.mkdirSync(childPath, { recursive: true });

    const parent = await openStableDirectory(parentPath, 'parent');
    const child = await openStableDirectoryAt(parent, 'child', 'child');

    const stat = await child.stat();
    expect(stat.isDirectory()).toBe(true);

    await child.close();
    await parent.close();
  });

  it('rejects a child symlink via a stable parent', async () => {
    const parentPath = path.join(tmp, 'parent');
    const realChild = path.join(tmp, 'real-child');
    fs.mkdirSync(parentPath, { recursive: true });
    fs.mkdirSync(realChild);
    fs.symlinkSync(realChild, path.join(parentPath, 'child'));

    const parent = await openStableDirectory(parentPath, 'parent');

    await expect(
      openStableDirectoryAt(parent, 'child', 'child'),
    ).rejects.toThrow(/not a stable directory/i);

    await parent.close();
  });

  it('returns a macOS-style fd path on darwin', () => {
    expect(fdDirectoryPath(7, 'darwin')).toBe('/dev/fd/7');
  });

  it('throws for unsupported platforms', () => {
    expect(() => fdDirectoryPath(7, 'win32')).toThrow(
      /stable directory descriptors.*only supported/i,
    );
  });
});
