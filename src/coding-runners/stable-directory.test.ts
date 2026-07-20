import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fdDirectoryPath,
  openStableDirectory,
  openStableDirectoryAt,
  type StableDirectoryDependencies,
} from './stable-directory.js';

describe('stable directory', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-dir-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps identifying the original directory after its pathname is renamed', async () => {
    const original = path.join(tmp, 'original');
    const renamed = path.join(tmp, 'renamed');
    fs.mkdirSync(original);
    fs.writeFileSync(path.join(original, 'marker'), 'original');

    const handle = await openStableDirectory(original, 'test');
    try {
      const openedStat = await handle.stat();

      fs.renameSync(original, renamed);

      const stableStat = fs.statSync(handle.path);
      expect(handle.fd).toBeGreaterThanOrEqual(0);
      expect(handle.path).toBe(fdDirectoryPath(handle.fd));
      expect(stableStat.dev).toBe(openedStat.dev);
      expect(stableStat.ino).toBe(openedStat.ino);
      expect(fs.readFileSync(path.join(handle.path, 'marker'), 'utf8')).toBe(
        'original',
      );
    } finally {
      await handle.close();
    }
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

  it('rejects distinct bigint identities that collapse to the same number', async () => {
    const originalIno = 9_007_199_254_740_992n;
    const reopenedIno = originalIno + 1n;
    const roundedIno = Number(originalIno);
    expect(Number(reopenedIno)).toBe(roundedIno);

    const flags = fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0);
    const originalHandle = await fs.promises.open(tmp, flags);
    const reopenedHandle = await fs.promises.open(tmp, flags);
    let openCount = 0;
    const withIdentity = <T extends fs.Stats | fs.BigIntStats>(
      stat: T,
      dev: number | bigint,
      ino: number | bigint,
    ): T =>
      new Proxy(stat, {
        get(target, property, receiver) {
          if (property === 'dev') return dev;
          if (property === 'ino') return ino;
          return Reflect.get(target, property, receiver);
        },
      });
    const deps: StableDirectoryDependencies = {
      open: async () => {
        const isOriginal = openCount++ === 0;
        const handle = isOriginal ? originalHandle : reopenedHandle;
        const ino = isOriginal ? originalIno : reopenedIno;
        return {
          fd: handle.fd,
          stat: async () =>
            withIdentity(await handle.stat(), 1, roundedIno) as fs.Stats,
          statBigInt: async () =>
            withIdentity(
              await handle.stat({ bigint: true }),
              1n,
              ino,
            ) as fs.BigIntStats,
          close: () => handle.close(),
        };
      },
    };

    const accepted = await openStableDirectory(tmp, 'test', deps).then(
      async (handle) => {
        await handle.close();
        return true;
      },
      () => false,
    );

    expect(accepted).toBe(false);
  });

  it('opens a child directory relative to a stable parent', async () => {
    const parentPath = path.join(tmp, 'parent');
    const childPath = path.join(parentPath, 'child');
    fs.mkdirSync(childPath, { recursive: true });

    const parent = await openStableDirectory(parentPath, 'parent');
    try {
      const child = await openStableDirectoryAt(parent, 'child', 'child');
      try {
        const stat = await child.stat();
        expect(stat.isDirectory()).toBe(true);
      } finally {
        await child.close();
      }
    } finally {
      await parent.close();
    }
  });

  it('does not follow a replacement pathname when opening a child', async () => {
    const original = path.join(tmp, 'original');
    const renamed = path.join(tmp, 'renamed');
    const replacement = path.join(tmp, 'replacement');
    fs.mkdirSync(path.join(original, 'child'), { recursive: true });
    fs.mkdirSync(path.join(replacement, 'child'), { recursive: true });
    fs.writeFileSync(path.join(original, 'child', 'marker'), 'original');
    fs.writeFileSync(path.join(replacement, 'child', 'marker'), 'replacement');

    const parent = await openStableDirectory(original, 'parent');
    try {
      fs.renameSync(original, renamed);
      fs.symlinkSync(replacement, original);

      const child = await openStableDirectoryAt(parent, 'child', 'child');
      try {
        expect(fs.readFileSync(path.join(child.path, 'marker'), 'utf8')).toBe(
          'original',
        );
      } finally {
        await child.close();
      }
    } finally {
      await parent.close();
    }
  });

  it('rejects a child symlink via a stable parent', async () => {
    const parentPath = path.join(tmp, 'parent');
    const realChild = path.join(tmp, 'real-child');
    fs.mkdirSync(parentPath, { recursive: true });
    fs.mkdirSync(realChild);
    fs.symlinkSync(realChild, path.join(parentPath, 'child'));

    const parent = await openStableDirectory(parentPath, 'parent');

    try {
      await expect(
        openStableDirectoryAt(parent, 'child', 'child'),
      ).rejects.toThrow(/not a stable directory/i);
    } finally {
      await parent.close();
    }
  });

  it('redacts unapproved paths while retaining the caller label', async () => {
    const unapprovedPath = '/private/host/secret';
    const deps: StableDirectoryDependencies = {
      open: async () => {
        throw new Error(`ENOENT: no such file or directory, ${unapprovedPath}`);
      },
    };

    const thrown: unknown = await openStableDirectory(
      '/approved/input',
      'Git metadata root',
      deps,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error;
    expect(error.message).toContain('Git metadata root');
    expect(error.message).not.toContain(unapprovedPath);
    expect((error.cause as Error).message).toContain('Git metadata root');
    expect((error.cause as Error).message).not.toContain(unapprovedPath);
  });

  it('throws for unsupported platforms', () => {
    expect(() => fdDirectoryPath(7, 'win32')).toThrow(
      /stable directory descriptors.*only supported/i,
    );
  });
});
