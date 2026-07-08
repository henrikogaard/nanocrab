import { describe, expect, it } from 'vitest';

import {
  isApprovalSensitiveCoworkItem,
  normalizeCoworkProvenance,
  normalizeCoworkSensitivity,
} from './cowork-metadata.js';

describe('cowork metadata helpers', () => {
  it('normalizes provenance aliases without exposing arbitrary connector ids', () => {
    expect(normalizeCoworkProvenance('manual upload')).toBe('manual-upload');
    expect(normalizeCoworkProvenance('gmail')).toBe('mcp-server');
    expect(normalizeCoworkProvenance('source-ledger')).toBe('source-ledger');
    expect(normalizeCoworkProvenance('unknown-new-source')).toBe('unknown');
  });

  it('normalizes sensitivity labels and identifies approval-sensitive items', () => {
    expect(normalizeCoworkSensitivity('sensitive')).toBe('confidential');
    expect(normalizeCoworkSensitivity('approval required')).toBe(
      'approval-required',
    );
    expect(normalizeCoworkSensitivity('normal')).toBe('normal');
    expect(isApprovalSensitiveCoworkItem('confidential')).toBe(true);
    expect(isApprovalSensitiveCoworkItem('approval-required')).toBe(true);
    expect(isApprovalSensitiveCoworkItem('normal')).toBe(false);
  });
});
