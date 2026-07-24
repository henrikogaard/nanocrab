import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  buildTamperEvidentExport,
  verifyTamperEvidentExport,
} from './audit-export.js';
import { logAuditEvent } from './audit-log.js';
import { _closeDatabase, _initTestDatabase } from './db.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUDIT_EXPORT_KEY;
  try {
    _closeDatabase();
  } catch {
    /* database may not be initialized */
  }
  _initTestDatabase();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

function seedEvents(): void {
  logAuditEvent({
    actor: 'router',
    actionType: 'channel.send',
    resource: 'tg:ops',
    decision: 'allowed',
    context: { textLength: 42 },
    correlationId: 'corr-1',
  });
  logAuditEvent({
    actor: 'credential-proxy',
    actionType: 'network.egress.deny',
    resource: 'evil.example.com',
    decision: 'denied',
    correlationId: 'corr-2',
    context: { reason: 'not allowlisted' },
  });
  logAuditEvent({
    actor: 'credential-proxy',
    actionType: 'network.egress.allow',
    resource: 'api.anthropic.com',
    decision: 'allowed',
    correlationId: 'corr-3',
    context: { matchedDestinationId: 'anthropic' },
  });
}

describe('buildTamperEvidentExport', () => {
  it('chains events with hashes and signs the chain head', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    expect(exportData.count).toBe(3);
    expect(exportData.events).toHaveLength(3);
    expect(exportData.seed).toMatch(/^[a-f0-9]{64}$/);
    expect(exportData.chainHead).toMatch(/^[a-f0-9]{64}$/);
    expect(exportData.signature).toMatch(/^[a-f0-9]{64}$/);
    // First event's previousHash is the seed
    expect(exportData.events[0].previousHash).toBe(exportData.seed);
    // Each event's previousHash is the chain-record hash of the prior record
    expect(exportData.events[1].previousHash).not.toBe(exportData.seed);
    expect(exportData.events[2].previousHash).not.toBe(
      exportData.events[1].previousHash,
    );
  });

  it('produces a deterministic chain for the same events + seed + key', () => {
    seedEvents();
    const a = buildTamperEvidentExport({}, 'test-key');
    const b = buildTamperEvidentExport({}, 'test-key');
    // Same events + same key -> same event hashes (chain head differs only
    // because the seed is random, which is the intended anchor).
    expect(b.events.map((e) => e.eventHash)).toEqual(
      a.events.map((e) => e.eventHash),
    );
    expect(b.seed).not.toBe(a.seed);
  });

  it('uses the env-provided AUDIT_EXPORT_KEY when no key is passed', () => {
    process.env.AUDIT_EXPORT_KEY = 'env-secret';
    seedEvents();
    const exportData = buildTamperEvidentExport();
    expect(exportData.keyId).toBe('env:_AUDIT_EXPORT_KEY');
    const report = verifyTamperEvidentExport(exportData);
    expect(report.signatureValid).toBe(true);
  });
});

describe('verifyTamperEvidentExport', () => {
  it('verifies a clean export as valid', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    const report = verifyTamperEvidentExport(exportData, 'test-key');
    expect(report.valid).toBe(true);
    expect(report.signatureValid).toBe(true);
    expect(report.chainValid).toBe(true);
    expect(report.mutatedEventIndices).toEqual([]);
    expect(report.brokenLinkIndices).toEqual([]);
  });

  it('detects a mutated event', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    // Mutate the second event's resource
    exportData.events[1].event = {
      ...exportData.events[1].event,
      resource: 'tampered.example.com',
    };
    const report = verifyTamperEvidentExport(exportData, 'test-key');
    expect(report.valid).toBe(false);
    expect(report.chainValid).toBe(false);
    expect(report.mutatedEventIndices).toContain(2);
  });

  it('detects a broken chain link', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    // Corrupt the previousHash of the third event
    exportData.events[2].previousHash = '0'.repeat(64);
    const report = verifyTamperEvidentExport(exportData, 'test-key');
    expect(report.valid).toBe(false);
    expect(report.brokenLinkIndices).toContain(3);
  });

  it('detects an invalid signature (wrong key)', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    const report = verifyTamperEvidentExport(exportData, 'wrong-key');
    expect(report.valid).toBe(false);
    expect(report.signatureValid).toBe(false);
    expect(report.chainValid).toBe(true);
  });

  it('detects a forged signature', () => {
    seedEvents();
    const exportData = buildTamperEvidentExport({}, 'test-key');
    exportData.signature = 'a'.repeat(64);
    const report = verifyTamperEvidentExport(exportData, 'test-key');
    expect(report.valid).toBe(false);
    expect(report.signatureValid).toBe(false);
  });

  it('handles an empty audit log', () => {
    const exportData = buildTamperEvidentExport({}, 'test-key');
    expect(exportData.count).toBe(0);
    expect(exportData.chainHead).toBe(exportData.seed);
    const report = verifyTamperEvidentExport(exportData, 'test-key');
    expect(report.valid).toBe(true);
  });
});
