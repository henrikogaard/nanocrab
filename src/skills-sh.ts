import fs from 'fs';
import path from 'path';

import { CONTAINER_SKILLS_DIR, SKILLS_SH_API_BASE_URL } from './config.js';
import {
  listSkillRegistry,
  SkillRegistryEntry,
  SkillScope,
  SkillVisibility,
  updateSkillState,
} from './skill-registry.js';
import {
  recordSkillVersion,
  type SkillVersionEntry,
} from './skill-versions.js';

export interface SkillsShSkillSummary {
  id: string;
  skillId: string;
  name: string;
  description: string;
  owner: string;
  repo: string;
  sourceUrl?: string;
  downloads?: number;
  updatedAt?: string;
}

export interface SkillsShSearchInput {
  query?: string;
  owner?: string;
  repo?: string;
  page?: number;
  pageSize?: number;
}

export interface SkillsShSearchResult {
  skills: SkillsShSkillSummary[];
  total: number | null;
  page: number;
  pageSize: number;
}

export interface SkillsShInstallInput {
  owner: string;
  repo: string;
  skillId: string;
  enabled?: boolean;
  scope?: SkillScope;
  visibility?: SkillVisibility;
}

export interface SkillsShInstallResult {
  skill: SkillRegistryEntry;
  state: {
    enabled: boolean;
    scope: SkillScope;
    visibility: SkillVisibility;
  };
  version: SkillVersionEntry;
  source: {
    source: 'skills.sh';
    owner: string;
    repo: string;
    skillId: string;
    installedAt: string;
  };
}

export class SkillsShError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SkillsShError';
    this.statusCode = statusCode;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(
  record: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!record) return '';
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return '';
}

function firstContentString(
  record: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!record) return '';
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key]) {
      return record[key] as string;
    }
  }
  return '';
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function validateUrlSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new SkillsShError(`Invalid Skills.sh ${label}`, 400);
  }
  return value;
}

function skillPathFromSkillId(skillId: string): string {
  const pathName = skillId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (!pathName) throw new SkillsShError('Invalid Skills.sh skill id', 400);
  return pathName;
}

function normalizeScope(value: unknown): SkillScope {
  return value === 'main' || value === 'channels' ? value : 'all';
}

function normalizeVisibility(value: unknown): SkillVisibility {
  return value === 'private' || value === 'system' ? value : 'shared';
}

function skillsShUrl(pathname: string, params?: Record<string, string>) {
  const base = SKILLS_SH_API_BASE_URL.replace(/\/+$/, '');
  const url = new URL(
    `${base}${pathname.startsWith('/') ? '' : '/'}${pathname}`,
  );
  for (const [key, value] of Object.entries(params || {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

async function fetchSkillsSh(url: URL): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8',
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new SkillsShError(
        `Skills.sh request failed with ${response.status}`,
        response.status >= 500 ? 502 : 400,
      );
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return text ? JSON.parse(text) : {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (err) {
    if (err instanceof SkillsShError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new SkillsShError('Skills.sh request timed out', 504);
    }
    throw new SkillsShError(
      `Skills.sh request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ['skills', 'items', 'data', 'results']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  const nested = asRecord(record.data);
  if (nested) {
    for (const key of ['skills', 'items', 'results']) {
      if (Array.isArray(nested[key])) return nested[key] as unknown[];
    }
  }
  return [];
}

function normalizeSourceParts(record: Record<string, unknown>) {
  const source =
    asRecord(record.source) ||
    asRecord(record.repository) ||
    asRecord(record.repoInfo);
  let owner = firstString(record, [
    'owner',
    'repoOwner',
    'repositoryOwner',
    'githubOwner',
  ]);
  let repo = firstString(record, [
    'repo',
    'repositoryName',
    'repoName',
    'githubRepo',
  ]);
  const repository =
    firstString(record, ['repository', 'sourceRepository']) ||
    firstString(source, ['repository', 'fullName']);
  if ((!owner || !repo) && repository.includes('/')) {
    const parts = repository.split('/').filter(Boolean);
    owner ||= parts[0] || '';
    repo ||= parts[1] || '';
  }
  owner ||= firstString(source, ['owner', 'repoOwner', 'repositoryOwner']);
  repo ||= firstString(source, ['repo', 'name', 'repositoryName']);
  return { owner, repo, source };
}

function normalizeSkillSummary(value: unknown): SkillsShSkillSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const { owner, repo, source } = normalizeSourceParts(record);
  let skillId = firstString(record, ['skillId', 'skill_id', 'slug', 'id']);
  if (skillId.includes('/')) {
    const parts = skillId.split('/').filter(Boolean);
    skillId = parts.at(-1) || skillId;
  }
  const name = firstString(record, ['name', 'title']) || skillId;
  const description =
    firstString(record, ['description', 'summary']) ||
    firstString(source, ['description']) ||
    '';
  if (!owner || !repo || !skillId) return null;
  return {
    id: `${owner}/${repo}/${skillId}`,
    skillId,
    name,
    description,
    owner,
    repo,
    sourceUrl:
      firstString(record, ['sourceUrl', 'url', 'htmlUrl']) ||
      firstString(source, ['url', 'htmlUrl']),
    downloads: numberValue(record.downloads ?? record.installCount),
    updatedAt: firstString(record, ['updatedAt', 'lastModified']),
  };
}

export async function searchSkillsSh(
  input: SkillsShSearchInput,
): Promise<SkillsShSearchResult> {
  const page = clampInt(input.page, 1, 1, 1000);
  const pageSize = clampInt(input.pageSize, 12, 1, 50);
  const params: Record<string, string> = {
    page: String(page),
    pageSize: String(pageSize),
  };
  if (input.query?.trim()) params.query = input.query.trim();
  if (input.owner?.trim()) params.owner = input.owner.trim();
  if (input.repo?.trim()) params.repo = input.repo.trim();
  const payload = await fetchSkillsSh(skillsShUrl('/skills', params));
  const record = asRecord(payload);
  const nested = asRecord(record?.data);
  const skills = extractItems(payload)
    .map(normalizeSkillSummary)
    .filter((skill): skill is SkillsShSkillSummary => Boolean(skill));
  const total =
    numberValue(record?.total) ??
    numberValue(record?.totalCount) ??
    numberValue(nested?.total) ??
    null;
  return {
    skills,
    total,
    page: numberValue(record?.page) ?? page,
    pageSize: numberValue(record?.pageSize) ?? pageSize,
  };
}

function extractContent(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  const record = asRecord(payload);
  if (!record) return '';
  const direct = firstContentString(record, [
    'content',
    'skillMd',
    'skillMarkdown',
    'markdown',
    'instructions',
  ]);
  if (direct) return direct;
  const skill = asRecord(record.skill);
  const fromSkill = firstContentString(skill, [
    'content',
    'skillMd',
    'skillMarkdown',
    'markdown',
  ]);
  if (fromSkill) return fromSkill;
  const files = Array.isArray(record.files) ? record.files : [];
  for (const file of files) {
    const item = asRecord(file);
    const filePath = firstString(item, ['path', 'name']);
    if (filePath.endsWith('SKILL.md')) {
      const fileContent = firstContentString(item, ['content', 'raw', 'text']);
      if (fileContent) return fileContent;
    }
  }
  return '';
}

async function fetchSkillContent(input: {
  owner: string;
  repo: string;
  skillId: string;
}) {
  const owner = validateUrlSegment(input.owner, 'owner');
  const repo = validateUrlSegment(input.repo, 'repo');
  const skillId = validateUrlSegment(input.skillId, 'skill id');
  const content = extractContent(
    await fetchSkillsSh(
      skillsShUrl(
        `/skills/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo,
        )}/${encodeURIComponent(skillId)}/content`,
      ),
    ),
  );
  if (content.trim()) return content;

  const filesContent = extractContent(
    await fetchSkillsSh(
      skillsShUrl(
        `/skills/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo,
        )}/${encodeURIComponent(skillId)}/files`,
      ),
    ),
  );
  if (filesContent.trim()) return filesContent;
  throw new SkillsShError('Skills.sh skill content was empty', 502);
}

function ensureSkillMarkdown(content: string, skillPath: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (/^---\s*\n[\s\S]*?\n---/.test(normalized)) return normalized;
  return [
    '---',
    `name: ${skillPath}`,
    'description: "Downloaded from Skills.sh"',
    '---',
    '',
    normalized.trim(),
    '',
  ].join('\n');
}

export async function installSkillsShSkill(
  input: SkillsShInstallInput,
): Promise<SkillsShInstallResult> {
  const owner = validateUrlSegment(String(input.owner || ''), 'owner');
  const repo = validateUrlSegment(String(input.repo || ''), 'repo');
  const skillId = validateUrlSegment(String(input.skillId || ''), 'skill id');
  const skillPath = skillPathFromSkillId(skillId);
  const skillDir = path.join(CONTAINER_SKILLS_DIR, skillPath);
  const sourcePath = path.join(skillDir, 'skills-sh-source.json');
  if (fs.existsSync(skillDir) && !fs.existsSync(sourcePath)) {
    throw new SkillsShError(`Skill already exists: ${skillPath}`, 409);
  }

  const content = ensureSkillMarkdown(
    await fetchSkillContent({ owner, repo, skillId }),
    skillPath,
  );
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  const source = {
    source: 'skills.sh' as const,
    owner,
    repo,
    skillId,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(sourcePath, `${JSON.stringify(source, null, 2)}\n`);
  const version = recordSkillVersion({
    skillPath,
    actor: 'skills.sh',
    action: 'install',
    note: `Downloaded from Skills.sh: ${owner}/${repo}/${skillId}`,
  });
  const state = updateSkillState(skillPath, {
    enabled: input.enabled !== false,
    scope: normalizeScope(input.scope),
    visibility: normalizeVisibility(input.visibility),
  });
  const skill = listSkillRegistry().find((entry) => entry.path === skillPath);
  if (!skill) {
    throw new SkillsShError(`Installed skill not found: ${skillPath}`, 500);
  }
  return { skill, state, version, source };
}
