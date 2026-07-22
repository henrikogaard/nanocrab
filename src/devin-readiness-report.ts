/**
 * Devin target-host readiness report and operator checklist.
 *
 * Distinguishes configured, healthy, unavailable, and blocked states.
 * Provides a read-only readiness report with sanitized diagnostics and
 * an operator checklist for deployment verification.
 */

import {
  DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
  isDevinSandboxAuthHandoffAvailable,
  probeAgentRuntime,
} from './agent-runtime-registry.js';
import { probeCodingRunnerReadiness } from './coding-runner-readiness.js';
import { logAuditEvent } from './audit-log.js';
import type { AgentRuntimeHealth } from './types.js';
import { isCredentialConfigured } from './coding-runner-readiness.js';

export type DevinReadinessState =
  | 'healthy'
  | 'configured'
  | 'unavailable'
  | 'blocked';

export interface DevinReadinessCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'skip' | 'warning';
  detail: string;
  actionable?: boolean;
  action?: string;
}

export interface DevinReadinessReport {
  checkedAt: string;
  state: DevinReadinessState;
  version: string | null;
  executable: string;
  checks: DevinReadinessCheck[];
  operatorChecklist: OperatorChecklistItem[];
  smokeTestApproved: boolean;
  rollbackEvidence: string | null;
}

export interface OperatorChecklistItem {
  id: string;
  label: string;
  required: boolean;
  verified: boolean;
  detail: string;
}

export function generateDevinReadinessReport(): DevinReadinessReport {
  const checks: DevinReadinessCheck[] = [];
  const checklist: OperatorChecklistItem[] = [];
  const now = new Date().toISOString();

  // Check 1: Executable presence
  checks.push({
    id: 'executable',
    label: 'Devin executable accessible',
    status: 'skip',
    detail: 'Will be verified by host runtime probe',
    actionable: true,
    action: 'Verify `which devin` resolves to an absolute path',
  });

  // Check 2: Sandbox auth handoff
  const sandboxAuthAvailable = isDevinSandboxAuthHandoffAvailable();
  checks.push({
    id: 'sandbox-auth-handoff',
    label: 'Sandbox auth handoff available',
    status: sandboxAuthAvailable ? 'pass' : 'fail',
    detail: sandboxAuthAvailable
      ? 'Credential mount and sandbox auth directory are configured'
      : DEVIN_SANDBOX_AUTH_HANDOFF_DETAIL,
    actionable: !sandboxAuthAvailable,
    action: sandboxAuthAvailable
      ? undefined
      : 'Configure Devin credential mount in agent container',
  });

  // Check 3: Credential configuration
  checks.push({
    id: 'credential-proxy',
    label: 'Credential proxy route configured',
    status: 'skip',
    detail: 'Verified by sandbox auth handoff check',
  });

  // Check 4: Workspace isolation
  checks.push({
    id: 'workspace-isolation',
    label: 'Workspace isolation',
    status: 'skip',
    detail: 'Per-job isolated workspaces are enforced by coding-jobs.ts',
  });

  // Check 5: Sandbox executable
  checks.push({
    id: 'sandbox-executable',
    label: 'Sandbox executable available',
    status: 'skip',
    detail: 'Verified at container build time (bwrap/sandbox-exec)',
  });

  // Build operator checklist
  checklist.push(
    {
      id: 'runtime-roots',
      label: 'Verify runtime roots (bin, config, data)',
      required: true,
      verified: false,
      detail:
        'Confirm Devin installation path, config directory, and data directory are accessible',
    },
    {
      id: 'credential-path',
      label: 'Verify credential path and permissions',
      required: true,
      verified: false,
      detail:
        'Confirm credential file is readable and mounted into the container',
    },
    {
      id: 'auth-status',
      label: 'Verify `devin auth status` readiness',
      required: true,
      verified: false,
      detail: 'Run `devin auth status` and verify Logged in state',
    },
    {
      id: 'sandbox-executable',
      label: 'Verify sandbox executable (bwrap or sandbox-exec)',
      required: true,
      verified: false,
      detail: 'Confirm sandbox binary exists and is executable',
    },
    {
      id: 'workspace-pin',
      label: 'Verify workspace pinning',
      required: true,
      verified: false,
      detail: 'Confirm coding jobs use isolated per-job workspaces',
    },
    {
      id: 'smoke-test-gate',
      label: 'Define smoke-test approval criteria',
      required: true,
      verified: false,
      detail:
        'Set explicit owner approval, scope, timeout, cancellation, and rollback criteria',
    },
  );

  // Determine overall state
  let state: DevinReadinessState = 'blocked';
  const failedChecks = checks.filter((c) => c.status === 'fail');

  if (failedChecks.length > 0) {
    state = 'blocked';
  } else if (sandboxAuthAvailable) {
    state = 'configured';
  } else {
    state = 'unavailable';
  }

  return {
    checkedAt: now,
    state,
    version: null,
    executable: 'devin',
    checks,
    operatorChecklist: checklist,
    smokeTestApproved: false,
    rollbackEvidence: null,
  };
}

export async function getDevinReadiness(): Promise<DevinReadinessReport> {
  const report = generateDevinReadinessReport();
  let health: AgentRuntimeHealth;
  try {
    health = await probeCodingRunnerReadiness('devin');
    report.version = health.version;
    report.executable = health.executable;
    if (health.status === 'healthy') {
      report.state = 'healthy';
      // Update checks based on health
      report.checks = report.checks.map((check) => {
        if (check.id === 'executable') {
          return {
            ...check,
            status: 'pass' as const,
            detail: `Executable: ${health.executable}`,
          };
        }
        return check;
      });
    }
  } catch {
    // Runtime probe not available; report stays as configured/blocked/unavailable
  }

  logAuditEvent({
    actor: 'system',
    actionType: 'devin.readiness-check',
    resource: 'devin',
    decision: 'allowed',
    context: { state: report.state, checkedAt: report.checkedAt },
  });

  return report;
}

export interface SmokeTestApprovalCriteria {
  scope: string[];
  timeout: number;
  cancellation: boolean;
  rollback: boolean;
  approvedBy: string;
  approvedAt: string;
}

export function createSmokeTestApproval(
  criteria: SmokeTestApprovalCriteria,
): SmokeTestApprovalCriteria {
  return {
    scope: criteria.scope,
    timeout: criteria.timeout,
    cancellation: criteria.cancellation,
    rollback: criteria.rollback,
    approvedBy: criteria.approvedBy,
    approvedAt: new Date().toISOString(),
  };
}
