import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { CONTAINER_SKILLS_DIR, STORE_DIR } from './config.js';

export type SkillVersionAction =
  | 'install'
  | 'create'
  | 'update'
  | 'delete'
  | 'rollback';

export type SkillInstallStatus =
  | 'installed'
  | 'modified'
  | 'missing'
  | 'untracked';

export interface SkillVersionEntry {
  id: string;
  skillPath: string;
  version: number;
  action: SkillVersionAction;
  actor: string;
  timestamp: string;
  sha256: string;
  bytes: number;
  note?: string;
  restoredFromVersion?: number;
  contentPath: string;
}

export interface SkillInstallState {
  status: SkillInstallStatus;
  skillPath: string;
  exists: boolean;
  currentSha256: string | null;
  currentVersion: number | null;
  latestVersion: number | null;
  latestSha256: string | null;
  updatedAt: string | null;
}

export interface RecordSkillVersionInput {
  skillPath: string;
  actor: string;
  action: SkillVersionAction;
  content?: string;
  note?: string;
  restoredFromVersion?: number;
}

export interface RollbackSkillVersionInput {
  skillPath: string;
  version: number;
  actor: string;
}

const SKILL_VERSIONS_DIR = path.join(STORE_DIR, 'skill-versions');

function assertSafeSkillPath(skillPath: string): string {
  if (!/^[a-z0-9-]+$/.test(skillPath)) {
    throw new Error('Invalid skill name');
  }
  return skillPath;
}

function skillDir(skillPath: string): string {
  return path.join(CONTAINER_SKILLS_DIR, assertSafeSkillPath(skillPath));
}

function installedSkillMdPath(skillPath: string): string {
  return path.join(skillDir(skillPath), 'SKILL.md');
}

function historyDir(skillPath: string): string {
  return path.join(SKILL_VERSIONS_DIR, assertSafeSkillPath(skillPath));
}

function metadataPath(skillPath: string): string {
  return path.join(historyDir(skillPath), 'metadata.json');
}

function versionContentPath(skillPath: string, version: number): string {
  return path.join(
    historyDir(skillPath),
    `v${String(version).padStart(4, '0')}-SKILL.md`,
  );
}

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readInstalledContent(skillPath: string): string | undefined {
  const file = installedSkillMdPath(skillPath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
}

function readMetadata(skillPath: string): SkillVersionEntry[] {
  assertSafeSkillPath(skillPath);
  try {
    const entries = JSON.parse(
      fs.readFileSync(metadataPath(skillPath), 'utf-8'),
    ) as SkillVersionEntry[];
    return entries.filter(
      (entry) =>
        entry.skillPath === skillPath &&
        Number.isInteger(entry.version) &&
        entry.version > 0,
    );
  } catch {
    return [];
  }
}

function writeMetadata(skillPath: string, entries: SkillVersionEntry[]): void {
  const dir = historyDir(skillPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    metadataPath(skillPath),
    `${JSON.stringify(entries, null, 2)}\n`,
  );
}

function nextVersion(entries: SkillVersionEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.version), 0) + 1;
}

export function listSkillVersions(skillPath: string): SkillVersionEntry[] {
  return readMetadata(skillPath).sort((a, b) => b.version - a.version);
}

export function getSkillInstallState(skillPath: string): SkillInstallState {
  assertSafeSkillPath(skillPath);
  const content = readInstalledContent(skillPath);
  const versions = listSkillVersions(skillPath);
  const latest = versions[0];
  const currentSha = content === undefined ? null : sha256(content);
  const currentVersion =
    currentSha === null
      ? null
      : (versions.find((entry) => entry.sha256 === currentSha)?.version ??
        null);

  let status: SkillInstallStatus = 'missing';
  if (content !== undefined && versions.length === 0) status = 'untracked';
  else if (content !== undefined && latest?.sha256 === currentSha) {
    status = 'installed';
  } else if (content !== undefined) status = 'modified';

  return {
    status,
    skillPath,
    exists: content !== undefined,
    currentSha256: currentSha,
    currentVersion,
    latestVersion: latest?.version ?? null,
    latestSha256: latest?.sha256 ?? null,
    updatedAt: latest?.timestamp ?? null,
  };
}

export function recordSkillVersion(
  input: RecordSkillVersionInput,
): SkillVersionEntry {
  const skillPath = assertSafeSkillPath(input.skillPath);
  const content = input.content ?? readInstalledContent(skillPath);
  if (content === undefined) {
    throw new Error(`Skill not installed: ${skillPath}`);
  }

  const entries = readMetadata(skillPath);
  const version = nextVersion(entries);
  const contentPath = versionContentPath(skillPath, version);
  const entry: SkillVersionEntry = {
    id: `skill-version-${Date.now()}-${crypto.randomUUID()}`,
    skillPath,
    version,
    action: input.action,
    actor: input.actor,
    timestamp: new Date().toISOString(),
    sha256: sha256(content),
    bytes: Buffer.byteLength(content, 'utf-8'),
    note: input.note,
    restoredFromVersion: input.restoredFromVersion,
    contentPath,
  };

  fs.mkdirSync(historyDir(skillPath), { recursive: true });
  fs.writeFileSync(contentPath, content);
  writeMetadata(skillPath, [...entries, entry]);
  return entry;
}

function getSkillVersion(
  skillPath: string,
  version: number,
): SkillVersionEntry {
  const entry = readMetadata(skillPath).find(
    (item) => item.version === version,
  );
  if (!entry)
    throw new Error(`Skill version not found: ${skillPath}@${version}`);
  return entry;
}

function readVersionContent(skillPath: string, version: number): string {
  const entry = getSkillVersion(skillPath, version);
  return fs.readFileSync(entry.contentPath, 'utf-8');
}

function diffLines(
  fromLabel: string,
  fromContent: string,
  toLabel: string,
  toContent: string,
): string {
  const from = fromContent.split(/\r?\n/);
  const to = toContent.split(/\r?\n/);
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const max = Math.max(from.length, to.length);
  for (let i = 0; i < max; i += 1) {
    if (from[i] === to[i]) {
      if (from[i] !== undefined) lines.push(` ${from[i]}`);
      continue;
    }
    if (from[i] !== undefined) lines.push(`-${from[i]}`);
    if (to[i] !== undefined) lines.push(`+${to[i]}`);
  }
  return `${lines.join('\n')}\n`;
}

export function getSkillVersionDiff(
  skillPath: string,
  fromVersion: number,
  toVersion?: number,
): string {
  assertSafeSkillPath(skillPath);
  const fromContent = readVersionContent(skillPath, fromVersion);
  const toContent =
    toVersion === undefined
      ? (readInstalledContent(skillPath) ?? '')
      : readVersionContent(skillPath, toVersion);
  const toLabel =
    toVersion === undefined
      ? `installed/${skillPath}/SKILL.md`
      : `v${toVersion}/${skillPath}/SKILL.md`;
  return diffLines(
    `v${fromVersion}/${skillPath}/SKILL.md`,
    fromContent,
    toLabel,
    toContent,
  );
}

export function rollbackSkillVersion(
  input: RollbackSkillVersionInput,
): SkillVersionEntry {
  const skillPath = assertSafeSkillPath(input.skillPath);
  const content = readVersionContent(skillPath, input.version);
  const file = installedSkillMdPath(skillPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return recordSkillVersion({
    skillPath,
    actor: input.actor,
    action: 'rollback',
    restoredFromVersion: input.version,
    note: `Restored version ${input.version}`,
    content,
  });
}
