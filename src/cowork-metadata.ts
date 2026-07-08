export const COWORK_PROVENANCE_VALUES = [
  'manual',
  'manual-upload',
  'chat',
  'mcp-server',
  'generated-draft',
  'imported-source',
  'report-output',
  'research-ledger',
  'source-ledger',
  'unknown',
] as const;

export type CoworkProvenance = (typeof COWORK_PROVENANCE_VALUES)[number];

export const COWORK_SENSITIVITY_VALUES = [
  'public',
  'normal',
  'private',
  'confidential',
  'external',
  'approval-required',
  'unknown',
] as const;

export type CoworkSensitivity = (typeof COWORK_SENSITIVITY_VALUES)[number];

const PROVENANCE_ALIASES: Record<string, CoworkProvenance> = {
  manual: 'manual',
  'manual-note': 'manual',
  upload: 'manual-upload',
  'manual-upload': 'manual-upload',
  'manual upload': 'manual-upload',
  chat: 'chat',
  conversation: 'chat',
  mcp: 'mcp-server',
  'mcp-server': 'mcp-server',
  connector: 'mcp-server',
  gmail: 'mcp-server',
  mail: 'mcp-server',
  calendar: 'mcp-server',
  'google-docs': 'mcp-server',
  'google docs': 'mcp-server',
  generated: 'generated-draft',
  'generated-draft': 'generated-draft',
  'generated draft': 'generated-draft',
  imported: 'imported-source',
  'imported-source': 'imported-source',
  'imported source': 'imported-source',
  report: 'report-output',
  'report-output': 'report-output',
  'report output': 'report-output',
  'research-ledger': 'research-ledger',
  'research ledger': 'research-ledger',
  'source-ledger': 'source-ledger',
  'source ledger': 'source-ledger',
  unknown: 'unknown',
};

const SENSITIVITY_ALIASES: Record<string, CoworkSensitivity> = {
  public: 'public',
  normal: 'normal',
  private: 'private',
  sensitive: 'confidential',
  confidential: 'confidential',
  external: 'external',
  'approval-required': 'approval-required',
  'approval required': 'approval-required',
  approval: 'approval-required',
  unknown: 'unknown',
};

function normalizeLabel(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeCoworkProvenance(
  value: unknown,
  fallback: CoworkProvenance = 'unknown',
): CoworkProvenance {
  const key = normalizeLabel(value);
  return PROVENANCE_ALIASES[key] || fallback;
}

export function normalizeCoworkSensitivity(
  value: unknown,
  fallback: CoworkSensitivity = 'unknown',
): CoworkSensitivity {
  const key = normalizeLabel(value);
  return SENSITIVITY_ALIASES[key] || fallback;
}

export function isApprovalSensitiveCoworkItem(value: unknown): boolean {
  return ['private', 'confidential', 'external', 'approval-required'].includes(
    normalizeCoworkSensitivity(value),
  );
}
