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
  source: string;
  correlationId: string | null;
  expiresAt: string | null;
  actionPreview: string | null;
  resourceSummary: string | null;
  policyDecisionId: string | null;
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
  source?: string;
  correlationId?: string | null;
  expiresAt?: string | null;
  actionPreview?: string | null;
  resourceSummary?: string | null;
  policyDecisionId?: string | null;
  payload?: Record<string, unknown>;
}

const APPROVALS_PATH = path.join(STORE_DIR, 'approvals.json');

export interface ApprovalFilters {
  status?: ApprovalStatus;
  risk?: ApprovalRequest['risk'];
  kind?: ApprovalKind;
  requester?: string;
  targetType?: string;
  targetId?: string;
  correlationId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isPastDeadline(approval: ApprovalRequest, now = new Date()): boolean {
  if (!approval.expiresAt) return false;
  const expiresAt = Date.parse(approval.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function isExpiredPending(
  approval: ApprovalRequest,
  now = new Date(),
): boolean {
  return approval.status === 'pending' && isPastDeadline(approval, now);
}

function markExpired(approval: ApprovalRequest): void {
  approval.status = 'expired';
  approval.reviewedAt = new Date().toISOString();
  approval.reviewedBy = 'system';
  approval.decisionNote = 'Expired before review';
}

function normalizeApproval(record: Partial<ApprovalRequest>): ApprovalRequest {
  const createdAt = stringOrNull(record.createdAt) || new Date(0).toISOString();
  return {
    id: String(record.id || ''),
    kind: record.kind as ApprovalKind,
    title: String(record.title || ''),
    summary: String(record.summary || ''),
    risk: record.risk || 'medium',
    requester: String(record.requester || 'system'),
    targetType: stringOrUndefined(record.targetType),
    targetId: stringOrUndefined(record.targetId),
    source: stringOrNull(record.source) || 'legacy',
    correlationId: stringOrNull(record.correlationId),
    expiresAt: stringOrNull(record.expiresAt),
    actionPreview: stringOrNull(record.actionPreview),
    resourceSummary: stringOrNull(record.resourceSummary),
    policyDecisionId: stringOrNull(record.policyDecisionId),
    payload:
      record.payload && typeof record.payload === 'object'
        ? record.payload
        : {},
    status: record.status || 'pending',
    createdAt,
    reviewedAt: stringOrNull(record.reviewedAt),
    reviewedBy: stringOrNull(record.reviewedBy),
    decisionNote: stringOrNull(record.decisionNote),
  };
}

function readApprovals(): ApprovalRequest[] {
  try {
    const records = JSON.parse(fs.readFileSync(APPROVALS_PATH, 'utf-8'));
    if (!Array.isArray(records)) return [];
    return records.map((record) =>
      normalizeApproval(record as Partial<ApprovalRequest>),
    );
  } catch {
    return [];
  }
}

function writeApprovals(approvals: ApprovalRequest[]): void {
  fs.mkdirSync(path.dirname(APPROVALS_PATH), { recursive: true });
  fs.writeFileSync(APPROVALS_PATH, `${JSON.stringify(approvals, null, 2)}\n`);
}

function readApprovalsWithExpiredSweep(): ApprovalRequest[] {
  const approvals = readApprovals();
  let changed = false;
  for (const approval of approvals) {
    if (isExpiredPending(approval)) {
      markExpired(approval);
      changed = true;
    }
  }
  if (changed) writeApprovals(approvals);
  return approvals;
}

export function listApprovals(
  filters: ApprovalFilters = {},
): ApprovalRequest[] {
  return readApprovalsWithExpiredSweep()
    .filter((approval) => !filters.status || approval.status === filters.status)
    .filter((approval) => !filters.risk || approval.risk === filters.risk)
    .filter((approval) => !filters.kind || approval.kind === filters.kind)
    .filter(
      (approval) =>
        !filters.requester || approval.requester === filters.requester,
    )
    .filter(
      (approval) =>
        !filters.targetType || approval.targetType === filters.targetType,
    )
    .filter(
      (approval) => !filters.targetId || approval.targetId === filters.targetId,
    )
    .filter(
      (approval) =>
        !filters.correlationId ||
        approval.correlationId === filters.correlationId,
    )
    .filter(
      (approval) =>
        !filters.createdFrom || approval.createdAt >= filters.createdFrom,
    )
    .filter(
      (approval) =>
        !filters.createdTo || approval.createdAt <= filters.createdTo,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(Math.max(filters.limit || 100, 1), 500));
}

export function getApproval(id: string): ApprovalRequest | undefined {
  return readApprovals().find((approval) => approval.id === id);
}

export function createApproval(input: CreateApprovalInput): ApprovalRequest {
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
    source: input.source || 'system',
    correlationId: input.correlationId || null,
    expiresAt: input.expiresAt || null,
    actionPreview: input.actionPreview || null,
    resourceSummary: input.resourceSummary || null,
    policyDecisionId: input.policyDecisionId || null,
    payload: input.payload || {},
    status: 'pending',
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
  };
  const approvals = readApprovals();
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
  if (isExpiredPending(approval)) {
    markExpired(approval);
    writeApprovals(approvals);
    throw new Error('Approval is expired');
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
): boolean {
  return readApprovals().some(
    (approval) =>
      approval.kind === kind &&
      approval.targetType === targetType &&
      approval.targetId === targetId &&
      approval.status === 'approved' &&
      !isPastDeadline(approval),
  );
}

export function findPendingApprovalForTarget(
  kind: ApprovalKind,
  targetType: string,
  targetId: string,
): ApprovalRequest | undefined {
  return readApprovalsWithExpiredSweep().find(
    (approval) =>
      approval.kind === kind &&
      approval.targetType === targetType &&
      approval.targetId === targetId &&
      approval.status === 'pending',
  );
}
