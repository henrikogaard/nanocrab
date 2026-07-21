import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(os.tmpdir(), `nanocrab-notebooklm-${Date.now()}`);

vi.mock('./config.js', () => ({ STORE_DIR }));

const {
  createResearchJob,
  getNotebookLmCapabilities,
  getNotebookLmReadiness,
  linkResearchJobToNotebookLm,
  loadNotebookLmConfig,
  requestNotebookLmOperation,
  saveNotebookLmConfig,
} = await import('./research-jobs.js');

describe('NotebookLM Enterprise contract', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
  });

  it('defaults to a disabled official Enterprise contract with capabilities', () => {
    const config = loadNotebookLmConfig();
    expect(config).toMatchObject({
      enabled: false,
      provider: 'google-enterprise',
      contractVersion: 'enterprise-mcp-v1',
      connectorId: 'notebooklm-enterprise',
    });
    expect(getNotebookLmCapabilities()).toContain('add-source');
    expect(getNotebookLmReadiness(config)).toMatchObject({
      status: 'blocked',
      configured: false,
      missing: expect.arrayContaining(['enabled']),
    });
  });

  it('persists only non-secret contract metadata and redacts notes', () => {
    const config = saveNotebookLmConfig({
      enabled: true,
      projectId: 'research-project',
      serverName: 'enterprise-mcp',
      credentialProxyRoute: 'notebooklm.enterprise',
      notes: 'Bearer super-secret-token; approved by owner.',
      ...({ apiKey: 'must-not-persist' } as Record<string, unknown>),
    });

    expect(config).toMatchObject({
      enabled: true,
      provider: 'google-enterprise',
      projectId: 'research-project',
      serverName: 'enterprise-mcp',
      credentialProxyRoute: 'notebooklm.enterprise',
    });
    expect(config.notes).not.toContain('super-secret-token');
    expect(config).not.toHaveProperty('apiKey');
    expect(
      JSON.parse(
        fs.readFileSync(path.join(STORE_DIR, 'notebooklm-config.json'), 'utf8'),
      ),
    ).not.toHaveProperty('apiKey');
    expect(getNotebookLmReadiness(config).status).toBe('attention');
  });

  it('rejects non-enterprise providers and invalid proxy routes', () => {
    expect(() =>
      saveNotebookLmConfig({
        provider: 'consumer' as never,
        credentialProxyRoute: 'https://example.invalid/token',
      }),
    ).toThrow(/Enterprise-only|credential proxy route/i);
  });

  it('requires approval and never executes an unregistered operation', () => {
    const config = saveNotebookLmConfig({
      enabled: true,
      projectId: 'research-project',
      serverName: 'enterprise-mcp',
      credentialProxyRoute: 'notebooklm.enterprise',
    });
    expect(
      requestNotebookLmOperation({
        operation: 'add-source',
        config,
      }),
    ).toMatchObject({ status: 'requires_approval', executed: false });
    expect(
      requestNotebookLmOperation({
        operation: 'add-source',
        approved: true,
        config,
      }),
    ).toMatchObject({ status: 'blocked', executed: false });
  });

  it('links a requested operation to research provenance without claiming execution', () => {
    const job = createResearchJob({
      query: 'Enterprise research',
      autoRun: false,
    });
    const linked = linkResearchJobToNotebookLm(job.id, {
      operation: 'create-notebook',
      status: 'requested',
      sourceRefs: ['research:source-1'],
    });
    expect(linked?.notebookLmProvenance).toMatchObject({
      connectorId: 'notebooklm-enterprise',
      operation: 'create-notebook',
      status: 'requested',
      sourceRefs: ['research:source-1'],
    });
  });
});
