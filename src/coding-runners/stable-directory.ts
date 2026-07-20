import fs from 'node:fs';

export interface StableDirectoryHandle {
  fd: number;
  path: string;
  stat(): Promise<fs.Stats>;
  close(): Promise<void>;
}

export interface StableDirectoryDependencies {
  open(
    path: string,
    flags: number,
  ): Promise<{
    fd: number;
    stat(): Promise<fs.Stats>;
    statBigInt(): Promise<fs.BigIntStats>;
    close(): Promise<void>;
  }>;
}

const defaultDependencies: StableDirectoryDependencies = {
  open: async (filePath, flags) => {
    const handle = await fs.promises.open(filePath, flags);
    return {
      fd: handle.fd,
      stat: () => handle.stat(),
      statBigInt: () => handle.stat({ bigint: true }),
      close: () => handle.close(),
    };
  },
};

export function fdDirectoryPath(
  fd: number,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'linux') return `/proc/self/fd/${fd}`;
  if (platform === 'darwin') {
    const stat = fs.fstatSync(fd, { bigint: true });
    return `/.vol/${stat.dev}/${stat.ino}`;
  }
  throw new Error(
    'Stable directory descriptors are only supported on Linux and macOS',
  );
}

function stableDirectoryError(label: string): Error {
  return new Error(`${label} is not a stable directory`, {
    cause: new Error(`${label} is not a stable directory`),
  });
}

function hasSameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export async function openStableDirectory(
  directory: string,
  label: string,
  deps: StableDirectoryDependencies = defaultDependencies,
): Promise<StableDirectoryHandle> {
  const flags =
    fs.constants.O_RDONLY |
    fs.constants.O_NOFOLLOW |
    (fs.constants.O_DIRECTORY ?? 0);

  let handle:
    | {
        fd: number;
        stat(): Promise<fs.Stats>;
        statBigInt(): Promise<fs.BigIntStats>;
        close(): Promise<void>;
      }
    | undefined;
  try {
    handle = await deps.open(directory, flags);
  } catch {
    throw stableDirectoryError(label);
  }

  let stablePath: string;
  try {
    const stat = await handle.statBigInt();
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw stableDirectoryError(label);
    }

    stablePath = fdDirectoryPath(handle.fd);
    // Linux exposes the already-open descriptor through a kernel-owned symlink.
    // O_NOFOLLOW still applies to every caller-provided directory and child.
    const stablePathFlags =
      process.platform === 'linux'
        ? flags & ~fs.constants.O_NOFOLLOW
        : flags;
    const stableHandle = await deps.open(stablePath, stablePathFlags);
    try {
      const stableStat = await stableHandle.statBigInt();
      if (
        !stableStat.isDirectory() ||
        stableStat.isSymbolicLink() ||
        !hasSameIdentity(stat, stableStat)
      ) {
        throw stableDirectoryError(label);
      }
    } finally {
      await stableHandle.close();
    }
  } catch {
    await handle.close().catch(() => undefined);
    throw stableDirectoryError(label);
  }

  return {
    fd: handle.fd,
    path: stablePath,
    stat: () => handle!.stat(),
    close: () => handle!.close(),
  };
}

export async function openStableDirectoryAt(
  parent: StableDirectoryHandle,
  name: string,
  label: string,
  deps: StableDirectoryDependencies = defaultDependencies,
): Promise<StableDirectoryHandle> {
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name === '' ||
    name === '.'
  ) {
    throw new Error(`${label} is not a stable directory: invalid name`);
  }
  return openStableDirectory(`${parent.path}/${name}`, label, deps);
}
