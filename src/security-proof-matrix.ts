/**
 * Red-team proof matrix for NanoCrab security claims.
 *
 * Maps each security claim to one or more proof artifacts (audit event
 * fixtures, canary results, configuration checks) so an operator can see at a
 * glance which claims are proven, unproven, or failed on a given host. The
 * matrix is consumed by the admin dashboard and the `scripts/security-proof.ts`
 * doctor command.
 */
import { listAuditEvents } from './audit-log.js';
import {
  isContainerHardeningEnabled,
  isNetworkIsolationEnabled,
} from './container-runtime.js';
import { loadEgressAllowlist } from './egress-gateway.js';

export type ProofStatus = 'proven' | 'shipped' | 'unproven' | 'failed';

export interface SecurityProof {
  /** Claim identifier (e.g. 'default-deny-egress'). */
  claimId: string;
  /** Human-readable claim statement. */
  claim: string;
  /** Linked issue or epic number. */
  issue: number;
  /** Current proof status. */
  status: ProofStatus;
  /** Evidence supporting the status (audit event ids, config values, etc.). */
  evidence: string[];
  /** Operator action required to move from shipped -> proven. */
  operatorAction?: string;
}

export interface ProofMatrix {
  generatedAt: string;
  proofs: SecurityProof[];
  /** Counts by status. */
  summary: Record<ProofStatus, number>;
}

function countByStatus(proofs: SecurityProof[]): Record<ProofStatus, number> {
  const summary: Record<ProofStatus, number> = {
    proven: 0,
    shipped: 0,
    unproven: 0,
    failed: 0,
  };
  for (const p of proofs) summary[p.status]++;
  return summary;
}

/**
 * Build the proof matrix from the live host state. Claims that depend on
 * operator action (running the canary, configuring a signing key) are marked
 * `shipped` rather than `proven` until that action is taken.
 */
export function buildProofMatrix(): ProofMatrix {
  const proofs: SecurityProof[] = [];

  // Claim: default-deny agent network topology
  const networkOn = isNetworkIsolationEnabled();
  proofs.push({
    claimId: 'default-deny-network',
    claim:
      'Agent containers cannot reach unknown destinations directly; the credential/egress proxy is the only approved outbound path.',
    issue: 219,
    status: networkOn ? 'shipped' : 'unproven',
    evidence: [
      `CONTAINER_NETWORK_ISOLATION=${networkOn ? 'on' : 'off'}`,
      'Run `npx tsx scripts/egress-canary.ts` to prove default-deny on this host.',
    ],
    operatorAction:
      'Run scripts/egress-canary.ts on the target host and confirm exit 0.',
  });

  // Claim: destination-bound credential egress gateway
  const allowlist = loadEgressAllowlist();
  const denyEvents = listAuditEvents({
    actionType: 'network.egress.deny',
    limit: 1000,
  });
  const allowEvents = listAuditEvents({
    actionType: 'network.egress.allow',
    limit: 1000,
  });
  proofs.push({
    claimId: 'destination-bound-egress',
    claim:
      'The credential proxy allowlists destinations and only injects credentials for the destination they are bound to; deny decisions are audited.',
    issue: 220,
    status: allowlist.destinations.length > 0 ? 'shipped' : 'unproven',
    evidence: [
      `allowlist destinations: ${allowlist.destinations.length}`,
      `network.egress.allow events: ${allowEvents.length}`,
      `network.egress.deny events: ${denyEvents.length}`,
      'Proof: send a request through the proxy to an unknown host and confirm a 403 + network.egress.deny audit event.',
    ],
    operatorAction:
      'Trigger a denied egress request and confirm the audit event appears in /api/runtime-audit?actionType=network.egress.deny.',
  });

  // Claim: container hardening flags
  const hardeningOn = isContainerHardeningEnabled();
  proofs.push({
    claimId: 'container-hardening',
    claim:
      'Agent containers run with --read-only, --cap-drop=ALL, --security-opt=no-new-privileges, and tmpfs for writable paths.',
    issue: 221,
    status: hardeningOn ? 'shipped' : 'unproven',
    evidence: [
      `CONTAINER_HARDENING=${hardeningOn ? 'on' : 'off'}`,
      'Proof: spawn an agent container and run `docker inspect` to confirm the flags.',
    ],
    operatorAction:
      'Run an agent task and inspect the container to confirm the hardening flags are applied.',
  });

  // Claim: tamper-evident audit export
  proofs.push({
    claimId: 'tamper-evident-audit',
    claim:
      'Audit exports are hash-chained and HMAC-signed so any after-the-fact modification is detectable.',
    issue: 222,
    status: 'shipped',
    evidence: [
      'buildTamperEvidentExport() / verifyTamperEvidentExport() in src/audit-export.ts',
      'GET /api/runtime-audit/export/tamper-evident produces a signed export.',
      'Set AUDIT_EXPORT_KEY to a long-lived secret for cross-host verification.',
    ],
    operatorAction:
      'Generate an export, mutate one event, and confirm verifyTamperEvidentExport() reports mutatedEventIndices.',
  });

  // Claim: audit red-team smoke fixtures
  proofs.push({
    claimId: 'audit-red-team-fixtures',
    claim:
      'Red-team smoke fixtures inject known audit events so the chain can be verified end-to-end.',
    issue: 222,
    status: 'shipped',
    evidence: [
      'src/audit-export.test.ts covers build/verify, mutation detection, broken-link detection, and signature validation.',
      'scripts/security-proof.ts runs the full matrix and exits non-zero on unproven/failed claims.',
    ],
  });

  return {
    generatedAt: new Date().toISOString(),
    proofs,
    summary: countByStatus(proofs),
  };
}
