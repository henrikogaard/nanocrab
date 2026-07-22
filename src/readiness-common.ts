/**
 * Shared readiness vocabulary and helpers for dashboard surfaces.
 * Provides consistent status labels, severity semantics, and recovery hints
 * across providers, coding runtimes, channels, and MCP connectors.
 */

import type { AgentRuntimeHealth } from './types.js';

export type ReadinessStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'unauthenticated'
  | 'stale'
  | 'unsupported'
  | 'error';

export type ReadinessSeverity = 'ok' | 'warning' | 'error' | 'info';

export interface ReadinessLabel {
  status: ReadinessStatus;
  severity: ReadinessSeverity;
  label: string;
  recoveryHint?: string;
}

export function normalizeReadinessStatus(
  status: 'healthy' | 'missing' | 'unsupported' | 'unauthenticated' | 'error',
): ReadinessStatus {
  switch (status) {
    case 'healthy':
      return 'healthy';
    case 'missing':
      return 'unavailable';
    case 'unsupported':
      return 'unsupported';
    case 'unauthenticated':
      return 'unauthenticated';
    case 'error':
      return 'error';
    default:
      return 'unavailable';
  }
}

export function getReadinessLabel(status: ReadinessStatus): ReadinessLabel {
  const labels: Record<ReadinessStatus, ReadinessLabel> = {
    healthy: { status: 'healthy', severity: 'ok', label: 'Healthy' },
    degraded: {
      status: 'degraded',
      severity: 'warning',
      label: 'Degraded',
      recoveryHint:
        'Partial functionality available. Review probe results for details.',
    },
    unavailable: {
      status: 'unavailable',
      severity: 'error',
      label: 'Unavailable',
      recoveryHint:
        'Runtime or service is not accessible. Verify installation and configuration.',
    },
    unauthenticated: {
      status: 'unauthenticated',
      severity: 'error',
      label: 'Not authenticated',
      recoveryHint:
        'Credentials are missing or expired. Configure credentials in Settings.',
    },
    stale: {
      status: 'stale',
      severity: 'warning',
      label: 'Stale',
      recoveryHint:
        'Probe data is outdated. Refresh readiness to get current status.',
    },
    unsupported: {
      status: 'unsupported',
      severity: 'info',
      label: 'Unsupported',
      recoveryHint:
        'This runtime requires additional setup or is not supported on this deployment.',
    },
    error: {
      status: 'error',
      severity: 'error',
      label: 'Error',
      recoveryHint:
        'A configuration or runtime error is preventing this service from working.',
    },
  };
  return labels[status];
}

export function isReadinessStale(
  checkedAt: string,
  thresholdMs = 5 * 60 * 1000,
): boolean {
  return Date.now() - new Date(checkedAt).getTime() > thresholdMs;
}

export function enrichReadiness(
  health: AgentRuntimeHealth,
): AgentRuntimeHealth & {
  normalizedStatus: ReadinessStatus;
  severity: ReadinessSeverity;
  label: string;
  recoveryHint?: string;
  isStale: boolean;
} {
  const normalized = normalizeReadinessStatus(health.status);
  const stale = isReadinessStale(health.checkedAt);
  const effectiveStatus = stale ? 'stale' : normalized;
  const labelInfo = getReadinessLabel(effectiveStatus);
  return {
    ...health,
    normalizedStatus: effectiveStatus,
    severity: labelInfo.severity,
    label: labelInfo.label,
    recoveryHint: labelInfo.recoveryHint,
    isStale: stale,
  };
}

export function readinessBadgeClass(severity: ReadinessSeverity): string {
  switch (severity) {
    case 'ok':
      return 'badge-success';
    case 'warning':
      return 'badge-warning';
    case 'error':
      return 'badge-error';
    case 'info':
      return 'badge-info';
  }
}
