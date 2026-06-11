import fs from 'fs';
import path from 'path';

import { DATA_DIR, GROUPS_DIR } from './config.js';
import {
  readAgentInstructions,
  writeAgentInstructions,
} from './agent-instructions.js';

export interface AssistantSkillPreference {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
}

export interface AssistantProfile {
  personality: string;
  skillPreferences: AssistantSkillPreference[];
  updatedAt: string;
}

const PROFILE_PATH = path.join(DATA_DIR, 'assistant-profile.json');
const START_MARKER = '<!-- nanocrab-assistant-profile:start -->';
const END_MARKER = '<!-- nanocrab-assistant-profile:end -->';

export const DEFAULT_PERSONALITY =
  'Be clear, warm, practical, and careful with risky actions. Ask before external writes, publishing, uploads, or destructive changes.';

export const DEFAULT_SKILL_PREFERENCES: AssistantSkillPreference[] = [
  {
    id: 'memory',
    label: 'Memory',
    description: 'Lean on approved shared memory when it is relevant.',
    enabled: true,
  },
  {
    id: 'coding',
    label: 'Coding',
    description: 'Use staged coding workflows with approval gates.',
    enabled: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Prefer outlines, citations, and reviewable deliverables.',
    enabled: true,
  },
  {
    id: 'connectors',
    label: 'Connectors',
    description:
      'Use connector tools only within configured permission scopes.',
    enabled: false,
  },
  {
    id: 'operations',
    label: 'Operations',
    description: 'Track missions, reminders, and runbook progress.',
    enabled: true,
  },
];

export function defaultAssistantProfile(): AssistantProfile {
  return {
    personality: DEFAULT_PERSONALITY,
    skillPreferences: DEFAULT_SKILL_PREFERENCES.map((item) => ({ ...item })),
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadAssistantProfile(): AssistantProfile {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf-8'));
    const defaults = defaultAssistantProfile();
    const enabledById = new Map(
      Array.isArray(parsed.skillPreferences)
        ? parsed.skillPreferences.map((item: AssistantSkillPreference) => [
            item.id,
            item.enabled !== false,
          ])
        : [],
    );
    return {
      personality:
        typeof parsed.personality === 'string'
          ? parsed.personality
          : defaults.personality,
      skillPreferences: defaults.skillPreferences.map((item) => ({
        ...item,
        enabled: enabledById.has(item.id)
          ? !!enabledById.get(item.id)
          : item.enabled,
      })),
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : defaults.updatedAt,
    };
  } catch {
    return defaultAssistantProfile();
  }
}

export function saveAssistantProfile(input: {
  personality?: string;
  enabledSkillPreferenceIds?: string[];
}): AssistantProfile {
  const current = loadAssistantProfile();
  const enabled = new Set(input.enabledSkillPreferenceIds || []);
  const profile: AssistantProfile = {
    personality:
      typeof input.personality === 'string'
        ? input.personality.trim() || DEFAULT_PERSONALITY
        : current.personality,
    skillPreferences: current.skillPreferences.map((item) => ({
      ...item,
      enabled:
        input.enabledSkillPreferenceIds === undefined
          ? item.enabled
          : enabled.has(item.id),
    })),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(PROFILE_PATH), { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
  return profile;
}

export function assistantProfileBlock(profile: AssistantProfile): string {
  const enabledSkills = profile.skillPreferences
    .filter((item) => item.enabled)
    .map((item) => `- ${item.label}: ${item.description}`)
    .join('\n');
  return [
    START_MARKER,
    '## Assistant Profile',
    '',
    profile.personality,
    '',
    '### Skill Preferences',
    enabledSkills || '- No optional skill family preferences enabled.',
    END_MARKER,
  ].join('\n');
}

export function applyAssistantProfileBlock(
  content: string,
  profile: AssistantProfile,
): string {
  const block = assistantProfileBlock(profile);
  const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`, 'm');
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.trimEnd()}\n\n${block}\n`;
}

export function propagateAssistantProfileToGroups(
  profile: AssistantProfile,
  groupsDir = GROUPS_DIR,
): string[] {
  if (!fs.existsSync(groupsDir)) return [];
  const updated: string[] = [];
  for (const entry of fs.readdirSync(groupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const groupDir = path.join(groupsDir, entry.name);
    const content = readAgentInstructions(groupDir);
    writeAgentInstructions(
      groupDir,
      applyAssistantProfileBlock(content, profile),
    );
    updated.push(entry.name);
  }
  return updated;
}
