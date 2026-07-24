import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./container-runtime.js', () => ({
  isNetworkIsolationEnabled: vi.fn(() => true),
  isContainerHardeningEnabled: vi.fn(() => true),
}));

vi.mock('./egress-gateway.js', () => ({
  loadEgressAllowlist: () => ({
    destinations: [
      {
        id: 'anthropic',
        host: 'api.anthropic.com',
        credentialId: 'ANTHROPIC_API_KEY',
        port: 443,
        reason: 'default',
      },
    ],
  }),
}));

import { buildProofMatrix } from './security-proof-matrix.js';
import { listAuditEvents } from './audit-log.js';
import { _closeDatabase, _initTestDatabase } from './db.js';

beforeEach(() => {
  vi.clearAllMocks();
  try {
    _closeDatabase();
  } catch {
    /* database may not be initialized */
  }
  _initTestDatabase();
});

describe('buildProofMatrix', () => {
  it('returns a proof for each security claim in the epic', () => {
    const matrix = buildProofMatrix();
    const claimIds = matrix.proofs.map((p) => p.claimId);
    expect(claimIds).toContain('default-deny-network');
    expect(claimIds).toContain('destination-bound-egress');
    expect(claimIds).toContain('container-hardening');
    expect(claimIds).toContain('tamper-evident-audit');
    expect(claimIds).toContain('audit-red-team-fixtures');
  });

  it('includes a summary with counts by status', () => {
    const matrix = buildProofMatrix();
    expect(matrix.summary).toHaveProperty('proven');
    expect(matrix.summary).toHaveProperty('shipped');
    expect(matrix.summary).toHaveProperty('unproven');
    expect(matrix.summary).toHaveProperty('failed');
    const total = Object.values(matrix.summary).reduce((a, b) => a + b, 0);
    expect(total).toBe(matrix.proofs.length);
  });

  it('marks shipped claims with operator actions to reach proven', () => {
    const matrix = buildProofMatrix();
    const networkProof = matrix.proofs.find(
      (p) => p.claimId === 'default-deny-network',
    );
    expect(networkProof?.status).toBe('shipped');
    expect(networkProof?.operatorAction).toBeTruthy();
  });

  it('counts network.egress.allow/deny audit events as evidence', () => {
    const matrix = buildProofMatrix();
    const egressProof = matrix.proofs.find(
      (p) => p.claimId === 'destination-bound-egress',
    );
    expect(egressProof?.evidence.join(' ')).toMatch(
      /network\.egress\.(allow|deny) events/,
    );
  });

  it('reflects the current allowlist destination count', () => {
    const matrix = buildProofMatrix();
    const egressProof = matrix.proofs.find(
      (p) => p.claimId === 'destination-bound-egress',
    );
    expect(egressProof?.evidence.join(' ')).toMatch(
      /allowlist destinations: 1/,
    );
  });
});
