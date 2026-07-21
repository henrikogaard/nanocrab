import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { redactAuditValue } from './audit-log.js';

export type PolicyRisk = 'low' | 'medium' | 'high';
export type PolicyDecisionStatus =
  | 'allowed'
  | 'requires_approval'
  | 'denied'
  | 'simulated';

export interface PolicyRule {
  id: string;
  actionPattern: string | string[];
  resourcePattern?: string | string[];
  risk: PolicyRisk;
  requireApproval?: boolean;
  allowDryRun?: boolean;
  deny?: boolean;
  explanation?: string;
}

export interface PolicyInput {
  actor: string;
  actorId?: string | null;
  actionType: string;
  resource?: string;
  context?: unknown;
  dryRun?: boolean;
}

export interface PolicyDecision {
  id: string;
  actionType: string;
  resource: string;
  risk: PolicyRisk;
  decision: PolicyDecisionStatus;
  approvalRequired: boolean;
  dryRunAllowed: boolean;
  explanation: string;
  matchedRuleIds: string[];
  context: unknown;
}

const POLICIES_PATH = path.join(STORE_DIR, 'policies.json');

const DEFAULT_RULES: PolicyRule[] = [
  {
    id: 'coding-writes',
    actionPattern: [
      'coding.implement',
      'coding.open_pr',
      'coding.close_pr',
      'coding.revert',
    ],
    risk: 'high',
    requireApproval: true,
    allowDryRun: true,
    explanation: 'Repository-changing coding actions require approval.',
  },
  {
    id: 'external-actions',
    actionPattern: ['channel.send', 'upload.*', 'provider.fallback'],
    risk: 'medium',
    requireApproval: false,
    allowDryRun: true,
    explanation: 'External actions are audited and may be simulated.',
  },
  {
    id: 'container-spawn',
    actionPattern: 'container.spawn',
    risk: 'medium',
    requireApproval: false,
    allowDryRun: true,
    explanation: 'Container execution is sandboxed and audited.',
  },
];

let cachedRules: PolicyRule[] | null = null;

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(
  pattern: string | string[] | undefined,
  value: string,
): boolean {
  if (!pattern) return true;
  const patterns = Array.isArray(pattern) ? pattern : [pattern];
  return patterns.some((item) => globToRegExp(item).test(value));
}

function normalizeRules(value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) return DEFAULT_RULES;
  return value
    .filter((rule): rule is Partial<PolicyRule> =>
      Boolean(rule && typeof rule === 'object'),
    )
    .map((rule) => ({
      id: String(rule.id || `policy-${crypto.randomBytes(3).toString('hex')}`),
      actionPattern: rule.actionPattern || '*',
      resourcePattern: rule.resourcePattern,
      risk: ['low', 'medium', 'high'].includes(String(rule.risk))
        ? (rule.risk as PolicyRisk)
        : 'medium',
      requireApproval: Boolean(rule.requireApproval),
      allowDryRun: Boolean(rule.allowDryRun),
      deny: Boolean(rule.deny),
      explanation:
        typeof rule.explanation === 'string' && rule.explanation.trim()
          ? rule.explanation
          : 'Matched NanoCrab policy rule.',
    }));
}

export function loadPolicyRules(): PolicyRule[] {
  if (cachedRules) return cachedRules;
  try {
    cachedRules = normalizeRules(
      JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8')),
    );
  } catch {
    cachedRules = DEFAULT_RULES;
    fs.mkdirSync(path.dirname(POLICIES_PATH), { recursive: true });
    fs.writeFileSync(
      POLICIES_PATH,
      `${JSON.stringify(DEFAULT_RULES, null, 2)}\n`,
    );
  }
  return cachedRules;
}

export function savePolicyRules(rules: PolicyRule[]): void {
  fs.mkdirSync(path.dirname(POLICIES_PATH), { recursive: true });
  fs.writeFileSync(POLICIES_PATH, `${JSON.stringify(rules, null, 2)}\n`);
  cachedRules = normalizeRules(rules);
}

export function resetPolicyRules(): void {
  cachedRules = null;
}

function inferredRisk(actionType: string): PolicyRisk {
  if (
    /(^coding\.(implement|open_pr|revert)$|push|commit|delete|send|upload|spawn)/i.test(
      actionType,
    )
  ) {
    return 'high';
  }
  if (/fallback|provider|tool|automation/i.test(actionType)) return 'medium';
  return 'low';
}

function highestRisk(risks: PolicyRisk[]): PolicyRisk {
  if (risks.includes('high')) return 'high';
  if (risks.includes('medium')) return 'medium';
  return 'low';
}

function sanitizeExplanation(text: string): string {
  return String(redactAuditValue(text)).slice(0, 800);
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const resource = input.resource || 'unknown';
  const matched = loadPolicyRules().filter(
    (rule) =>
      matchesPattern(rule.actionPattern, input.actionType) &&
      matchesPattern(rule.resourcePattern, resource),
  );
  const risk = matched.length
    ? highestRisk(matched.map((rule) => rule.risk))
    : inferredRisk(input.actionType);
  const dryRunAllowed =
    matched.some((rule) => rule.allowDryRun) || risk !== 'low';
  const denied = matched.some((rule) => rule.deny);
  const requiresApproval =
    matched.some((rule) => rule.requireApproval) ||
    (risk === 'high' && !matched.length);
  const decision: PolicyDecisionStatus = denied
    ? 'denied'
    : input.dryRun && dryRunAllowed
      ? 'simulated'
      : requiresApproval
        ? 'requires_approval'
        : 'allowed';

  return {
    id: `policy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    actionType: input.actionType,
    resource,
    risk,
    decision,
    approvalRequired: decision === 'requires_approval',
    dryRunAllowed,
    explanation: sanitizeExplanation(
      matched
        .map((rule) => rule.explanation)
        .filter(Boolean)
        .join(' ') || `Policy classified ${input.actionType} as ${risk} risk.`,
    ),
    matchedRuleIds: matched.map((rule) => rule.id),
    context: redactAuditValue(input.context || {}),
  };
}
