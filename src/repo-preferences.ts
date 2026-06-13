import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { STORE_DIR } from './config.js';

export type RepoRuleStatus = 'approved' | 'disabled';
export type RepoRuleVisibility = 'private' | 'shared';

export interface RepoPreferenceRule {
  id: string;
  repo: string;
  title: string;
  content: string;
  source: string | null;
  status: RepoRuleStatus;
  visibility: RepoRuleVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface RepoPreferenceStore {
  rules: RepoPreferenceRule[];
}

export interface UpsertRepoRuleInput {
  id?: string;
  repo: string;
  title: string;
  content: string;
  source?: string | null;
  visibility?: RepoRuleVisibility;
  status?: RepoRuleStatus;
}

export interface RepoPreferenceOptions {
  storePath?: string;
  now?: () => string;
  id?: () => string;
}

export const DEFAULT_REPO_PREFERENCES_PATH = path.join(
  STORE_DIR,
  'repo-preferences.json',
);

function storePath(options?: RepoPreferenceOptions) {
  return options?.storePath || DEFAULT_REPO_PREFERENCES_PATH;
}

function now(options?: RepoPreferenceOptions) {
  return options?.now?.() || new Date().toISOString();
}

function nextId(options?: RepoPreferenceOptions) {
  return (
    options?.id?.() ||
    `repo-rule-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
}

function assertRepo(repo: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('repo must be in owner/name format');
  }
}

function containsSecret(text: string) {
  return /\b(api[_ -]?key|token|password|secret|private key|oauth|sk-[A-Za-z0-9_-]{6,})\b/i.test(
    text,
  );
}

export function loadRepoPreferenceStore(
  filePath = DEFAULT_REPO_PREFERENCES_PATH,
): RepoPreferenceStore {
  try {
    if (!fs.existsSync(filePath)) return { rules: [] };
    const raw = JSON.parse(
      fs.readFileSync(filePath, 'utf-8'),
    ) as Partial<RepoPreferenceStore>;
    return { rules: Array.isArray(raw.rules) ? raw.rules : [] };
  } catch {
    return { rules: [] };
  }
}

export function saveRepoPreferenceStore(
  store: RepoPreferenceStore,
  filePath = DEFAULT_REPO_PREFERENCES_PATH,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

export function listRepoRules(
  repo: string,
  options?: RepoPreferenceOptions,
): RepoPreferenceRule[] {
  assertRepo(repo);
  return loadRepoPreferenceStore(storePath(options))
    .rules.filter((rule) => rule.repo.toLowerCase() === repo.toLowerCase())
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function listAllRepoRules(
  options?: RepoPreferenceOptions,
): RepoPreferenceRule[] {
  return loadRepoPreferenceStore(storePath(options)).rules.sort((a, b) =>
    a.repo === b.repo
      ? a.title.localeCompare(b.title)
      : a.repo.localeCompare(b.repo),
  );
}

export function upsertRepoRule(
  input: UpsertRepoRuleInput,
  options?: RepoPreferenceOptions,
): RepoPreferenceRule {
  assertRepo(input.repo);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error('rule title is required');
  if (!content) throw new Error('rule content is required');
  if (containsSecret(`${title}\n${content}`)) {
    throw new Error('Repo rules must not contain secrets or credentials');
  }
  const timestamp = now(options);
  const store = loadRepoPreferenceStore(storePath(options));
  const existingIndex = input.id
    ? store.rules.findIndex((rule) => rule.id === input.id)
    : -1;
  const existing = existingIndex >= 0 ? store.rules[existingIndex] : undefined;
  const rule: RepoPreferenceRule = {
    id: existing?.id || input.id || nextId(options),
    repo: input.repo,
    title,
    content,
    source: input.source?.trim() || existing?.source || null,
    status: input.status || existing?.status || 'approved',
    visibility: input.visibility || existing?.visibility || 'shared',
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
  };
  if (existingIndex >= 0) store.rules[existingIndex] = rule;
  else store.rules.push(rule);
  saveRepoPreferenceStore(store, storePath(options));
  return rule;
}

export function buildRepoRulesContext(
  repo: string,
  options?: RepoPreferenceOptions,
): string {
  const rules = listRepoRules(repo, options).filter(
    (rule) => rule.status === 'approved',
  );
  if (rules.length === 0) return '';
  return [
    'Repository coding rules and preferences:',
    ...rules.map((rule) => `- ${rule.title}: ${rule.content}`),
  ].join('\n');
}
