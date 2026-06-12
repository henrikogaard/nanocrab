import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { CONTAINER_SKILLS_DIR, STORE_DIR } from './config.js';

export type SkillDraftStatus = 'pending' | 'approved' | 'rejected';
export type SkillSuggestionStatus = 'pending' | 'approved' | 'rejected';
export type SkillSuggestionOwnerDecision = 'create-draft' | 'reject' | 'defer';

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

export interface ProposeSkillDraftInput {
  skillMd: string;
  createdBy: string;
  provenance?: string[];
}

export interface SkillSuggestion {
  id: string;
  proposedSkillName: string;
  description: string;
  confidence: number;
  status: SkillSuggestionStatus;
  ownerDecision: SkillSuggestionOwnerDecision | null;
  sourceExamples: string[];
  provenance: string[];
  createdBy: string;
  createdAt: string;
  reviewedAt: string | null;
  draftId: string | null;
}

export interface DetectSkillSuggestionsInput {
  messages?: string[];
  tasks?: string[];
  journal?: string[];
  createdBy: string;
  minExamples?: number;
  existingSkillNames?: string[];
}

const SKILL_DRAFTS_DIR = path.join(STORE_DIR, 'skill-drafts');
const SKILL_SUGGESTIONS_DIR = path.join(STORE_DIR, 'skill-suggestions');

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

function suggestionPath(id: string): string {
  return path.join(SKILL_SUGGESTIONS_DIR, `${id}.json`);
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

function normalizeSuggestionIntent(text: string): string {
  const lower = text.toLowerCase();
  const requestedSubject = lower.match(/\bwhen i ask for ([a-z0-9\s-]+?),/i);
  const subject = requestedSubject?.[1]?.trim() || '';
  const actionText =
    requestedSubject && lower.includes(',')
      ? `${lower.slice(lower.indexOf(',') + 1)} ${subject}`
      : lower;
  return actionText
    .toLowerCase()
    .replace(
      /\bfor (?:the )?(?:team|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)\b.*$/i,
      '',
    )
    .split(/\b(?:with|from|when|using|before|after)\b/)[0]
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(
      /\b(always|please|when|i|ask|for|in|the|a|an|and|to|should|could|would|make|create|draft|write|use|this|workflow)\b/g,
      ' ',
    )
    .replace(/\b(summarizes|summaries)\b/g, 'summarize')
    .replace(/\s+/g, ' ')
    .trim();
}

function suggestionNameFromIntent(intent: string): string {
  const name = intent
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return safeSkillName(name || 'workflow-skill');
}

function suggestionDescription(intent: string): string {
  return `Reusable workflow for ${intent}.`;
}

function looksSkillWorthySuggestion(text: string): boolean {
  return /\b(always|never|when i ask|please|workflow|use this|default)\b/i.test(
    text,
  );
}

function readSuggestion(id: string): SkillSuggestion | undefined {
  try {
    return JSON.parse(
      fs.readFileSync(suggestionPath(id), 'utf-8'),
    ) as SkillSuggestion;
  } catch {
    return undefined;
  }
}

function writeSuggestion(suggestion: SkillSuggestion): void {
  fs.mkdirSync(SKILL_SUGGESTIONS_DIR, { recursive: true });
  fs.writeFileSync(
    suggestionPath(suggestion.id),
    `${JSON.stringify(suggestion, null, 2)}\n`,
  );
}

function listAllSuggestions(): SkillSuggestion[] {
  if (!fs.existsSync(SKILL_SUGGESTIONS_DIR)) return [];
  return fs
    .readdirSync(SKILL_SUGGESTIONS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => readSuggestion(path.basename(file, '.json')))
    .filter((suggestion): suggestion is SkillSuggestion => Boolean(suggestion))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function buildSuggestionDraftMarkdown(suggestion: SkillSuggestion): string {
  const examples = suggestion.sourceExamples
    .slice(0, 5)
    .map((example) => `- ${example}`)
    .join('\n');
  return `---
name: ${suggestion.proposedSkillName}
description: ${JSON.stringify(suggestion.description)}
---

# ${suggestion.proposedSkillName
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')}

Use this skill when the user repeats this workflow or instruction pattern.

## Pattern

${suggestion.description}

## Source Examples

${examples}
`;
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
  writeDraft(draft);
  return draft;
}

export function detectAndQueueSkillSuggestions(
  input: DetectSkillSuggestionsInput,
): SkillSuggestion[] {
  const minExamples = Math.max(input.minExamples || 3, 3);
  const sources = [
    ...(input.messages || []).map((text) => ({
      text,
      provenance: 'source:message-history',
    })),
    ...(input.tasks || []).map((text) => ({
      text,
      provenance: 'source:task-history',
    })),
    ...(input.journal || []).map((text) => ({
      text,
      provenance: 'source:journal-history',
    })),
  ];
  const groups = new Map<
    string,
    { examples: string[]; provenance: Set<string>; skillWorthyExamples: number }
  >();
  for (const source of sources) {
    const intent = normalizeSuggestionIntent(source.text);
    if (!intent) continue;
    const group = groups.get(intent) || {
      examples: [],
      provenance: new Set<string>(),
      skillWorthyExamples: 0,
    };
    group.examples.push(source.text);
    group.provenance.add(source.provenance);
    if (
      source.provenance === 'source:journal-history' ||
      looksSkillWorthySuggestion(source.text)
    ) {
      group.skillWorthyExamples += 1;
    }
    groups.set(intent, group);
  }

  const existingNames = new Set([
    ...(input.existingSkillNames || []),
    ...listSkillDrafts().map((draft) => draft.name),
    ...listAllSuggestions().map((suggestion) => suggestion.proposedSkillName),
  ]);
  const queued: SkillSuggestion[] = [];
  const now = new Date().toISOString();
  for (const [intent, group] of groups) {
    if (group.examples.length < minExamples) continue;
    if (group.skillWorthyExamples < minExamples) continue;
    const proposedSkillName = suggestionNameFromIntent(intent);
    if (existingNames.has(proposedSkillName)) continue;
    const suggestion: SkillSuggestion = {
      id: `skill-suggestion-${Date.now()}-${crypto
        .randomBytes(4)
        .toString('hex')}`,
      proposedSkillName,
      description: suggestionDescription(intent),
      confidence: Math.min(0.95, 0.65 + (group.examples.length - 3) * 0.05),
      status: 'pending',
      ownerDecision: null,
      sourceExamples: group.examples.slice(0, 5),
      provenance: [...group.provenance],
      createdBy: input.createdBy,
      createdAt: now,
      reviewedAt: null,
      draftId: null,
    };
    writeSuggestion(suggestion);
    existingNames.add(proposedSkillName);
    queued.push(suggestion);
  }
  return queued.sort((a, b) => b.confidence - a.confidence);
}

export function listSkillSuggestions(
  filters: {
    status?: SkillSuggestionStatus;
  } = {},
): SkillSuggestion[] {
  return listAllSuggestions().filter(
    (suggestion) => !filters.status || suggestion.status === filters.status,
  );
}

export function approveSkillSuggestion(
  id: string,
  input: { decidedBy: string; decision?: SkillSuggestionOwnerDecision },
): SkillSuggestion {
  const suggestion = readSuggestion(id);
  if (!suggestion) throw new Error(`Skill suggestion not found: ${id}`);
  const decision = input.decision || 'create-draft';
  suggestion.ownerDecision = decision;
  suggestion.reviewedAt = new Date().toISOString();
  if (decision === 'reject') {
    suggestion.status = 'rejected';
    writeSuggestion(suggestion);
    return suggestion;
  }
  if (decision === 'defer') {
    suggestion.status = 'pending';
    writeSuggestion(suggestion);
    return suggestion;
  }
  const draft = proposeSkillDraft({
    skillMd: buildSuggestionDraftMarkdown(suggestion),
    createdBy: input.decidedBy,
    provenance: [
      ...suggestion.provenance,
      `source:skill-suggestion:${suggestion.id}`,
    ],
  });
  suggestion.status = 'approved';
  suggestion.draftId = draft.id;
  writeSuggestion(suggestion);
  return suggestion;
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
