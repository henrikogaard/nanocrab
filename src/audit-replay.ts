import { listApprovals } from './approvals.js';
import { listCodingJobTimeline } from './coding-jobs.js';
import type { AuditEntry } from './admin/security.js';

export type AuditReplaySource = 'admin' | 'approval' | 'coding-job';

export interface AuditReplayEvent {
  id: string;
  at: string;
  source: AuditReplaySource;
  action: string;
  actor?: string;
  target?: string;
  summary: string;
  details?: Record<string, unknown>;
}

function byNewest(a: AuditReplayEvent, b: AuditReplayEvent): number {
  return b.at.localeCompare(a.at);
}

export function buildAuditReplay(
  input: {
    adminEvents?: AuditEntry[];
    limit?: number;
    sources?: AuditReplaySource[];
  } = {},
): AuditReplayEvent[] {
  const sources = new Set<AuditReplaySource>(
    input.sources || ['admin', 'approval', 'coding-job'],
  );
  const events: AuditReplayEvent[] = [];

  if (sources.has('admin')) {
    for (const entry of input.adminEvents || []) {
      events.push({
        id: `admin:${entry.timestamp}:${entry.action}:${entry.ip}`,
        at: entry.timestamp,
        source: 'admin',
        action: entry.action,
        actor: entry.ip,
        summary: entry.details || entry.action,
        details: {
          ip: entry.ip,
          userAgent: entry.userAgent,
        },
      });
    }
  }

  if (sources.has('approval')) {
    for (const approval of listApprovals({ limit: input.limit || 100 })) {
      events.push({
        id: `approval:${approval.id}`,
        at: approval.reviewedAt || approval.createdAt,
        source: 'approval',
        action: `approval.${approval.status}`,
        actor: approval.reviewedBy || approval.requester,
        target:
          approval.targetType && approval.targetId
            ? `${approval.targetType}:${approval.targetId}`
            : approval.kind,
        summary: approval.title,
        details: {
          kind: approval.kind,
          risk: approval.risk,
          decisionNote: approval.decisionNote,
          payload: approval.payload,
        },
      });
    }
  }

  if (sources.has('coding-job')) {
    for (const item of listCodingJobTimeline(input.limit || 100)) {
      events.push({
        id: `coding-job:${item.jobId}:${item.id}`,
        at: item.at,
        source: 'coding-job',
        action: `coding.${item.kind}`,
        target: `coding-job:${item.jobId}`,
        summary: item.title,
        details: {
          repo: item.repo,
          status: item.status,
          issueNumber: item.issueNumber,
          prUrl: item.prUrl,
          ciStatus: item.ciStatus,
          detail: item.detail,
        },
      });
    }
  }

  return events.sort(byNewest).slice(0, Math.min(input.limit || 100, 500));
}
