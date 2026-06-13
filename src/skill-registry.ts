import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import crypto from 'crypto';

import { CONTAINER_SKILLS_DIR, DATA_DIR, STORE_DIR } from './config.js';
import { canUseSkill, type AgentBoundary } from './agent-boundaries.js';
import {
  getSkillInstallState,
  type SkillInstallState,
} from './skill-versions.js';

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
  installState?: SkillInstallState;
}

export interface SkillMatch extends SkillRegistryEntry {
  score: number;
  reasons: string[];
}

export type SkillInjectionDecision =
  | 'injected'
  | 'excluded-disabled'
  | 'excluded-scope'
  | 'excluded-visibility'
  | 'excluded-connector-scope'
  | 'excluded-low-score'
  | 'excluded-count-limit'
  | 'excluded-byte-limit';

export interface SkillInjectionMatch extends SkillMatch {
  decision: SkillInjectionDecision;
  injectionReasons: string[];
  bytes: number;
}

export interface SkillSelectionResult {
  injected: SkillInjectionMatch[];
  excluded: SkillInjectionMatch[];
  totalBytes: number;
  limits: {
    maxCount: number;
    maxBytes: number;
    minScore: number;
    maxScore: number;
  };
}

export interface SkillRoutingTimelineEvent {
  id: string;
  type: 'skill.routing';
  timestamp: string;
  groupFolder: string;
  isMain: boolean;
  sessionId: string | null;
  request: string;
  injected: Array<{
    path: string;
    score: number;
    reasons: string[];
    bytes: number;
  }>;
  excluded: Array<{
    path: string;
    score: number;
    decision: SkillInjectionDecision;
    reasons: string[];
    bytes: number;
  }>;
  limits: SkillSelectionResult['limits'];
}

export interface SkillStateTimelineEvent {
  id: string;
  type: 'skill.state_changed';
  timestamp: string;
  skillPath: string;
  patch: Partial<SkillState>;
  state: SkillState;
}

const SKILL_STATE_PATH = path.join(STORE_DIR, 'skill-state.json');
const SKILL_STATE_TIMELINE_PATH = path.join(
  STORE_DIR,
  'skill-state-timeline.jsonl',
);
const SKILL_ROUTING_TIMELINE_PATH = path.join(
  STORE_DIR,
  'skill-routing-timeline.jsonl',
);
export const DEFAULT_SKILL_INJECTION_LIMIT = 8;
export const DEFAULT_SKILL_CONTEXT_MAX_BYTES = 64 * 1024;
export const DEFAULT_SKILL_MIN_SCORE = 1;
export const DEFAULT_SKILL_MAX_SCORE = 100;

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
  'browser-connector',
  'connector-catalog',
  'drive-files-connector',
  'github-connector',
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
    const raw = JSON.parse(
      fs.readFileSync(SKILL_STATE_PATH, 'utf-8'),
    ) as Record<string, Partial<SkillState>>;
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
  recordSkillStateTimeline({
    skillPath: skillName,
    patch,
    state: next,
  });
  return next;
}

function recordSkillStateTimeline(input: {
  skillPath: string;
  patch: Partial<SkillState>;
  state: SkillState;
}): SkillStateTimelineEvent {
  const event: SkillStateTimelineEvent = {
    id: `skill-state-${Date.now()}-${crypto.randomUUID()}`,
    type: 'skill.state_changed',
    timestamp: new Date().toISOString(),
    skillPath: input.skillPath,
    patch: input.patch,
    state: input.state,
  };
  fs.mkdirSync(path.dirname(SKILL_STATE_TIMELINE_PATH), { recursive: true });
  fs.appendFileSync(SKILL_STATE_TIMELINE_PATH, `${JSON.stringify(event)}\n`);
  return event;
}

export function listSkillStateTimeline(limit = 100): SkillStateTimelineEvent[] {
  try {
    return fs
      .readFileSync(SKILL_STATE_TIMELINE_PATH, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SkillStateTimelineEvent)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, Math.min(Math.max(limit, 1), 500));
  } catch {
    return [];
  }
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
    .filter(
      (token) => token.length >= 4 && !['when', 'with', 'from'].includes(token),
    );
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
      .map((p: string) =>
        p.replace('container/skills/', '').replace(/\/$/, ''),
      );
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
          triggers: triggers.length
            ? triggers
            : inferTriggers(name, description),
          examples: splitList(fm.examples),
          riskLevel,
          requiredTools: splitList(fm['required-tools'] || fm['allowed-tools']),
          installState: getSkillInstallState(dir.name),
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
  agentBoundary?: AgentBoundary,
): boolean {
  if (agentBoundary) return canUseSkill(agentBoundary, skill);
  if (!skill.enabled) return false;
  if (skill.scope === 'main' && !isMain) return false;
  if (skill.scope === 'channels' && isMain) return false;
  if (skill.visibility === 'private' && !isMain) return false;
  if (skill.visibility === 'system' && !isMain) return false;
  return true;
}

function exclusionReason(
  skill: Pick<SkillRegistryEntry, 'enabled' | 'scope' | 'visibility'>,
  isMain: boolean,
  agentBoundary?: AgentBoundary,
): SkillInjectionDecision | null {
  if (agentBoundary && !canUseSkill(agentBoundary, skill)) {
    if (!skill.enabled) return 'excluded-disabled';
    if (!agentBoundary.skillScopes.allowedScopes.includes(skill.scope)) {
      return 'excluded-scope';
    }
    return 'excluded-visibility';
  }
  if (!skill.enabled) return 'excluded-disabled';
  if (skill.scope === 'main' && !isMain) return 'excluded-scope';
  if (skill.scope === 'channels' && isMain) return 'excluded-scope';
  if (
    (skill.visibility === 'private' || skill.visibility === 'system') &&
    !isMain
  ) {
    return 'excluded-visibility';
  }
  return null;
}

function connectorIdFromToolPattern(pattern: string): string | null {
  const match = pattern.match(/^mcp__([^_]+(?:[-_][^_]+)*)__\*?$/);
  if (!match) return null;
  return match[1].replace(/[_-]?\*$/, '').replace(/_/g, '-');
}

function requiredConnectorIds(requiredTools: string[]): string[] {
  return Array.from(
    new Set(
      requiredTools
        .map(connectorIdFromToolPattern)
        .filter((connectorId): connectorId is string => Boolean(connectorId)),
    ),
  );
}

function connectorExclusionReason(
  skill: Pick<SkillRegistryEntry, 'requiredTools'>,
  agentBoundary?: AgentBoundary,
): SkillInjectionDecision | null {
  if (!agentBoundary) return null;
  const required = requiredConnectorIds(skill.requiredTools);
  if (required.length === 0) return null;
  const allowed = new Set(agentBoundary.connectorIds);
  return required.every((connectorId) => allowed.has(connectorId))
    ? null
    : 'excluded-connector-scope';
}

function clampScore(score: number, maxScore: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(Math.max(score, 0), maxScore);
}

function scoreSkill(skill: SkillRegistryEntry, request: string): SkillMatch {
  const text = request.toLowerCase();
  const terms = new Set(
    text
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
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
}

function skillDirectoryBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(dir).reduce((total, entry) => {
    return total + skillDirectoryBytes(path.join(dir, entry));
  }, 0);
}

export function selectSkillsForRequest(
  request: string,
  options: {
    isMain?: boolean;
    limit?: number;
    maxBytes?: number;
    minScore?: number;
    maxScore?: number;
    skills?: SkillRegistryEntry[];
    skillBytes?: Record<string, number>;
    agentBoundary?: AgentBoundary;
  } = {},
): SkillSelectionResult {
  const isMain = options.isMain ?? true;
  const maxCount = Math.max(
    0,
    Math.min(options.limit ?? DEFAULT_SKILL_INJECTION_LIMIT, 30),
  );
  const maxBytes = Math.max(
    0,
    options.maxBytes ?? DEFAULT_SKILL_CONTEXT_MAX_BYTES,
  );
  const minScore = Math.max(0, options.minScore ?? DEFAULT_SKILL_MIN_SCORE);
  const maxScore = Math.max(
    minScore,
    options.maxScore ?? DEFAULT_SKILL_MAX_SCORE,
  );
  const skills = options.skills ?? listSkillRegistry();
  const injected: SkillInjectionMatch[] = [];
  const excluded: SkillInjectionMatch[] = [];
  let totalBytes = 0;

  const scoreAndBytes = (skill: SkillRegistryEntry): SkillInjectionMatch => {
    const scored = scoreSkill(skill, request);
    const bytes =
      options.skillBytes?.[skill.path] ??
      skillDirectoryBytes(path.join(CONTAINER_SKILLS_DIR, skill.path));
    return {
      ...scored,
      score: clampScore(scored.score, maxScore),
      bytes,
      decision: 'injected',
      injectionReasons: [],
    };
  };

  const candidates: SkillInjectionMatch[] = [];
  for (const skill of skills) {
    const match = scoreAndBytes(skill);
    const authExclusion = exclusionReason(skill, isMain, options.agentBoundary);
    if (authExclusion) {
      excluded.push({
        ...match,
        decision: authExclusion,
        injectionReasons: [
          `excluded:${authExclusion.replace('excluded-', '')}`,
        ],
      });
      continue;
    }
    const connectorExclusion = connectorExclusionReason(
      skill,
      options.agentBoundary,
    );
    if (connectorExclusion) {
      excluded.push({
        ...match,
        decision: connectorExclusion,
        injectionReasons: ['excluded:connector-scope'],
      });
      continue;
    }
    if (match.score < minScore) {
      excluded.push({
        ...match,
        decision: 'excluded-low-score',
        injectionReasons: ['excluded:low-score'],
      });
      continue;
    }
    candidates.push(match);
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  for (const match of candidates) {
    if (injected.length >= maxCount) {
      excluded.push({
        ...match,
        decision: 'excluded-count-limit',
        injectionReasons: ['excluded:count-limit'],
      });
      continue;
    }
    if (totalBytes + match.bytes > maxBytes) {
      excluded.push({
        ...match,
        decision: 'excluded-byte-limit',
        injectionReasons: ['excluded:byte-limit'],
      });
      continue;
    }
    injected.push({
      ...match,
      decision: 'injected',
      injectionReasons: [
        ...match.reasons,
        `score:${match.score}`,
        `bytes:${match.bytes}`,
      ],
    });
    totalBytes += match.bytes;
  }

  return {
    injected,
    excluded: excluded.sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name),
    ),
    totalBytes,
    limits: { maxCount, maxBytes, minScore, maxScore },
  };
}

export function scoreSkillsForRequest(
  request: string,
  options: { isMain?: boolean; limit?: number } = {},
): SkillMatch[] {
  return selectSkillsForRequest(request, options).injected.map(
    ({
      decision: _decision,
      injectionReasons: _injectionReasons,
      bytes: _bytes,
      ...match
    }) => match,
  );
}

export function prepareActiveSkillsDirectory(options: {
  groupFolder: string;
  isMain: boolean;
  request?: string;
  limit?: number;
  maxBytes?: number;
  skills?: SkillRegistryEntry[];
  agentBoundary?: AgentBoundary;
}): string {
  const destination = path.join(
    DATA_DIR,
    'runtime-skills',
    options.groupFolder,
  );
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const registry = options.skills ?? listSkillRegistry();
  const activeSkills = options.request
    ? selectSkillsForRequest(options.request, {
        isMain: options.isMain,
        limit: options.limit,
        maxBytes: options.maxBytes,
        skills: registry,
        agentBoundary: options.agentBoundary,
      }).injected
    : registry
        .filter((skill) =>
          isSkillVisibleForGroup(skill, options.isMain, options.agentBoundary),
        )
        .slice(0, options.limit ?? DEFAULT_SKILL_INJECTION_LIMIT);
  for (const skill of activeSkills) {
    const source = path.join(CONTAINER_SKILLS_DIR, skill.path);
    const target = path.join(destination, skill.path);
    if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
  }
  fs.writeFileSync(
    path.join(destination, 'registry.json'),
    `${JSON.stringify(activeSkills, null, 2)}\n`,
  );
  return destination;
}

export function recordSkillRoutingDecision(input: {
  groupFolder: string;
  isMain: boolean;
  request: string;
  sessionId?: string;
  selection?: SkillSelectionResult;
}): SkillRoutingTimelineEvent {
  const selection =
    input.selection ||
    selectSkillsForRequest(input.request, { isMain: input.isMain });
  const event: SkillRoutingTimelineEvent = {
    id: `skill-routing-${Date.now()}-${crypto.randomUUID()}`,
    type: 'skill.routing',
    timestamp: new Date().toISOString(),
    groupFolder: input.groupFolder,
    isMain: input.isMain,
    sessionId: input.sessionId || null,
    request: input.request.slice(0, 500),
    injected: selection.injected.map((skill) => ({
      path: skill.path,
      score: skill.score,
      reasons: skill.injectionReasons,
      bytes: skill.bytes,
    })),
    excluded: selection.excluded.map((skill) => ({
      path: skill.path,
      score: skill.score,
      decision: skill.decision,
      reasons: skill.injectionReasons,
      bytes: skill.bytes,
    })),
    limits: selection.limits,
  };
  fs.mkdirSync(path.dirname(SKILL_ROUTING_TIMELINE_PATH), { recursive: true });
  fs.appendFileSync(SKILL_ROUTING_TIMELINE_PATH, `${JSON.stringify(event)}\n`);
  return event;
}

export function listSkillRoutingTimeline(
  limit = 100,
): SkillRoutingTimelineEvent[] {
  try {
    return fs
      .readFileSync(SKILL_ROUTING_TIMELINE_PATH, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SkillRoutingTimelineEvent)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, Math.min(Math.max(limit, 1), 500));
  } catch {
    return [];
  }
}
