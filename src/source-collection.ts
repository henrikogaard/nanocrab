import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logAuditEvent } from './audit-log.js';
import { listJournalEntryRecords, findJournalEvents } from './journal-store.js';
import { listMemoryRecords } from './memory-store.js';
import { listResearchJobs } from './research-jobs.js';
import { listArtifactVault } from './artifact-vault.js';
import { DEFAULT_CONNECTOR_CATALOG } from './connector-catalog.js';

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

function normalizeConnectorId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '');
}

function getAvailableConnectors(): string[] {
  const builtInIds = DEFAULT_CONNECTOR_CATALOG.filter(
    (definition) => definition.setupPath === 'built-in',
  ).map((definition) => definition.id);
  const configuredIds: string[] = [];
  try {
    const mcpConfigPath = path.join(STORE_DIR, 'mcp-servers.json');
    if (fs.existsSync(mcpConfigPath)) {
      const servers = JSON.parse(
        fs.readFileSync(mcpConfigPath, 'utf-8'),
      ) as Array<{
        name?: string;
      }>;
      for (const server of servers) {
        const id = normalizeConnectorId(server.name);
        if (id && !builtInIds.includes(id) && !configuredIds.includes(id)) {
          configuredIds.push(id);
        }
      }
    }
  } catch {
    /* ignore malformed MCP configuration */
  }
  return Array.from(new Set([...builtInIds, ...configuredIds]));
}

export function startSourceCollection(
  reportJobId: string,
  requestedScopes: SourceScope[],
): SourceCollectionRecord {
  const availableConnectors = getAvailableConnectors();
  const items: SourceCollectionItem[] = requestedScopes.map((scope) => {
    const isConnectorScope = scope === 'connector';
    const connectorUnavailable =
      isConnectorScope && availableConnectors.length === 0;

    return {
      scope,
      connectorId: isConnectorScope ? availableConnectors[0] : undefined,
      status: connectorUnavailable ? 'failed' : 'pending',
      requestedAt: new Date().toISOString(),
      completedAt: null,
      itemCount: 0,
      failureReason: connectorUnavailable
        ? 'No connectors available for source collection'
        : null,
      provenance: [],
    };
  });

  const record: SourceCollectionRecord = {
    id: `src-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    reportJobId,
    requestedScopes,
    items,
    ledger: [],
    status: 'collecting',
    startedAt: new Date().toISOString(),
    completedAt: null,
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

export function markScopeCollected(
  collectionId: string,
  scope: SourceScope,
  itemCount: number,
  provenance: string[] = [],
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = record.items.find((i) => i.scope === scope);
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
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = record.items.find((i) => i.scope === scope);
  if (!item)
    throw new Error(`Scope ${scope} not in collection ${collectionId}`);

  item.status = 'failed';
  item.completedAt = new Date().toISOString();
  item.failureReason = reason;

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

export function collectSources(
  reportJobId: string,
  sourceScopes: string[],
  query: string,
): CollectedSources {
  const requestedScopes = sourceScopes.filter(isSourceScope);
  const record = startSourceCollection(reportJobId, requestedScopes);
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
          const memories = listMemoryRecords({ status: 'approved', limit: 25 });
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
          const connectorIds = getAvailableConnectors();
          const connectorSection = connectorIds
            .map((id) => `- ${id}`)
            .join('\n');
          sections.push(
            `## Connectors\n\n${connectorSection || 'No connectors available.'}`,
          );
          for (const connectorId of connectorIds) {
            addLedgerEntry(
              record.id,
              'connector',
              connectorId,
              `Connector source: ${connectorId}`,
              `connector:${connectorId}`,
              connectorId,
            );
            citations.push({
              label: connectorId,
              source: `connector:${connectorId}`,
            });
          }
          markScopeCollected(record.id, 'connector', connectorIds.length);
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
