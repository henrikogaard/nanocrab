import type { ApprovalKind } from './approvals.js';
import type { ProviderToolPolicy } from './provider-router.js';

export type ActionPolicyDecision = 'allow' | 'deny' | 'approval-required';

export type ActionPolicyAction =
  | 'read'
  | 'write'
  | 'publish'
  | 'external-message'
  | 'upload'
  | 'shell'
  | 'pr'
  | 'coding-implement'
  | 'coding-open-pr'
  | 'provider-fallback';

export interface ActionPolicyInput {
  action: ActionPolicyAction;
  toolPolicy?: ProviderToolPolicy;
  approved?: boolean;
  dryRun?: boolean;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}

export interface ActionPolicyResult {
  decision: ActionPolicyDecision;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  approvalKind?: ApprovalKind;
  dryRun?: boolean;
  targetType?: string;
  targetId?: string;
  payload: Record<string, unknown>;
}

const APPROVAL_KIND_BY_ACTION: Partial<
  Record<ActionPolicyAction, ApprovalKind>
> = {
  'provider-fallback': 'provider-fallback',
  'coding-implement': 'coding-implement',
  'coding-open-pr': 'coding-open-pr',
  pr: 'coding-open-pr',
  publish: 'publish',
  'external-message': 'external-message',
  upload: 'upload',
  shell: 'tool-action',
  write: 'tool-action',
};

function isReadOnlyAction(action: ActionPolicyAction): boolean {
  return action === 'read';
}

function riskForAction(action: ActionPolicyAction): ActionPolicyResult['risk'] {
  if (isReadOnlyAction(action)) return 'low';
  if (action === 'shell' || action === 'publish' || action === 'upload') {
    return 'high';
  }
  if (
    action === 'provider-fallback' ||
    action === 'coding-open-pr' ||
    action === 'pr' ||
    action === 'external-message'
  ) {
    return 'high';
  }
  return 'medium';
}

export function evaluateActionPolicy(
  input: ActionPolicyInput,
): ActionPolicyResult {
  const toolPolicy = input.toolPolicy || 'approval-required';
  const base = {
    risk: riskForAction(input.action),
    approvalKind: APPROVAL_KIND_BY_ACTION[input.action],
    dryRun: input.dryRun === true,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload || {},
  };

  if (toolPolicy === 'deny') {
    return {
      ...base,
      decision: 'deny',
      reason: 'Tool policy denies this action',
    };
  }

  if (isReadOnlyAction(input.action)) {
    return {
      ...base,
      decision: 'allow',
      reason: 'Read-only action is allowed by policy',
    };
  }

  if (input.dryRun) {
    return {
      ...base,
      decision: 'approval-required',
      reason: 'Dry-run mode: action would require explicit approval',
    };
  }

  if (toolPolicy === 'allow' || input.approved) {
    return {
      ...base,
      decision: 'allow',
      reason: input.approved
        ? 'Action has an approved policy decision'
        : 'Tool policy allows this action',
    };
  }

  return {
    ...base,
    decision: 'approval-required',
    reason: 'Action requires explicit approval',
  };
}
