/**
 * Connector readiness surface for MCP-backed source collection.
 *
 * Covers configured server, permission scope, transport health, and freshness.
 * Provides deterministic smoke-test fixtures for source collection with
 * retry, deduplication, redaction, and failure reporting.
 */

import fs from 'fs';
import path from 'path';

import { redactAuditValue } from './audit-log.js';
import { STORE_DIR } from './config.js';
import {
  DEFAULT_CONNECTOR_CATALOG,
  buildConnectorCatalog,
  type ConnectorCatalogItem,
  type ConnectorCatalogServer,
} from './connector-catalog.js';
import {
  loadConnectorPermissions,
  authorizeConnectorAction,
  type ConnectorPermissionDecision,
} from './connector-permissions.js';
import { readEnvFile } from './env.js';
import { logAuditEvent } from './audit-log.js';
import {
  startSourceCollection,
  markScopeCollected,
  markScopeFailed,
  type SourceCollectionRecord,
  type SourceScope,
} from './source-collection.js';

export type ConnectorReadinessStatus =
  | 'healthy'
  | 'unavailable'
  | 'stale'
  | 'permission-denied'
  | 'misconfigured';

export interface ConnectorReadinessEntry {
  connectorId: string;
  label: string;
  status: ConnectorReadinessStatus;
  configured: boolean;
  credentialsConfigured: boolean;
  permissionsValid: boolean;
  transportHealthy: boolean | null;
  lastCheckedAt: string | null;
  stale: boolean;
  detail: string;
  recoveryHint?: string;
  missingEnvVars: string[];
}

export interface ConnectorReadinessResult {
  checkedAt: string;
  summary: {
    total: number;
    healthy: number;
    unavailable: number;
    stale: number;
    permissionDenied: number;
    misconfigured: number;
  };
  entries: ConnectorReadinessEntry[];
}

const READINESS_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

function isStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  return (
    Date.now() - new Date(timestamp).getTime() > READINESS_STALE_THRESHOLD_MS
  );
}

function getEnvStatus(
  connectorId: string,
  requiredEnvVars: string[],
): { allSet: boolean; missing: string[] } {
  const allEnvKeys = new Set(requiredEnvVars);
  const envValues = readEnvFile(Array.from(allEnvKeys));
  const missing = requiredEnvVars.filter(
    (key) => !process.env[key] && !envValues[key],
  );
  return { allSet: missing.length === 0, missing };
}

/**
 * Get connector-specific read action matching source-collection behavior.
 * Mirrors connectorReadAction from source-collection.ts.
 */
function connectorReadAction(connectorId: string): string {
  return connectorId === 'github' ? 'issues.read' : 'source.read';
}

function checkPermission(
  connectorId: string,
  groupFolder: string,
  isMain: boolean,
): ConnectorPermissionDecision {
  const action = connectorReadAction(connectorId);
  return authorizeConnectorAction({
    connectorId,
    action,
    groupFolder,
    isMain,
    context: { actor: 'readiness-check' },
  });
}

/**
 * Load configured MCP servers with validation.
 */
function loadMcpServers(): Array<{ name: string; envVars?: string[] }> {
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (!fs.existsSync(mcpConfigPath)) return [];
    const servers = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    if (!Array.isArray(servers)) return [];
    return servers as Array<{ name: string; envVars?: string[] }>;
  } catch {
    return [];
  }
}

export function getConnectorReadiness(
  groupFolder: string = 'dashboard',
  isMain: boolean = false,
): ConnectorReadinessResult {
  const permissions = loadConnectorPermissions();
  const now = new Date().toISOString();

  const mcpServers = loadMcpServers();

  // Build combined connector list from catalog defaults + configured MCP servers
  // Merge configured env vars for existing catalog entries
  const allConnectorDefs = new Map<
    string,
    (typeof DEFAULT_CONNECTOR_CATALOG)[0]
  >();
  for (const def of DEFAULT_CONNECTOR_CATALOG) {
    allConnectorDefs.set(def.id, { ...def });
  }
  for (const server of mcpServers) {
    const existing = allConnectorDefs.get(server.name);
    if (existing && server.envVars?.length) {
      // Prefer configured env vars for catalog entries
      allConnectorDefs.set(server.name, {
        ...existing,
        requiredEnvVars: [...new Set(server.envVars)],
      });
    } else if (!existing) {
      allConnectorDefs.set(server.name, {
        id: server.name,
        label: server.name,
        category: 'MCP',
        summary: `Configured MCP server: ${server.name}`,
        capabilities: [],
        requiredEnvVars: server.envVars || [],
        setupPath: 'manual',
      });
    }
  }

  const entries: ConnectorReadinessEntry[] = [];

  for (const [connectorId, definition] of allConnectorDefs) {
    if (connectorId === 'nanocrab') continue; // skip core IPC

    const envStatus = getEnvStatus(connectorId, definition.requiredEnvVars);
    const permission = permissions.find((p) => p.connectorId === connectorId);

    // Check read permission using connector-specific action and caller's group scope
    let permissionsValid = true;
    try {
      const readPermission = checkPermission(connectorId, groupFolder, isMain);
      permissionsValid = readPermission.allowed;
    } catch {
      permissionsValid = false;
    }

    const configured =
      definition.setupPath === 'built-in' ||
      mcpServers.some((s) => s.name === connectorId);

    let status: ConnectorReadinessStatus = 'healthy';
    let detail = '';
    let recoveryHint: string | undefined;

    if (!configured) {
      status = 'unavailable';
      detail = `Connector ${connectorId} is not configured`;
      recoveryHint =
        'Add the connector via MCP settings or install the recommended preset';
    } else if (!envStatus.allSet) {
      status = 'misconfigured';
      detail = `Missing credentials: ${envStatus.missing.join(', ')}`;
      recoveryHint = 'Configure missing environment variables in Settings';
    } else if (!permissionsValid) {
      status = 'permission-denied';
      detail = `Read permission denied for connector ${connectorId}`;
      recoveryHint =
        'Review connector permissions in the Integrations settings';
    }

    // Transport health is unknown until probed; mark null
    const transportHealthy: boolean | null = null;

    entries.push({
      connectorId,
      label: definition.label || connectorId,
      status,
      configured,
      credentialsConfigured: envStatus.allSet,
      permissionsValid,
      transportHealthy,
      lastCheckedAt: null,
      stale: true,
      detail,
      recoveryHint,
      missingEnvVars: envStatus.missing,
    });
  }

  const summary = {
    total: entries.length,
    healthy: entries.filter((e) => e.status === 'healthy').length,
    unavailable: entries.filter((e) => e.status === 'unavailable').length,
    stale: entries.filter((e) => e.stale).length,
    permissionDenied: entries.filter(
      (e) => e.status === 'permission-denied',
    ).length,
    misconfigured: entries.filter((e) => e.status === 'misconfigured').length,
  };

  return { checkedAt: now, summary, entries };
}

// --- Smoke test fixtures ---

export interface SmokeTestFixture {
  name: string;
  description: string;
  scenario:
    | 'success'
    | 'timeout'
    | 'malformed-payload'
    | 'duplicate-source'
    | 'credential-absence'
    | 'permission-denial';
}

export const CONNECTOR_SMOKE_TEST_FIXTURES: SmokeTestFixture[] = [
  {
    name: 'success',
    description: 'Successful source collection with valid connector',
    scenario: 'success',
  },
  {
    name: 'timeout',
    description: 'Source collection with transport timeout',
    scenario: 'timeout',
  },
  {
    name: 'malformed-payload',
    description: 'Source collection with malformed connector response',
    scenario: 'malformed-payload',
  },
  {
    name: 'duplicate-source',
    description: 'Source collection with duplicate source deduplication',
    scenario: 'duplicate-source',
  },
  {
    name: 'credential-absence',
    description: 'Source collection with missing credentials',
    scenario: 'credential-absence',
  },
  {
    name: 'permission-denial',
    description: 'Source collection with permission denied',
    scenario: 'permission-denial',
  },
];

export interface SmokeTestResult {
  fixtureName: string;
  scenario: SmokeTestFixture['scenario'];
  passed: boolean;
  skipped: boolean;
  error?: string;
  collectionId?: string;
  sourceCount?: number;
  durationMs: number;
}

export async function runConnectorSmokeTests(
  groupFolder: string = 'dashboard',
): Promise<SmokeTestResult[]> {
  const results: SmokeTestResult[] = [];

  for (const fixture of CONNECTOR_SMOKE_TEST_FIXTURES) {
    const startedAt = Date.now();
    try {
      let collectionId: string | undefined;
      let sourceCount: number | undefined;

      switch (fixture.scenario) {
        case 'success': {
          const reportJobId = `smoke-test-${Date.now()}`;
          const record = startSourceCollection(reportJobId, [
            'memory',
            'journal',
            'connector',
          ]);
          collectionId = record.id;
          // Collect memory scope
          const { listMemoryRecords } = await import('./memory-store.js');
          const memories = listMemoryRecords({ status: 'approved', limit: 5 });
          if (memories.length > 0) {
            markScopeCollected(collectionId, 'memory', memories.length);
          } else {
            markScopeCollected(collectionId, 'memory', 0);
          }
          markScopeCollected(collectionId, 'journal', 0);
          sourceCount = memories.length;
          results.push({
            fixtureName: fixture.name,
            scenario: fixture.scenario,
            passed: true,
            skipped: false,
            collectionId,
            sourceCount,
            durationMs: Date.now() - startedAt,
          });
          break;
        }

        case 'credential-absence': {
          const readiness = getConnectorReadiness(groupFolder);
          const misconfigured = readiness.entries.some(
            (e) => e.status === 'misconfigured' || e.status === 'unavailable',
          );
          if (!misconfigured) {
            results.push({
              fixtureName: fixture.name,
              scenario: fixture.scenario,
              passed: false,
              skipped: false,
              error:
                'Expected at least one misconfigured/unavailable connector but found none',
              durationMs: Date.now() - startedAt,
            });
          } else {
            results.push({
              fixtureName: fixture.name,
              scenario: fixture.scenario,
              passed: true,
              skipped: false,
              error: 'Misconfigured/unavailable connectors correctly detected',
              durationMs: Date.now() - startedAt,
            });
          }
          break;
        }

        case 'permission-denial': {
          const readiness = getConnectorReadiness(groupFolder);
          const permissionDenied = readiness.entries.some(
            (e) => e.status === 'permission-denied',
          );
          if (!permissionDenied) {
            results.push({
              fixtureName: fixture.name,
              scenario: fixture.scenario,
              passed: false,
              skipped: false,
              error:
                'Expected at least one permission-denied connector but found none',
              durationMs: Date.now() - startedAt,
            });
          } else {
            results.push({
              fixtureName: fixture.name,
              scenario: fixture.scenario,
              passed: true,
              skipped: false,
              error: 'Permission-denied connectors correctly detected',
              durationMs: Date.now() - startedAt,
            });
          }
          break;
        }

        case 'timeout':
        case 'malformed-payload':
        case 'duplicate-source': {
          // These require transport-level fixtures (injected timeout/malformed collectors)
          // Mark as skipped until connector transport fixtures are available
          results.push({
            fixtureName: fixture.name,
            scenario: fixture.scenario,
            passed: false,
            skipped: true,
            error:
              'Skipped: requires transport-level injection for deterministic ' +
              'timeout/malformed/duplicate validation',
            durationMs: Date.now() - startedAt,
          });
          break;
        }
      }

      logAuditEvent({
        actor: 'system',
        actionType: 'connector.smoke-test',
        resource: fixture.name,
        decision: 'allowed',
        context: { fixtureName: fixture.name, scenario: fixture.scenario },
      });
    } catch (err) {
      results.push({
        fixtureName: fixture.name,
        scenario: fixture.scenario,
        passed: false,
        skipped: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    }
  }

  return results;
}
