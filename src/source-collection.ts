import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { logAuditEvent } from './audit-log.js';

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
    const records = JSON.parse(fs.readFileSync(SOURCE_COLLECTIONS_PATH, 'utf-8'));
    if (!Array.isArray(records)) return [];
    return records;
  } catch {
    return [];
  }
}

function writeCollections(collections: SourceCollectionRecord[]): void {
  fs.mkdirSync(path.dirname(SOURCE_COLLECTIONS_PATH), { recursive: true });
  fs.writeFileSync(SOURCE_COLLECTIONS_PATH, `${JSON.stringify(collections, null, 2)}\n`);
}

function appendLedgerEntry(entry: SourceLedgerEntry): void {
  fs.mkdirSync(path.dirname(SOURCE_LEDGER_PATH), { recursive: true });
  fs.appendFileSync(SOURCE_LEDGER_PATH, `${JSON.stringify(entry)}\n`);
}

function readLedgerEntries(reportJobId?: string): SourceLedgerEntry[] {
  try {
    const lines = fs.readFileSync(SOURCE_LEDGER_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line) as SourceLedgerEntry);
    if (reportJobId) {
      return entries.filter((e) => e.reportJobId === reportJobId);
    }
    return entries;
  } catch {
    return [];
  }
}

function getAvailableConnectors(): string[] {
  // For now, return empty array - connectors are managed externally
  // In a full implementation, this would query the connector catalog
  return [];
}

export function startSourceCollection(
  reportJobId: string,
  requestedScopes: SourceScope[],
): SourceCollectionRecord {
  const availableConnectors = getAvailableConnectors();
  const items: SourceCollectionItem[] = requestedScopes.map((scope) => {
    const isConnectorScope = scope === 'connector';
    const connectorUnavailable = isConnectorScope && availableConnectors.length === 0;

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
  if (!item) throw new Error(`Scope ${scope} not in collection ${collectionId}`);

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
  if (!item) throw new Error(`Scope ${scope} not in collection ${collectionId}`);

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

export function cancelSourceCollection(collectionId: string): SourceCollectionRecord {
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

function computeOverallStatus(items: SourceCollectionItem[]): SourceCollectionStatus {
  const statuses = items.map((i) => i.status);

  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.some((s) => s === 'collecting' || s === 'pending')) return 'collecting';
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'failed')) {
    const completedCount = statuses.filter((s) => s === 'completed').length;
    return completedCount > 0 ? 'partial' : 'failed';
  }
  return 'failed';
}

export function getSourceCollection(id: string): SourceCollectionRecord | undefined {
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
    collections = collections.filter((c) => c.reportJobId === filters.reportJobId);
  }

  collections.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const limit = filters?.limit || 100;
  return collections.slice(0, Math.min(limit, 500));
}

export function getSourceLedger(reportJobId?: string): SourceLedgerEntry[] {
  return readLedgerEntries(reportJobId);
}
