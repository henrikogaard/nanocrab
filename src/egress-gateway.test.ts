import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockLogAuditEvent = vi.fn();
vi.mock('./audit-log.js', () => ({
  logAuditEvent: (...args: unknown[]) => mockLogAuditEvent(...args),
  redactAuditValue: (value: unknown) => value,
}));

// In-memory filesystem mock so allowlist persistence tests don't leak across
// test runs or touch the real store directory.
const mockFs = new Map<string, string>();
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    default: {
      ...actual,
      existsSync: (p: string) => mockFs.has(p),
      readFileSync: (p: string) => {
        const v = mockFs.get(p);
        if (v === undefined) throw new Error(`ENOENT: ${p}`);
        return v;
      },
      writeFileSync: (p: string, v: string) => {
        mockFs.set(p, v);
      },
      mkdirSync: () => undefined,
    },
  };
});

import {
  evaluateEgress,
  auditEgressDecision,
  shouldEnforceDeny,
  isPrivateHost,
  loadEgressAllowlist,
  saveEgressAllowlist,
  resetEgressAllowlistCache,
} from './egress-gateway.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockFs.clear();
  resetEgressAllowlistCache();
});

afterEach(() => {
  resetEgressAllowlistCache();
  mockFs.clear();
  delete process.env.EGRESS_DRY_RUN;
});

describe('isPrivateHost', () => {
  it('allows loopback and private ranges', () => {
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('10.0.0.5')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
  });

  it('rejects public hosts', () => {
    expect(isPrivateHost('api.anthropic.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });
});

describe('evaluateEgress', () => {
  it('denies an unknown public destination by default', () => {
    const result = evaluateEgress({ host: 'evil.example.com' });
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/not in the egress allowlist/);
  });

  it('allows a default-listed provider destination', () => {
    const result = evaluateEgress({ host: 'api.anthropic.com' });
    expect(result.decision).toBe('allow');
    expect(result.matchedDestination?.id).toBe('anthropic');
  });

  it('allows subdomains of an allowlisted host', () => {
    const result = evaluateEgress({ host: 'v1.openrouter.ai' });
    expect(result.decision).toBe('allow');
  });

  it('denies a credential not bound to the destination', () => {
    const result = evaluateEgress({
      host: 'api.anthropic.com',
      credentialId: 'OPENROUTER_API_KEY',
    });
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/not bound/);
  });

  it('allows a credential bound to the destination', () => {
    const result = evaluateEgress({
      host: 'api.anthropic.com',
      credentialId: 'ANTHROPIC_API_KEY',
    });
    expect(result.decision).toBe('allow');
  });

  it('denies a port mismatch on an otherwise-allowed destination', () => {
    saveEgressAllowlist({
      destinations: [
        {
          id: 'strict',
          host: 'strict.example.com',
          port: 8443,
          reason: 'strict port',
        },
      ],
    });
    const result = evaluateEgress({ host: 'strict.example.com', port: 443 });
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/does not match allowed port/);
  });

  it('allows private hosts without an allowlist entry', () => {
    const result = evaluateEgress({ host: '127.0.0.1', port: 11434 });
    expect(result.decision).toBe('allow');
    expect(result.reason).toMatch(/Private\/loopback/);
  });

  it('denies empty host input', () => {
    const result = evaluateEgress({ host: '' });
    expect(result.decision).toBe('deny');
    expect(result.reason).toMatch(/No destination host/);
  });

  it('respects EGRESS_DRY_RUN env for dry-run mode', () => {
    process.env.EGRESS_DRY_RUN = '1';
    const result = evaluateEgress({ host: 'evil.example.com' });
    expect(result.dryRun).toBe(true);
    expect(result.decision).toBe('deny');
    expect(shouldEnforceDeny(result)).toBe(false);
  });

  it('enforces deny when not in dry-run mode', () => {
    const result = evaluateEgress({ host: 'evil.example.com' });
    expect(result.dryRun).toBe(false);
    expect(shouldEnforceDeny(result)).toBe(true);
  });
});

describe('auditEgressDecision', () => {
  it('emits network.egress.allow for allowed destinations', () => {
    const result = auditEgressDecision({
      host: 'api.anthropic.com',
      credentialId: 'ANTHROPIC_API_KEY',
    });
    expect(result.decision).toBe('allow');
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'network.egress.allow',
        decision: 'allowed',
        resource: 'api.anthropic.com',
      }),
    );
  });

  it('emits network.egress.deny for unknown destinations', () => {
    const result = auditEgressDecision({ host: 'evil.example.com' });
    expect(result.decision).toBe('deny');
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'network.egress.deny',
        decision: 'denied',
        resource: 'evil.example.com',
      }),
    );
  });

  it('never includes secret values in the audit context', () => {
    auditEgressDecision({
      host: 'api.anthropic.com',
      credentialId: 'ANTHROPIC_API_KEY',
    });
    const call = mockLogAuditEvent.mock.calls[0][0] as {
      context: Record<string, unknown>;
    };
    const contextStr = JSON.stringify(call.context);
    // credentialId is the identifier, not the secret value
    expect(contextStr).toContain('ANTHROPIC_API_KEY');
    // No raw key material should appear
    expect(contextStr).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
  });
});

describe('allowlist persistence', () => {
  it('round-trips a custom allowlist through save/load', () => {
    saveEgressAllowlist({
      destinations: [
        {
          id: 'custom',
          host: 'custom.example.com',
          credentialId: 'CUSTOM_KEY',
          reason: 'custom',
        },
      ],
    });
    resetEgressAllowlistCache();
    const loaded = loadEgressAllowlist();
    expect(loaded.destinations).toHaveLength(1);
    expect(loaded.destinations[0].host).toBe('custom.example.com');
  });
});
