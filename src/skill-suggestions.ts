import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export type SkillSuggestionStatus = 'suggested' | 'drafted' | 'dismissed';

export interface SkillSuggestionInput {
  name: string;
  description: string;
  reason: string;
  confidence: number;
  evidenceCount: number;
  instructions: string;
  provenance: string[];
}

export interface SkillSuggestion extends SkillSuggestionInput {
  id: string;
  status: SkillSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  draftId: string | null;
  dismissedAt: string | null;
}

const SUGGESTIONS_PATH = path.join(STORE_DIR, 'skill-suggestions.json');

function suggestionId(name: string): string {
  return `skill-suggestion:${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

function readSuggestions(): SkillSuggestion[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, 'utf-8')) as {
      suggestions?: SkillSuggestion[];
    };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  } catch {
    return [];
  }
}

function writeSuggestions(suggestions: SkillSuggestion[]): void {
  fs.mkdirSync(path.dirname(SUGGESTIONS_PATH), { recursive: true });
  fs.writeFileSync(
    SUGGESTIONS_PATH,
    `${JSON.stringify({ suggestions }, null, 2)}\n`,
  );
}

export function upsertSkillSuggestions(
  inputs: SkillSuggestionInput[],
  now = new Date().toISOString(),
): SkillSuggestion[] {
  const byId = new Map(readSuggestions().map((item) => [item.id, item]));
  for (const input of inputs) {
    const id = suggestionId(input.name);
    const existing = byId.get(id);
    if (existing?.status === 'dismissed' || existing?.status === 'drafted') {
      continue;
    }
    byId.set(id, {
      ...input,
      id,
      status: 'suggested',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastSeenAt: now,
      occurrenceCount: (existing?.occurrenceCount || 0) + 1,
      draftId: existing?.draftId || null,
      dismissedAt: null,
      confidence: Math.max(existing?.confidence || 0, input.confidence),
      evidenceCount: Math.max(
        existing?.evidenceCount || 0,
        input.evidenceCount,
      ),
      provenance: Array.from(
        new Set([...(existing?.provenance || []), ...input.provenance]),
      ),
    });
  }
  const suggestions = Array.from(byId.values()).sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      b.confidence - a.confidence ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  writeSuggestions(suggestions);
  return suggestions;
}

function statusRank(status: SkillSuggestionStatus): number {
  return status === 'suggested' ? 0 : status === 'drafted' ? 1 : 2;
}

export function listSkillSuggestions(
  status?: SkillSuggestionStatus,
): SkillSuggestion[] {
  return readSuggestions()
    .filter((suggestion) => !status || suggestion.status === status)
    .sort(
      (a, b) =>
        statusRank(a.status) - statusRank(b.status) ||
        b.confidence - a.confidence ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
}

export function markSkillSuggestionDrafted(
  id: string,
  draftId: string,
  now = new Date().toISOString(),
): SkillSuggestion {
  const suggestions = readSuggestions();
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error(`Skill suggestion not found: ${id}`);
  suggestion.status = 'drafted';
  suggestion.draftId = draftId;
  suggestion.updatedAt = now;
  writeSuggestions(suggestions);
  return suggestion;
}

export function dismissSkillSuggestion(
  id: string,
  now = new Date().toISOString(),
): SkillSuggestion {
  const suggestions = readSuggestions();
  const suggestion = suggestions.find((item) => item.id === id);
  if (!suggestion) throw new Error(`Skill suggestion not found: ${id}`);
  suggestion.status = 'dismissed';
  suggestion.dismissedAt = now;
  suggestion.updatedAt = now;
  writeSuggestions(suggestions);
  return suggestion;
}
