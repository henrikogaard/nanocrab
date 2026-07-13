import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logAuditEvent } from './audit-log.js';
import { listJournalEntryRecords, findJournalEvents } from './journal-store.js';
import { listMemoryRecords } from './memory-store.js';
import { listResearchJobs } from './research-jobs.js';
import { listArtifactVault } from './artifact-vault.js';
import {
  DEFAULT_CONNECTOR_CATALOG,
  buildConnectorCatalog,
} from './connector-catalog.js';
import {
  authorizeConnectorAction,
  loadConnectorPermissions,
  defaultConnectorPermission,
  type ConnectorPermissionDecision,
} from './connector-permissions.js';
import { readEnvFile } from './env.js';
import { githubApi } from './coding-jobs.js';

export type SourceCollectionStatus =
  | 'pending'
  | 'collecting'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type SourceScope =
  | 'memory'
  | 'journal'
  | 'research'
  | 'connector'
  | 'artifact'
  | 'web'
  | 'file';

export interface SourceCollectionItem {
  scope: SourceScope;
  connectorId?: string;
  status: SourceCollectionStatus;
  requestedAt: string;
  completedAt: string | null;
  itemCount: number;
  failureReason: string | null;
  provenance: string[];
}

export interface SourceLedgerEntry {
  id: string;
  reportJobId: string;
  scope: SourceScope;
  connectorId?: string;
  sourceLabel: string;
  sourceUrl?: string;
  citationText: string;
  collectedAt: string;
  provenance: string[];
}

export interface SourceCollectionRecord {
  id: string;
  reportJobId: string;
  requestedScopes: SourceScope[];
  items: SourceCollectionItem[];
  ledger: SourceLedgerEntry[];
  status: SourceCollectionStatus;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

const SOURCE_COLLECTIONS_PATH = path.join(STORE_DIR, 'source-collections.json');
const SOURCE_LEDGER_PATH = path.join(STORE_DIR, 'source-ledger.jsonl');

function readCollections(): SourceCollectionRecord[] {
  try {
    const records = JSON.parse(
      fs.readFileSync(SOURCE_COLLECTIONS_PATH, 'utf-8'),
    );
    if (!Array.isArray(records)) return [];
    return records;
  } catch {
    return [];
  }
}

function writeCollections(collections: SourceCollectionRecord[]): void {
  fs.mkdirSync(path.dirname(SOURCE_COLLECTIONS_PATH), { recursive: true });
  fs.writeFileSync(
    SOURCE_COLLECTIONS_PATH,
    `${JSON.stringify(collections, null, 2)}\n`,
  );
}

function appendLedgerEntry(entry: SourceLedgerEntry): void {
  fs.mkdirSync(path.dirname(SOURCE_LEDGER_PATH), { recursive: true });
  fs.appendFileSync(SOURCE_LEDGER_PATH, `${JSON.stringify(entry)}\n`);
}

function readLedgerEntries(reportJobId?: string): SourceLedgerEntry[] {
  try {
    const lines = fs
      .readFileSync(SOURCE_LEDGER_PATH, 'utf-8')
      .split(/\r?\n/)
      .filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line) as SourceLedgerEntry);
    if (reportJobId) {
      return entries.filter((e) => e.reportJobId === reportJobId);
    }
    return entries;
  } catch {
    return [];
  }
}

interface McpServerConfig {
  name: string;
  envVars?: string[];
}

function loadMcpServers(): McpServerConfig[] {
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (!fs.existsSync(mcpConfigPath)) return [];
    const servers = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
    if (!Array.isArray(servers)) return [];
    return servers as McpServerConfig[];
  } catch {
    return [];
  }
}

function getAvailableConnectors(): string[] {
  const mcpServers = loadMcpServers();
  const permissions = loadConnectorPermissions();

  const allEnvKeys = [
    ...new Set(
      DEFAULT_CONNECTOR_CATALOG.flatMap((d) => d.requiredEnvVars)
        .concat(mcpServers.flatMap((s) => s.envVars || []))
        .filter(Boolean),
    ),
  ];
  const envValues = readEnvFile(allEnvKeys);

  const serverByName = new Map<string, McpServerConfig>();
  for (const server of mcpServers) {
    serverByName.set(server.name, server);
  }

  const servers = DEFAULT_CONNECTOR_CATALOG.filter(
    (d) => d.setupPath === 'built-in',
  ).map((definition) => {
    const server = serverByName.get(definition.id);
    const envVars = server?.envVars || definition.requiredEnvVars;
    const envStatus = envVars.map((key) => ({
      key,
      isSet: !!(process.env[key] || envValues[key]),
    }));
    const permission =
      permissions.find((p) => p.connectorId === definition.id) ||
      defaultConnectorPermission(definition.id) ||
      undefined;
    return {
      name: definition.id,
      envStatus,
      permission,
    };
  });

  for (const server of mcpServers) {
    if (DEFAULT_CONNECTOR_CATALOG.some((d) => d.id === server.name)) continue;
    const envStatus = (server.envVars || []).map((key) => ({
      key,
      isSet: !!(process.env[key] || envValues[key]),
    }));
    const permission =
      permissions.find((p) => p.connectorId === server.name) ||
      defaultConnectorPermission(server.name) ||
      undefined;
    servers.push({
      name: server.name,
      envStatus,
      permission,
    });
  }

  const installedPresetNames = new Set(mcpServers.map((s) => s.name));
  const presets = DEFAULT_CONNECTOR_CATALOG.filter(
    (d) => d.setupPath === 'preset',
  ).map((d) => ({
    name: d.presetName || d.id,
    installed: installedPresetNames.has(d.presetName || d.id),
  }));

  const catalog = buildConnectorCatalog({
    servers,
    presets,
  });

  return catalog.items
    .filter((item) => item.ready && item.id !== 'nanocrab')
    .map((item) => item.id);
}

export function startSourceCollection(
  reportJobId: string,
  requestedScopes: SourceScope[],
  options: { availableConnectors?: string[] } = {},
): SourceCollectionRecord {
  const availableConnectors =
    options.availableConnectors ?? getAvailableConnectors();

  const items: SourceCollectionItem[] = [];
  for (const scope of requestedScopes) {
    if (scope === 'connector') {
      if (availableConnectors.length === 0) {
        items.push({
          scope,
          connectorId: undefined,
          status: 'failed',
          requestedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          itemCount: 0,
          failureReason: 'No connectors available for source collection',
          provenance: [],
        });
      } else {
        for (const connectorId of availableConnectors) {
          items.push({
            scope,
            connectorId,
            status: 'pending',
            requestedAt: new Date().toISOString(),
            completedAt: null,
            itemCount: 0,
            failureReason: null,
            provenance: [],
          });
        }
      }
    } else {
      items.push({
        scope,
        connectorId: undefined,
        status: 'pending',
        requestedAt: new Date().toISOString(),
        completedAt: null,
        itemCount: 0,
        failureReason: null,
        provenance: [],
      });
    }
  }

  const status = items.some(
    (item) => item.status === 'pending' || item.status === 'collecting',
  )
    ? 'collecting'
    : computeOverallStatus(items);
  const record: SourceCollectionRecord = {
    id: `src-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    reportJobId,
    requestedScopes,
    items,
    ledger: [],
    status,
    startedAt: new Date().toISOString(),
    completedAt: status === 'collecting' ? null : new Date().toISOString(),
    failureReason: null,
  };

  const collections = readCollections();
  collections.push(record);
  writeCollections(collections);

  logAuditEvent({
    actor: 'system',
    actionType: 'source.collection.started',
    resource: reportJobId,
    decision: 'allowed',
    correlationId: record.id,
    context: {
      collectionId: record.id,
      scopes: requestedScopes,
    },
  });

  return record;
}

function findScopeItem(
  record: SourceCollectionRecord,
  scope: SourceScope,
  connectorId?: string,
): SourceCollectionItem | undefined {
  return record.items.find(
    (i) =>
      i.scope === scope &&
      (connectorId === undefined || i.connectorId === connectorId),
  );
}

export function markScopeCollected(
  collectionId: string,
  scope: SourceScope,
  itemCount: number,
  provenance: string[] = [],
  connectorId?: string,
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = findScopeItem(record, scope, connectorId);
  if (!item)
    throw new Error(`Scope ${scope} not in collection ${collectionId}`);

  item.status = 'completed';
  item.completedAt = new Date().toISOString();
  item.itemCount = itemCount;
  item.provenance = provenance;

  record.status = computeOverallStatus(record.items);
  if (record.status !== 'collecting') {
    record.completedAt = new Date().toISOString();
  }

  writeCollections(collections);
  return record;
}

export function markScopeFailed(
  collectionId: string,
  scope: SourceScope,
  reason: string,
  connectorId?: string,
  provenance: string[] = [],
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = findScopeItem(record, scope, connectorId);
  if (!item)
    throw new Error(`Scope ${scope} not in collection ${collectionId}`);

  item.status = 'failed';
  item.completedAt = new Date().toISOString();
  item.failureReason = reason;
  item.provenance = provenance;

  record.status = computeOverallStatus(record.items);
  if (record.status !== 'collecting') {
    record.completedAt = new Date().toISOString();
  }

  writeCollections(collections);
  return record;
}

export function cancelSourceCollection(
  collectionId: string,
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  record.status = 'cancelled';
  record.completedAt = new Date().toISOString();
  record.failureReason = 'Collection cancelled by user';

  for (const item of record.items) {
    if (item.status === 'pending' || item.status === 'collecting') {
      item.status = 'cancelled';
      item.completedAt = record.completedAt;
      item.failureReason = 'Collection cancelled';
    }
  }

  writeCollections(collections);
  return record;
}

export function addLedgerEntry(
  collectionId: string,
  scope: SourceScope,
  sourceLabel: string,
  citationText: string,
  sourceUrl?: string,
  connectorId?: string,
): SourceLedgerEntry {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const entry: SourceLedgerEntry = {
    id: `ledger-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    reportJobId: record.reportJobId,
    scope,
    connectorId,
    sourceLabel,
    sourceUrl,
    citationText,
    collectedAt: new Date().toISOString(),
    provenance: [`collection:${collectionId}`],
  };

  record.ledger.push(entry);
  writeCollections(collections);
  appendLedgerEntry(entry);

  return entry;
}

function computeOverallStatus(
  items: SourceCollectionItem[],
): SourceCollectionStatus {
  const statuses = items.map((i) => i.status);

  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.some((s) => s === 'collecting' || s === 'pending'))
    return 'collecting';
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'failed')) {
    const completedCount = statuses.filter((s) => s === 'completed').length;
    return completedCount > 0 ? 'partial' : 'failed';
  }
  return 'failed';
}

const SOURCE_SCOPES: SourceScope[] = [
  'memory',
  'journal',
  'research',
  'connector',
  'artifact',
  'web',
  'file',
];

function isSourceScope(value: string): value is SourceScope {
  return (SOURCE_SCOPES as string[]).includes(value);
}

export interface CollectedSources {
  sections: string[];
  citations: Array<{ label: string; source: string }>;
  sourceCollectionId: string;
}

async function fetchGitHubConnectorSources(
  collectionId: string,
  query: string,
  sections: string[],
  citations: Array<{ label: string; source: string }>,
  githubFetch: typeof githubApi,
): Promise<{ itemCount: number; provenance: string[] }> {
  const searchQuery = query.trim()
    ? `${query.trim()} is:open is:issue`
    : 'is:open is:issue';
  const result = (await githubFetch(
    `/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=10`,
  )) as {
    items?: Array<{
      number: number;
      title: string;
      html_url: string;
      repository?: { full_name?: string };
    }>;
  };
  const issues = (result?.items || []).slice(0, 10);
  if (issues.length === 0) {
    return { itemCount: 0, provenance: ['github:search'] };
  }

  const lines: string[] = [];
  for (const issue of issues) {
    const repo = issue.repository?.full_name || 'unknown';
    lines.push(`- ${issue.title} (${repo}#${issue.number})`);
    addLedgerEntry(
      collectionId,
      'connector',
      issue.title,
      `Issue #${issue.number}: ${issue.title}`,
      issue.html_url,
      'github',
    );
    citations.push({
      label: issue.title,
      source: issue.html_url,
    });
  }
  sections.push(`## GitHub Issues\n\n${lines.join('\n')}`);
  return { itemCount: issues.length, provenance: ['github:search'] };
}

async function fetchConnectorSource(
  collectionId: string,
  connectorId: string,
  query: string,
  sections: string[],
  citations: Array<{ label: string; source: string }>,
  githubFetch: typeof githubApi,
): Promise<void> {
  if (connectorId === 'github') {
    const { itemCount, provenance } = await fetchGitHubConnectorSources(
      collectionId,
      query,
      sections,
      citations,
      githubFetch,
    );
    markScopeCollected(
      collectionId,
      'connector',
      itemCount,
      provenance,
      connectorId,
    );
    return;
  }
  throw new Error(`Connector source fetch not implemented: ${connectorId}`);
}

export interface SourceCollectionActorContext {
  actor: string;
  groupFolder: string;
  agentId?: string;
  isMain?: boolean;
}

interface SourceCollectionDependencies {
  availableConnectors?: string[];
  authorizeConnectorAction?: typeof authorizeConnectorAction;
  githubApi?: typeof githubApi;
  listMemoryRecords?: typeof listMemoryRecords;
}

function connectorReadAction(connectorId: string): string {
  return connectorId === 'github' ? 'issues.read' : 'source.read';
}

function authorizeSourceConnector(
  reportJobId: string,
  connectorId: string,
  context: SourceCollectionActorContext,
  authorize: typeof authorizeConnectorAction,
): ConnectorPermissionDecision {
  const action = connectorReadAction(connectorId);
  const decision = authorize({
    connectorId,
    action,
    groupFolder: context.groupFolder,
    agentId: context.agentId,
    isMain: context.isMain,
    context: {
      actor: context.actor,
      reportJobId,
      connectorId,
      action,
    },
  });
  logAuditEvent({
    actor: context.actor,
    actorId: context.agentId || null,
    actionType: `source.connector.${action}`,
    resource: connectorId,
    decision: decision.allowed ? 'allowed' : decision.decision,
    correlationId: reportJobId,
    context: {
      connectorId,
      action,
      groupFolder: context.groupFolder,
      allowed: decision.allowed,
      reason: decision.reason,
    },
  });
  return decision;
}

export async function collectSources(
  reportJobId: string,
  sourceScopes: string[],
  query: string,
  actorContext: SourceCollectionActorContext,
  dependencies: SourceCollectionDependencies = {},
): Promise<CollectedSources> {
  const requestedScopes = sourceScopes.filter(isSourceScope);
  const availableConnectors =
    dependencies.availableConnectors ?? getAvailableConnectors();
  const authorize =
    dependencies.authorizeConnectorAction ?? authorizeConnectorAction;
  const githubFetch = dependencies.githubApi ?? githubApi;
  const listMemories = dependencies.listMemoryRecords ?? listMemoryRecords;
  const record = startSourceCollection(reportJobId, requestedScopes, {
    availableConnectors,
  });
  const sections: string[] = [];
  const citations: Array<{ label: string; source: string }> = [];

  for (const scope of requestedScopes) {
    try {
      switch (scope) {
        case 'journal': {
          const entries = listJournalEntryRecords({ limit: 10 });
          const events = query ? findJournalEvents({ query, limit: 10 }) : [];
          sections.push(
            `## Journal\n\n${
              entries
                .map((entry) => `### ${entry.date}\n${entry.summary}`)
                .join('\n\n') || 'No journal entries found.'
            }`,
          );
          for (const event of events) {
            addLedgerEntry(
              record.id,
              'journal',
              event.title,
              `Journal event: ${event.title}`,
              `journal:${event.id}`,
            );
            citations.push({
              label: event.title,
              source: `journal:${event.id}`,
            });
          }
          markScopeCollected(
            record.id,
            'journal',
            entries.length + events.length,
          );
          break;
        }
        case 'memory': {
          const memories = listMemories({ status: 'approved', limit: 25 });
          sections.push(
            `## Approved Memory\n\n${
              memories.map((memory) => `- ${memory.content}`).join('\n') ||
              'No approved memories found.'
            }`,
          );
          for (const memory of memories.slice(0, 10)) {
            addLedgerEntry(
              record.id,
              'memory',
              memory.content.slice(0, 80),
              memory.content,
              `memory:${memory.id}`,
            );
            citations.push({
              label: memory.content.slice(0, 80),
              source: `memory:${memory.id}`,
            });
          }
          markScopeCollected(record.id, 'memory', memories.length);
          break;
        }
        case 'research': {
          const researchJobs = listResearchJobs();
          const researchSection = researchJobs
            .map(
              (job) =>
                `- ${job.query}${job.notesPath ? ` (notes: ${job.notesPath})` : ''}`,
            )
            .join('\n');
          sections.push(
            `## Research\n\n${researchSection || 'No research jobs found.'}`,
          );
          for (const job of researchJobs.slice(0, 10)) {
            addLedgerEntry(
              record.id,
              'research',
              `Research: ${job.query}`,
              `Research query: ${job.query}`,
              `research:${job.id}`,
            );
            citations.push({
              label: `Research: ${job.query.slice(0, 80)}`,
              source: `research:${job.id}`,
            });
          }
          markScopeCollected(record.id, 'research', researchJobs.length);
          break;
        }
        case 'artifact': {
          const artifacts = listArtifactVault();
          const artifactSection = artifacts
            .map((artifact) => `- ${artifact.title} (${artifact.sourceType})`)
            .join('\n');
          sections.push(
            `## Artifacts\n\n${artifactSection || 'No artifacts found.'}`,
          );
          for (const artifact of artifacts.slice(0, 10)) {
            addLedgerEntry(
              record.id,
              'artifact',
              artifact.title,
              `${artifact.sourceType} artifact: ${artifact.title}`,
              `artifact:${artifact.id}`,
            );
            citations.push({
              label: artifact.title,
              source: `artifact:${artifact.id}`,
            });
          }
          markScopeCollected(record.id, 'artifact', artifacts.length);
          break;
        }
        case 'connector': {
          const connectorItems = record.items.filter(
            (i) => i.scope === 'connector',
          );
          if (connectorItems.length === 0) {
            sections.push('## Connectors\n\nNo connectors available.');
            break;
          }
          for (const item of connectorItems) {
            if (item.status !== 'pending') continue;
            const connectorId = item.connectorId as string;
            const authorization = authorizeSourceConnector(
              reportJobId,
              connectorId,
              actorContext,
              authorize,
            );
            if (!authorization.allowed) {
              markScopeFailed(
                record.id,
                'connector',
                `Connector access ${authorization.decision}: ${authorization.reason}`,
                connectorId,
                [`authorization:${authorization.decision}`],
              );
              continue;
            }
            try {
              await fetchConnectorSource(
                record.id,
                connectorId,
                query,
                sections,
                citations,
                githubFetch,
              );
            } catch (err) {
              markScopeFailed(
                record.id,
                'connector',
                err instanceof Error ? err.message : String(err),
                item.connectorId,
              );
            }
          }
          break;
        }
        default:
          markScopeFailed(record.id, scope, 'Source scope not yet implemented');
      }
    } catch (err) {
      markScopeFailed(
        record.id,
        scope,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { sections, citations, sourceCollectionId: record.id };
}

export function getSourceCollection(
  id: string,
): SourceCollectionRecord | undefined {
  return readCollections().find((c) => c.id === id);
}

export function getSourceCollectionByReportJobId(
  reportJobId: string,
): SourceCollectionRecord | undefined {
  return readCollections().find((c) => c.reportJobId === reportJobId);
}

export function listSourceCollections(filters?: {
  status?: SourceCollectionStatus;
  reportJobId?: string;
  limit?: number;
}): SourceCollectionRecord[] {
  let collections = readCollections();

  if (filters?.status) {
    collections = collections.filter((c) => c.status === filters.status);
  }
  if (filters?.reportJobId) {
    collections = collections.filter(
      (c) => c.reportJobId === filters.reportJobId,
    );
  }

  collections.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const limit = filters?.limit || 100;
  return collections.slice(0, Math.min(limit, 500));
}

export function getSourceLedger(reportJobId?: string): SourceLedgerEntry[] {
  return readLedgerEntries(reportJobId);
}
