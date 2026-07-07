export type BriefingPresetId = 'daily-operations' | 'weekly-operations';

export interface BriefingPreset {
  id: BriefingPresetId;
  title: string;
  schedule: 'daily' | 'weekly';
  request: string;
  sourceScopes: string[];
  outputFormats: string[];
  requireOutlineApproval: boolean;
}

export const BRIEFING_PRESETS: BriefingPreset[] = [
  {
    id: 'daily-operations',
    title: 'Daily Operations Briefing',
    schedule: 'daily',
    request:
      'Create a concise daily briefing from journal events, approved memory, GitHub activity, connector workflow status, and pending approvals. Highlight urgent items, decisions needed today, and follow-up tasks.',
    sourceScopes: ['journal', 'memory', 'github'],
    outputFormats: ['markdown'],
    requireOutlineApproval: true,
  },
  {
    id: 'weekly-operations',
    title: 'Weekly Operations Digest',
    schedule: 'weekly',
    request:
      'Create a weekly digest covering notable events, decisions, open risks, connector/coding activity, completed work, pending approvals, and recommended next actions.',
    sourceScopes: ['journal', 'memory', 'github', 'wiki'],
    outputFormats: ['markdown', 'html'],
    requireOutlineApproval: true,
  },
];

export function listBriefingPresets(): BriefingPreset[] {
  return BRIEFING_PRESETS;
}

export function getBriefingPreset(id: string): BriefingPreset | undefined {
  return BRIEFING_PRESETS.find((preset) => preset.id === id);
}
