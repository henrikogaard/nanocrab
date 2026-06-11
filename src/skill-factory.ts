import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { CONTAINER_SKILLS_DIR, STORE_DIR } from './config.js';

export type SkillDraftStatus = 'pending' | 'approved' | 'rejected';

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  status: SkillDraftStatus;
  createdBy: string;
  createdAt: string;
  reviewedAt: string | null;
  draftDir: string;
  installDir: string | null;
  version: number;
  provenance: string[];
  validationStatus: 'valid' | 'invalid';
  validationErrors: string[];
  installedVersion: number | null;
  syncStatus: 'draft' | 'installed' | 'rejected' | 'stale';
}

export interface SkillDraftRevision {
  version: number;
  createdAt: string;
  createdBy: string;
  reason: 'created' | 'updated' | 'approved' | 'rollback';
  contentPath: string;
  description: string;
}

export interface ProposeSkillDraftInput {
  skillMd: string;
  createdBy: string;
  provenance?: string[];
}

const SKILL_DRAFTS_DIR = path.join(STORE_DIR, 'skill-drafts');

function safeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(normalized)) {
    throw new Error('skill name must be lowercase kebab-case, 2-63 characters');
  }
  return normalized;
}

function draftDir(id: string): string {
  return path.join(SKILL_DRAFTS_DIR, id);
}

function metadataPath(id: string): string {
  return path.join(draftDir(id), 'metadata.json');
}

function skillPath(id: string): string {
  return path.join(draftDir(id), 'SKILL.md');
}

function revisionsDir(id: string): string {
  return path.join(draftDir(id), 'revisions');
}

function revisionPath(id: string, version: number): string {
  return path.join(
    revisionsDir(id),
    `${String(version).padStart(4, '0')}.json`,
  );
}

function revisionContentPath(id: string, version: number): string {
  return path.join(
    revisionsDir(id),
    `${String(version).padStart(4, '0')}.SKILL.md`,
  );
}

function parseFrontmatter(skillMd: string): {
  name: string;
  description: string;
} {
  if (skillMd.length > 50000) throw new Error('skill draft is too large');
  const lines = skillMd.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    throw new Error('SKILL.md must start with frontmatter');
  }
  const end = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed');
  const frontmatter = lines.slice(1, end);
  const values: Record<string, string> = {};
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  const name = safeSkillName(values.name || '');
  const description = values.description?.trim();
  if (!description) throw new Error('SKILL.md frontmatter needs description');
  if (description.length > 500) {
    throw new Error('skill description must be 500 characters or fewer');
  }
  return { name, description };
}

function readDraft(id: string): SkillDraft | undefined {
  try {
    const draft = JSON.parse(
      fs.readFileSync(metadataPath(id), 'utf-8'),
    ) as SkillDraft;
    const defaults = {
      version: 1,
      provenance: [],
      validationStatus: 'valid',
      validationErrors: [],
      installedVersion: null,
      syncStatus:
        draft.status === 'approved'
          ? 'installed'
          : draft.status === 'rejected'
            ? 'rejected'
            : 'draft',
    };
    return { ...defaults, ...draft };
  } catch {
    return undefined;
  }
}

function writeDraft(draft: SkillDraft): void {
  fs.mkdirSync(draft.draftDir, { recursive: true });
  fs.writeFileSync(
    metadataPath(draft.id),
    `${JSON.stringify(draft, null, 2)}\n`,
  );
}

function recordRevision(
  draft: SkillDraft,
  content: string,
  revision: Omit<SkillDraftRevision, 'contentPath' | 'description'>,
): SkillDraftRevision {
  fs.mkdirSync(revisionsDir(draft.id), { recursive: true });
  const contentPath = revisionContentPath(draft.id, revision.version);
  fs.writeFileSync(contentPath, content.trimEnd() + '\n');
  const fullRevision: SkillDraftRevision = {
    ...revision,
    contentPath,
    description: draft.description,
  };
  fs.writeFileSync(
    revisionPath(draft.id, revision.version),
    `${JSON.stringify(fullRevision, null, 2)}\n`,
  );
  return fullRevision;
}

export function proposeSkillDraft(input: ProposeSkillDraftInput): SkillDraft {
  const parsed = parseFrontmatter(input.skillMd);
  const id = `skill-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();
  const draft: SkillDraft = {
    id,
    name: parsed.name,
    description: parsed.description,
    status: 'pending',
    createdBy: input.createdBy,
    createdAt: now,
    reviewedAt: null,
    draftDir: draftDir(id),
    installDir: null,
    version: 1,
    provenance: input.provenance || [`created-by:${input.createdBy}`],
    validationStatus: 'valid',
    validationErrors: [],
    installedVersion: null,
    syncStatus: 'draft',
  };
  fs.mkdirSync(draft.draftDir, { recursive: true });
  fs.writeFileSync(skillPath(id), input.skillMd.trimEnd() + '\n');
  recordRevision(draft, input.skillMd, {
    version: draft.version,
    createdAt: now,
    createdBy: input.createdBy,
    reason: 'created',
  });
  writeDraft(draft);
  return draft;
}

export function listSkillDrafts(status?: SkillDraftStatus): SkillDraft[] {
  if (!fs.existsSync(SKILL_DRAFTS_DIR)) return [];
  return fs
    .readdirSync(SKILL_DRAFTS_DIR)
    .map((id) => readDraft(id))
    .filter((draft): draft is SkillDraft => Boolean(draft))
    .filter((draft) => !status || draft.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSkillDraft(id: string): SkillDraft | undefined {
  return readDraft(id);
}

export function getSkillDraftContent(id: string): string | undefined {
  const draft = readDraft(id);
  if (!draft) return undefined;
  return fs.readFileSync(skillPath(id), 'utf-8');
}

export function updateSkillDraft(
  id: string,
  input: { skillMd: string; updatedBy: string },
): SkillDraft {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  if (draft.status === 'rejected') {
    throw new Error('Rejected skill drafts cannot be updated');
  }
  const parsed = parseFrontmatter(input.skillMd);
  if (parsed.name !== draft.name) {
    throw new Error('Skill draft name cannot be changed');
  }
  draft.description = parsed.description;
  draft.version += 1;
  draft.status = 'pending';
  draft.reviewedAt = null;
  draft.syncStatus = draft.installedVersion ? 'stale' : 'draft';
  fs.writeFileSync(skillPath(id), input.skillMd.trimEnd() + '\n');
  recordRevision(draft, input.skillMd, {
    version: draft.version,
    createdAt: new Date().toISOString(),
    createdBy: input.updatedBy,
    reason: 'updated',
  });
  writeDraft(draft);
  return draft;
}

export function listSkillDraftRevisions(id: string): SkillDraftRevision[] {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  if (!fs.existsSync(revisionsDir(id))) return [];
  return fs
    .readdirSync(revisionsDir(id))
    .filter((file) => file.endsWith('.json'))
    .map(
      (file) =>
        JSON.parse(
          fs.readFileSync(path.join(revisionsDir(id), file), 'utf-8'),
        ) as SkillDraftRevision,
    )
    .sort((a, b) => b.version - a.version);
}

export function rollbackSkillDraft(
  id: string,
  version: number,
  rolledBackBy: string,
): SkillDraft {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  const revision = listSkillDraftRevisions(id).find(
    (item) => item.version === version,
  );
  if (!revision || !fs.existsSync(revision.contentPath)) {
    throw new Error(`Skill draft revision not found: ${version}`);
  }
  const content = fs.readFileSync(revision.contentPath, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (parsed.name !== draft.name) {
    throw new Error(
      'Cannot roll back to a revision with a different skill name',
    );
  }
  draft.description = parsed.description;
  draft.version += 1;
  draft.status = 'pending';
  draft.reviewedAt = null;
  draft.syncStatus = draft.installedVersion ? 'stale' : 'draft';
  fs.writeFileSync(skillPath(id), content.trimEnd() + '\n');
  recordRevision(draft, content, {
    version: draft.version,
    createdAt: new Date().toISOString(),
    createdBy: rolledBackBy,
    reason: 'rollback',
  });
  writeDraft(draft);
  return draft;
}

export function approveSkillDraft(id: string): SkillDraft {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  const installDir = path.join(CONTAINER_SKILLS_DIR, draft.name);
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(skillPath(id), path.join(installDir, 'SKILL.md'));
  draft.status = 'approved';
  draft.reviewedAt = new Date().toISOString();
  draft.installDir = installDir;
  draft.installedVersion = draft.version;
  draft.syncStatus = 'installed';
  writeDraft(draft);
  return draft;
}

export function rejectSkillDraft(id: string): SkillDraft {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  draft.status = 'rejected';
  draft.reviewedAt = new Date().toISOString();
  draft.syncStatus = 'rejected';
  writeDraft(draft);
  return draft;
}

export function getSkillDraftDiff(id: string): string {
  const draft = readDraft(id);
  if (!draft) throw new Error(`Skill draft not found: ${id}`);
  const proposed = fs.readFileSync(skillPath(id), 'utf-8').split(/\r?\n/);
  const installedPath = path.join(CONTAINER_SKILLS_DIR, draft.name, 'SKILL.md');
  const installed = fs.existsSync(installedPath)
    ? fs.readFileSync(installedPath, 'utf-8').split(/\r?\n/)
    : [];
  const lines = [
    `--- installed/${draft.name}/SKILL.md`,
    `+++ draft/${draft.name}/SKILL.md`,
  ];
  const max = Math.max(installed.length, proposed.length);
  for (let i = 0; i < max; i++) {
    if (installed[i] === proposed[i]) {
      if (installed[i] !== undefined) lines.push(` ${installed[i]}`);
      continue;
    }
    if (installed[i] !== undefined) lines.push(`-${installed[i]}`);
    if (proposed[i] !== undefined) lines.push(`+${proposed[i]}`);
  }
  return `${lines.join('\n')}\n`;
}
