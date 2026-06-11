import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

export type ApprovalKind =
  | 'provider-fallback'
  | 'coding-implement'
  | 'coding-open-pr'
  | 'coding-revert'
  | 'report-outline'
  | 'report-delivery'
  | 'publish'
  | 'external-message'
  | 'upload'
  | 'tool-action';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  requester: string;
  targetType?: string;
  targetId?: string;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
}

export interface CreateApprovalInput {
  kind: ApprovalKind;
  title: string;
  summary: string;
  risk?: ApprovalRequest['risk'];
  requester?: string;
  targetType?: string;
  targetId?: string;
  payload?: Record<string, unknown>;
}

const APPROVALS_PATH = path.join(STORE_DIR, 'approvals.json');

function readApprovals(): ApprovalRequest[] {
  try {
    return JSON.parse(
      fs.readFileSync(APPROVALS_PATH, 'utf-8'),
    ) as ApprovalRequest[];
  } catch {
    return [];
  }
}

function writeApprovals(approvals: ApprovalRequest[]): void {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.writeFileSync(APPROVALS_PATH, `${JSON.stringify(approvals, null, 2)}\n`);
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`;
}

function payloadMatches(
  payload: Record<string, unknown>,
  expected?: Record<string, unknown>,
): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(
    ([key, value]) => stableJson(payload[key]) === stableJson(value),
  );
}

export function listApprovals(
  filters: {
    status?: ApprovalStatus;
    kind?: ApprovalKind;
    targetType?: string;
    targetId?: string;
    limit?: number;
  } = {},
): ApprovalRequest[] {
  return readApprovals()
    .filter((approval) => !filters.status || approval.status === filters.status)
    .filter((approval) => !filters.kind || approval.kind === filters.kind)
    .filter(
      (approval) =>
        !filters.targetType || approval.targetType === filters.targetType,
    )
    .filter(
      (approval) => !filters.targetId || approval.targetId === filters.targetId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(Math.max(filters.limit || 100, 1), 500));
}

export function getApproval(id: string): ApprovalRequest | undefined {
  return readApprovals().find((approval) => approval.id === id);
}

export function createApproval(input: CreateApprovalInput): ApprovalRequest {
  const approvals = readApprovals();
  const existing = approvals.find(
    (approval) =>
      approval.status === 'pending' &&
      approval.kind === input.kind &&
      approval.targetType === input.targetType &&
      approval.targetId === input.targetId &&
      stableJson(approval.payload) === stableJson(input.payload || {}),
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const approval: ApprovalRequest = {
    id: `approval-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    kind: input.kind,
    title: input.title.trim().slice(0, 180),
    summary: input.summary.trim().slice(0, 4000),
    risk: input.risk || 'medium',
    requester: input.requester || 'system',
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload || {},
    status: 'pending',
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  };
  approvals.push(approval);
  writeApprovals(approvals);
  return approval;
}

export function reviewApproval(
  id: string,
  status: Extract<ApprovalStatus, 'approved' | 'denied'>,
  reviewedBy: string,
  decisionNote?: string,
): ApprovalRequest {
  const approvals = readApprovals();
  const approval = approvals.find((item) => item.id === id);
  if (!approval) throw new Error(`Approval not found: ${id}`);
  if (approval.status !== 'pending') {
    throw new Error(`Approval is already ${approval.status}`);
  }
  approval.status = status;
  approval.reviewedAt = new Date().toISOString();
  approval.reviewedBy = reviewedBy;
  approval.decisionNote = decisionNote || null;
  writeApprovals(approvals);
  return approval;
}

export function hasApprovedTarget(
  kind: ApprovalKind,
  targetType: string,
  targetId: string,
  payload?: Record<string, unknown>,
): boolean {
  return readApprovals().some(
    (approval) =>
      approval.kind === kind &&
      approval.targetType === targetType &&
      approval.targetId === targetId &&
      approval.status === 'approved' &&
      payloadMatches(approval.payload, payload),
  );
}
