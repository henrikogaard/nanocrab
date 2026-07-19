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
  ): Promise<{ fd: number; stat(): Promise<fs.Stats>; close(): Promise<void> }>;
}

const defaultDependencies: StableDirectoryDependencies = {
  open: async (filePath, flags) => {
    const handle = await fs.promises.open(filePath, flags);
    return {
      fd: handle.fd,
      stat: () => handle.stat(),
      close: () => handle.close(),
    };
  },
};

export function fdDirectoryPath(
  fd: number,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'linux') return `/proc/self/fd/${fd}`;
  if (platform === 'darwin') return `/dev/fd/${fd}`;
  throw new Error(
    'Stable directory descriptors are only supported on Linux and macOS',
  );
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
    | { fd: number; stat(): Promise<fs.Stats>; close(): Promise<void> }
    | undefined;
  try {
    handle = await deps.open(directory, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not a stable directory: ${message}`, {
      // Filesystem errors may expose paths outside the approved workspace.
      // eslint-disable-next-line preserve-caught-error
      cause: new Error(`${label} is not a stable directory`),
    });
  }

  const stat = await handle.stat();
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    await handle.close();
    throw new Error(`${label} is not a stable directory`);
  }

  return {
    fd: handle.fd,
    path: fdDirectoryPath(handle.fd),
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
