import type { CoworkApprovalRisk, CoworkComplexity } from './types.js';

export type CoworkActionType =
  | 'chat'
  | 'research'
  | 'connector-read'
  | 'connector-write'
  | 'external-write'
  | 'file-delivery';

export interface CoworkRunEstimateInput {
  title?: unknown;
  prompt?: unknown;
  provider?: unknown;
  model?: unknown;
  actionType?: CoworkActionType;
  connectorIds?: string[];
  contextItemCount?: number;
  contextSizeBytes?: number;
}

export interface CoworkRunEstimate {
  complexity: CoworkComplexity;
  approvalRisk: CoworkApprovalRisk;
  provider: string | null;
  model: string | null;
  warnings: string[];
  toolClasses: string[];
  context: {
    itemCount: number;
    sizeBytes: number;
  };
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function selectedValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function estimateCoworkRun(
  input: CoworkRunEstimateInput,
): CoworkRunEstimate {
  const title = textValue(input.title);
  const prompt = textValue(input.prompt);
  const text = `${title}\n${prompt}`.toLowerCase();
  const connectorIds = Array.isArray(input.connectorIds)
    ? input.connectorIds.filter(Boolean)
    : [];
  const contextItemCount = Math.max(0, input.contextItemCount || 0);
  const contextSizeBytes = Math.max(0, input.contextSizeBytes || 0);
  const connectorTerms = [
    'mcp',
    'connector',
    'email',
    'mail',
    'calendar',
    'document',
    'artifact',
    'source',
    'browser',
    'research',
  ];
  const writeTerms = [
    'send',
    'publish',
    'upload',
    'webhook',
    'external',
    'write',
    'calendar edit',
    'delivery',
  ];
  const hasConnectorWork =
    connectorIds.length > 0 ||
    input.actionType === 'connector-read' ||
    input.actionType === 'connector-write' ||
    input.actionType === 'external-write' ||
    connectorTerms.some((term) => text.includes(term));
  const hasExternalWrite =
    input.actionType === 'connector-write' ||
    input.actionType === 'external-write' ||
    input.actionType === 'file-delivery' ||
    writeTerms.some((term) => text.includes(term));
  const isLargeContext = contextItemCount > 10 || contextSizeBytes > 1_000_000;
  const complexity: CoworkComplexity = hasConnectorWork
    ? 'connector-heavy'
    : isLargeContext || text.length > 600
      ? 'long'
      : text.length > 180 || contextItemCount > 3
        ? 'standard'
        : 'quick';
  const approvalRisk: CoworkApprovalRisk = hasExternalWrite
    ? 'high'
    : hasConnectorWork
      ? 'medium'
      : 'low';
  const warnings: string[] = [];
  if (approvalRisk === 'high') {
    warnings.push(
      'Write-capable or external delivery language requires approval before mutation.',
    );
  }
  if (isLargeContext) {
    warnings.push(
      'Large project context may increase runtime and model fallback risk.',
    );
  }

  return {
    complexity,
    approvalRisk,
    provider: selectedValue(input.provider),
    model: selectedValue(input.model),
    warnings,
    toolClasses: unique([
      hasConnectorWork ? 'connectors' : '',
      /\bresearch\b|\bbrowser\b|\bsources?\b|\bcitations?\b/.test(text) ||
      input.actionType === 'research'
        ? 'research'
        : '',
      hasExternalWrite ? 'external-write' : '',
      contextItemCount > 0 ? 'project-context' : '',
    ]),
    context: {
      itemCount: contextItemCount,
      sizeBytes: contextSizeBytes,
    },
  };
}
