import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import { CONTAINER_SKILLS_DIR, DATA_DIR, STORE_DIR } from './config.js';

export type SkillScope = 'all' | 'main' | 'channels';
export type SkillVisibility = 'shared' | 'private' | 'system';

export interface SkillState {
  enabled: boolean;
  scope: SkillScope;
  visibility: SkillVisibility;
}

export interface SkillRegistryEntry {
  name: string;
  description: string;
  path: string;
  category: 'core' | 'plugin' | 'tool' | 'custom';
  enabled: boolean;
  scope: SkillScope;
  visibility: SkillVisibility;
  triggers: string[];
  examples: string[];
  riskLevel: 'low' | 'medium' | 'high';
  requiredTools: string[];
}

export interface SkillMatch extends SkillRegistryEntry {
  score: number;
  reasons: string[];
}

const SKILL_STATE_PATH = path.join(STORE_DIR, 'skill-state.json');

export const CORE_SKILLS = [
  'agent-browser',
  'calendar-assistant',
  'capabilities',
  'code-reviewer',
  'contact-context',
  'document-reviewer',
  'email-assistant',
  'github-issue-agent',
  'incident-analyst',
  'inbox-triage',
  'journalist',
  'meeting-briefing',
  'memory-curator',
  'ops-commander',
  'release-manager',
  'report-writer',
  'security-reviewer',
  'status',
  'task-planner',
  'automation-designer',
  'web-researcher',
  'slack-formatting',
] as const;

export const PLUGIN_SKILLS = [
  'agent-messaging',
  'google-workspace',
  'infomaniak-ksuite',
] as const;

function defaultState(): SkillState {
  return { enabled: true, scope: 'all', visibility: 'shared' };
}

function normalizeState(value: Partial<SkillState> | undefined): SkillState {
  const fallback = defaultState();
  return {
    enabled:
      typeof value?.enabled === 'boolean' ? value.enabled : fallback.enabled,
    scope:
      value?.scope === 'main' || value?.scope === 'channels'
        ? value.scope
        : fallback.scope,
    visibility:
      value?.visibility === 'private' || value?.visibility === 'system'
        ? value.visibility
        : fallback.visibility,
  };
}

export function loadSkillState(): Record<string, SkillState> {
  try {
    const raw = JSON.parse(fs.readFileSync(SKILL_STATE_PATH, 'utf-8')) as Record<
      string,
      Partial<SkillState>
    >;
    return Object.fromEntries(
      Object.entries(raw).map(([name, state]) => [name, normalizeState(state)]),
    );
  } catch {
    return {};
  }
}

export function saveSkillState(state: Record<string, SkillState>): void {
  fs.mkdirSync(path.dirname(SKILL_STATE_PATH), { recursive: true });
  fs.writeFileSync(SKILL_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export function updateSkillState(
  skillName: string,
  patch: Partial<SkillState>,
): SkillState {
  const state = loadSkillState();
  const next = normalizeState({ ...state[skillName], ...patch });
  state[skillName] = next;
  saveSkillState(state);
  return next;
}

export function isSkillEnabled(skillName: string): boolean {
  return loadSkillState()[skillName]?.enabled !== false;
}

function parseFrontmatter(content: string): Record<string, string> {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return {};
  const values: Record<string, string> = {};
  for (const line of fmMatch[1].split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return values;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferTriggers(name: string, description: string): string[] {
  const tokens = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !['when', 'with', 'from'].includes(token));
  return Array.from(new Set(tokens)).slice(0, 16);
}

export function listSkillRegistry(): SkillRegistryEntry[] {
  const state = loadSkillState();
  let gitIgnored: string[] = [];
  try {
    const output = fs.existsSync(path.join(process.cwd(), '.git'))
      ? execFileSync(
          'git',
          [
            'ls-files',
            '--others',
            '--ignored',
            '--exclude-standard',
            '--directory',
            'container/skills/',
          ],
          { cwd: process.cwd(), encoding: 'utf-8', timeout: 5000 },
        ).toString()
      : '';
    gitIgnored = output
      .split('\n')
      .filter(Boolean)
      .map((p: string) => p.replace('container/skills/', '').replace(/\/$/, ''));
  } catch {
    gitIgnored = [];
  }

  try {
    return fs
      .readdirSync(CONTAINER_SKILLS_DIR, { withFileTypes: true })
      .filter((dir) => dir.isDirectory())
      .map((dir) => {
        const skillMd = path.join(CONTAINER_SKILLS_DIR, dir.name, 'SKILL.md');
        const content = fs.existsSync(skillMd)
          ? fs.readFileSync(skillMd, 'utf-8')
          : '';
        const fm = parseFrontmatter(content);
        const name = fm.name || dir.name;
        const description = fm.description || '';
        const skillState = normalizeState(state[dir.name]);
        const category = gitIgnored.includes(dir.name)
          ? 'custom'
          : (CORE_SKILLS as readonly string[]).includes(dir.name)
            ? 'core'
            : (PLUGIN_SKILLS as readonly string[]).includes(dir.name)
              ? 'plugin'
              : 'tool';
        const riskLevel =
          fm['risk-level'] === 'high' || fm['risk-level'] === 'medium'
            ? fm['risk-level']
            : 'low';
        const triggers = splitList(fm.triggers);
        return {
          name,
          description,
          path: dir.name,
          category,
          enabled: skillState.enabled,
          scope: skillState.scope,
          visibility: skillState.visibility,
          triggers: triggers.length ? triggers : inferTriggers(name, description),
          examples: splitList(fm.examples),
          riskLevel,
          requiredTools: splitList(fm['required-tools'] || fm['allowed-tools']),
        } satisfies SkillRegistryEntry;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function isSkillVisibleForGroup(
  skill: Pick<SkillRegistryEntry, 'enabled' | 'scope' | 'visibility'>,
  isMain: boolean,
): boolean {
  if (!skill.enabled) return false;
  if (skill.scope === 'main' && !isMain) return false;
  if (skill.scope === 'channels' && isMain) return false;
  if (skill.visibility === 'private' && !isMain) return false;
  return true;
}

export function scoreSkillsForRequest(
  request: string,
  options: { isMain?: boolean; limit?: number } = {},
): SkillMatch[] {
  const text = request.toLowerCase();
  const terms = new Set(
    text
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
  return listSkillRegistry()
    .filter((skill) => isSkillVisibleForGroup(skill, options.isMain ?? true))
    .map((skill) => {
      const reasons: string[] = [];
      let score = 0;
      for (const trigger of skill.triggers) {
        const normalized = trigger.toLowerCase();
        if (text.includes(normalized) || terms.has(normalized)) {
          score += 6;
          reasons.push(`trigger:${trigger}`);
        }
      }
      for (const token of inferTriggers(skill.name, skill.description)) {
        if (terms.has(token)) {
          score += 2;
          reasons.push(`keyword:${token}`);
        }
      }
      for (const example of skill.examples) {
        const overlap = inferTriggers(skill.name, example).filter((token) =>
          terms.has(token),
        ).length;
        if (overlap > 0) {
          score += overlap;
          reasons.push('example-match');
        }
      }
      if (skill.name && text.includes(skill.name.toLowerCase())) {
        score += 20;
        reasons.push('name-match');
      }
      return { ...skill, score, reasons };
    })
    .filter((skill) => skill.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, options.limit ?? 8);
}

export function prepareActiveSkillsDirectory(options: {
  groupFolder: string;
  isMain: boolean;
}): string {
  const destination = path.join(DATA_DIR, 'runtime-skills', options.groupFolder);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const skill of listSkillRegistry()) {
    if (!isSkillVisibleForGroup(skill, options.isMain)) continue;
    const source = path.join(CONTAINER_SKILLS_DIR, skill.path);
    const target = path.join(destination, skill.path);
    if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
  }
  fs.writeFileSync(
    path.join(destination, 'registry.json'),
    `${JSON.stringify(
      listSkillRegistry().filter((skill) =>
        isSkillVisibleForGroup(skill, options.isMain),
      ),
      null,
      2,
    )}\n`,
  );
  return destination;
}
