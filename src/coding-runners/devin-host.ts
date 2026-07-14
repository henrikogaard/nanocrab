import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PipelineStageKind } from '../control-plane/types.js';

export type DevinStageKind = PipelineStageKind | 'direct';

export interface DevinAgentConfig {
  system_instructions: string;
  allowed_tools: string[];
  permissions: {
    allow: string[];
    ask: [];
    deny: string[];
  };
}

export function buildDevinAgentConfig(input: {
  stageKind: DevinStageKind;
  workspace: string;
  jobRoot: string;
  brokerPath: string;
  devinCredentialPath: string;
  home: string;
  nanocrabConfigRoot: string;
}): DevinAgentConfig {
  const writable =
    input.stageKind === 'implement' || input.stageKind === 'direct';
  const metadataRoot = path.join(input.jobRoot, '.nanocrab');
  const allow = [`Read(${input.workspace}/**)`, `Exec(${input.brokerPath})`];
  if (writable) allow.push(`Write(${input.workspace}/**)`);

  return {
    system_instructions: writable
      ? 'Modify only repository files required by the approved task. Use the NanoCrab command broker for approved build and test commands. Do not commit, push, or open pull requests.'
      : 'Do not modify repository files. Inspect the repository only through the approved read tools and NanoCrab command broker. Do not commit, push, or open pull requests.',
    allowed_tools: writable
      ? ['read', 'grep', 'glob', 'edit', 'write', 'exec']
      : ['read', 'grep', 'glob', 'exec'],
    permissions: {
      allow,
      ask: [],
      deny: [
        `Read(${metadataRoot}/**)`,
        `Read(${input.devinCredentialPath})`,
        `Read(${path.join(input.home, '.ssh')}/**)`,
        `Read(${path.join(input.home, '.gnupg')}/**)`,
        `Read(${input.nanocrabConfigRoot}/**)`,
        `Write(${metadataRoot}/**)`,
        `Write(${input.devinCredentialPath})`,
        `Write(${path.join(input.home, '.ssh')}/**)`,
        `Write(${path.join(input.home, '.gnupg')}/**)`,
        `Write(${input.nanocrabConfigRoot}/**)`,
      ],
    },
  };
}

const TRUSTED_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
const CHILD_ENV_KEYS = [
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const;

export function buildDevinChildEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  environment.PATH = TRUSTED_PATH;
  environment.TERM = 'dumb';
  environment.NO_COLOR = '1';
  return environment;
}

interface DevinBrokerLauncherDependencies {
  mkdir: typeof fs.promises.mkdir;
  writeFile: typeof fs.promises.writeFile;
  chmod: typeof fs.promises.chmod;
}

const launcherDependencies: DevinBrokerLauncherDependencies = {
  mkdir: fs.promises.mkdir,
  writeFile: fs.promises.writeFile,
  chmod: fs.promises.chmod,
};

export async function writeDevinCommandBrokerLauncher(
  input: {
    stageKind: DevinStageKind;
    workspace: string;
    jobRoot: string;
    commandBrokerModulePath: string;
    sandboxExecutable: '/usr/bin/bwrap' | '/usr/bin/sandbox-exec';
    home: string;
    protectedPaths: readonly string[];
    trustedRuntimeReadRoots: readonly string[];
  },
  dependencies: DevinBrokerLauncherDependencies = launcherDependencies,
): Promise<string> {
  const directory = path.join(input.jobRoot, '.nanocrab', 'bin');
  const launcherPath = path.join(directory, 'nanocrab-job-exec');
  const moduleUrl = pathToFileURL(input.commandBrokerModulePath).href;
  const source = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { runCommandBrokerCli } from ${JSON.stringify(moduleUrl)};

const execute = (executable, args, options) => new Promise((resolve, reject) => {
  const child = spawn(executable, args, { ...options, shell: false, stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (signal) reject(new Error('Broker command terminated by signal'));
    else resolve(code ?? 1);
  });
});

const exitCode = await runCommandBrokerCli({
  stageKind: ${JSON.stringify(input.stageKind)},
  workspace: ${JSON.stringify(input.workspace)},
  cwd: process.cwd(),
  argv: process.argv.slice(2),
  home: ${JSON.stringify(input.home)},
  protectedPaths: ${JSON.stringify(input.protectedPaths)},
  trustedRuntimeReadRoots: ${JSON.stringify(input.trustedRuntimeReadRoots)},
}, {
  platform: process.platform,
  execute,
  readFile: (file) => readFile(file, 'utf8'),
  realpath,
  environmentSource: process.env,
  sandboxExecutable: ${JSON.stringify(input.sandboxExecutable)},
});
process.exitCode = exitCode;
`;

  await dependencies.mkdir(directory, { recursive: true, mode: 0o700 });
  await dependencies.writeFile(launcherPath, source, {
    encoding: 'utf8',
    mode: 0o555,
    flag: 'wx',
  });
  await dependencies.chmod(launcherPath, 0o555);
  await dependencies.chmod(directory, 0o500);
  return launcherPath;
}
