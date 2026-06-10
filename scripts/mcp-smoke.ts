import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from '../src/env.js';

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  envVars?: string[];
}

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, 'store', 'mcp-servers.json');
const image = process.env.CONTAINER_IMAGE || 'nanocrab-agent:latest';
const runMailCheck = process.argv.includes('--mail');

function fail(message: string): never {
  console.error(`MCP smoke failed: ${message}`);
  process.exit(1);
}

function docker(args: string[]): string {
  return execFileSync('docker', args, {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

if (!fs.existsSync(configPath)) {
  if (runMailCheck) {
    fail(`missing config: ${configPath}`);
  }
  console.log(`MCP smoke ok: no optional MCP config at ${configPath}`);
  process.exit(0);
}

const servers = JSON.parse(
  fs.readFileSync(configPath, 'utf-8'),
) as McpServerConfig[];
const names = servers.map((server) => server.name).filter(Boolean);
if (runMailCheck && !names.includes('infomaniak')) {
  fail('infomaniak is not configured in store/mcp-servers.json');
}

const requiredServers = runMailCheck
  ? servers.filter((server) => server.name === 'infomaniak')
  : [];
const envKeys = [
  ...new Set(requiredServers.flatMap((server) => server.envVars || [])),
];
const envFileValues = readEnvFile(envKeys);
const missing = envKeys.filter((key) => !(process.env[key] || envFileValues[key]));
if (missing.length > 0) {
  fail(`missing env vars: ${missing.join(', ')}`);
}

const configOutput = docker([
  'run',
  '--rm',
  '--entrypoint',
  'node',
  '--env-file',
  '.env',
  '-v',
  `${configPath}:/workspace/project/store/mcp-servers.json:ro`,
  image,
  '-e',
  [
    "const fs=require('fs');",
    "const p='/workspace/project/store/mcp-servers.json';",
    "const cfg=JSON.parse(fs.readFileSync(p,'utf8'));",
    "console.log(JSON.stringify({names:cfg.map(s=>s.name), env:cfg.map(s=>[s.name,(s.envVars||[]).filter(k=>!!process.env[k]).length])}));",
  ].join(' '),
]);

const parsed = JSON.parse(configOutput.trim()) as {
  names: string[];
  env: Array<[string, number]>;
};
if (runMailCheck && !parsed.names.includes('infomaniak')) {
  fail('agent image cannot read infomaniak MCP config');
}
const infomaniakEnvCount =
  parsed.env.find(([name]) => name === 'infomaniak')?.[1] || 0;
if (runMailCheck && infomaniakEnvCount === 0) {
  fail('agent image does not receive Infomaniak env vars');
}

console.log(`MCP smoke ok: ${parsed.names.join(', ') || 'no optional servers'}`);

if (runMailCheck) {
  const input = {
    prompt:
      'Diagnostic only. Do not send messages. Call only mcp__infomaniak__.mail_list_mailboxes and report success plus mailbox count only. Do not read messages or include mailbox names.',
    groupFolder: 'signal_test',
    chatJid: 'sig:+15551234567',
    isMain: true,
    assistantName: 'NanoCrab',
    provider: 'codex',
    model: process.env.DEFAULT_MODEL || 'gpt-5.4',
  };
  const output = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--env-file',
      '.env',
      '-e',
      'AGENT_PROVIDER=codex',
      '-e',
      `DEFAULT_MODEL=${input.model}`,
      '-v',
      `${projectRoot}:/workspace/project:ro`,
      '-v',
      `${path.join(projectRoot, 'store')}:/workspace/project/store`,
      '-v',
      `${path.join(projectRoot, 'groups', 'signal_main')}:/workspace/group`,
      '-v',
      `${path.join(projectRoot, 'groups', 'global')}:/workspace/global`,
      '-v',
      `${process.env.HOME || '/home/node'}/.codex:/home/node/.codex`,
      image,
    ],
    {
      cwd: projectRoot,
      input: JSON.stringify(input),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    },
  );
  if (!/Lyktes: ja|succeeded|success/i.test(output)) {
    fail('Infomaniak mailbox call did not report success');
  }
  console.log('MCP mail smoke ok');
}
