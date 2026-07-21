import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GROUPS_DIR, STORE_DIR } from './config.js';
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
import { validateMount } from './mount-security.js';
import type { AdditionalMount } from './types.js';

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
  sourceLabel?: string;
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

export interface SourceDescriptor {
  scope: SourceScope;
  connectorId?: string;
  mountedPath?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  query?: string;
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
  query?: string;
  actorContext?: SourceCollectionActorContext;
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

interface StartSourceCollectionOptions {
  availableConnectors?: string[];
  sourceDescriptors?: SourceDescriptor[];
  query?: string;
  actorContext?: SourceCollectionActorContext;
}

export function startSourceCollection(
  reportJobId: string,
  requestedScopes: SourceScope[],
  options: StartSourceCollectionOptions = {},
): SourceCollectionRecord {
  const availableConnectors =
    options.availableConnectors ?? getAvailableConnectors();

  const items: SourceCollectionItem[] = [];

  if (options.sourceDescriptors && options.sourceDescriptors.length > 0) {
    const seen = new Set<string>();
    for (const descriptor of options.sourceDescriptors) {
      const key =
        descriptor.scope === 'connector'
          ? `connector:${descriptor.connectorId || '*'}:${descriptor.sourceLabel || ''}`
          : descriptor.scope === 'file'
            ? `file:${descriptor.mountedPath || descriptor.sourceLabel || ''}`
            : `${descriptor.scope}:${descriptor.sourceLabel || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (descriptor.scope === 'connector' && !descriptor.connectorId) {
        if (availableConnectors.length === 0) {
          items.push({
            scope: 'connector',
            connectorId: undefined,
            sourceLabel: descriptor.sourceLabel,
            status: 'failed',
            requestedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            itemCount: 0,
            failureReason: 'No connectors available for source collection',
            provenance: [],
          });
        } else {
          for (const connectorId of availableConnectors) {
            const connectorKey = `connector:${connectorId}:${descriptor.sourceLabel || ''}`;
            if (seen.has(connectorKey)) continue;
            seen.add(connectorKey);
            items.push({
              scope: 'connector',
              connectorId,
              sourceLabel: descriptor.sourceLabel || connectorId,
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
          scope: descriptor.scope,
          connectorId:
            descriptor.scope === 'connector'
              ? descriptor.connectorId
              : undefined,
          sourceLabel:
            descriptor.scope === 'file'
              ? sourceLabelForFile(descriptor)
              : descriptor.sourceLabel ||
                (descriptor.scope === 'connector'
                  ? descriptor.connectorId
                  : undefined),
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
    for (const scope of requestedScopes) {
      if (scope === 'connector') {
        if (availableConnectors.length === 0) {
          items.push({
            scope,
            connectorId: undefined,
            sourceLabel: undefined,
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
              sourceLabel: connectorId,
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
          sourceLabel: undefined,
          status: 'pending',
          requestedAt: new Date().toISOString(),
          completedAt: null,
          itemCount: 0,
          failureReason: null,
          provenance: [],
        });
      }
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
    query: options.query,
    actorContext: options.actorContext,
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
      sourceDescriptorCount: options.sourceDescriptors?.length,
    },
  });

  return record;
}

function findScopeItem(
  record: SourceCollectionRecord,
  scope: SourceScope,
  connectorId?: string,
  sourceLabel?: string,
): SourceCollectionItem | undefined {
  return record.items.find(
    (i) =>
      i.scope === scope &&
      (connectorId === undefined || i.connectorId === connectorId) &&
      (sourceLabel === undefined || i.sourceLabel === sourceLabel),
  );
}

export function markScopeCollected(
  collectionId: string,
  scope: SourceScope,
  itemCount: number,
  provenance: string[] = [],
  connectorId?: string,
  sourceLabel?: string,
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = findScopeItem(record, scope, connectorId, sourceLabel);
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
  sourceLabel?: string,
): SourceCollectionRecord {
  const collections = readCollections();
  const record = collections.find((c) => c.id === collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const item = findScopeItem(record, scope, connectorId, sourceLabel);
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

  const existing = record.ledger.find(
    (entry) =>
      entry.scope === scope &&
      entry.connectorId === connectorId &&
      entry.sourceLabel === sourceLabel &&
      entry.sourceUrl === sourceUrl &&
      entry.citationText === citationText,
  );
  if (existing) {
    return existing;
  }

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
  sourceLabel: string | undefined,
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
      sourceLabel,
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
  validateMount?: typeof validateMount;
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

const FILE_SOURCE_MAX_BYTES = 128 * 1024;
const FILE_SOURCE_MAX_PREVIEW_BYTES = 8 * 1024;
const FILE_SOURCE_EXTENSIONS = new Set([
  '.csv',
  '.htm',
  '.html',
  '.ini',
  '.js',
  '.jsx',
  '.json',
  '.log',
  '.md',
  '.py',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const FILE_SOURCE_BLOCKED_NAMES = [
  '.env',
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  'credentials',
  'secret',
  'token',
  'password',
  'private_key',
  '.npmrc',
  '.netrc',
  'memory.md',
];

function pathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function isBlockedFilePath(realPath: string): string | undefined {
  const parts = realPath.toLowerCase().split(path.sep);
  return FILE_SOURCE_BLOCKED_NAMES.find((pattern) =>
    parts.some((part) => part === pattern || part.includes(pattern)),
  );
}

function sourceLabelForFile(
  descriptor: SourceDescriptor,
  realPath?: string,
): string {
  const requested = descriptor.sourceLabel?.trim();
  const fallback = realPath
    ? path.basename(realPath)
    : descriptor.mountedPath
      ? path.basename(descriptor.mountedPath)
      : undefined;
  const label =
    requested && !requested.includes('/') && !requested.includes('\\')
      ? requested
      : fallback || 'mounted-source';
  return label
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[/\\]+/g, '/')
    .slice(0, 120);
}

function validateMountedSource(
  mountedPath: string,
  actorContext: SourceCollectionActorContext,
  mountValidator: typeof validateMount,
): {
  allowed: boolean;
  realPath: string;
  reason: string;
} {
  try {
    const expanded = mountedPath.startsWith('~/')
      ? path.join(os.homedir(), mountedPath.slice(2))
      : path.resolve(mountedPath);
    if (!fs.existsSync(expanded)) {
      return {
        allowed: false,
        realPath: expanded,
        reason: 'Path does not exist',
      };
    }
    const real = fs.realpathSync(expanded);
    const stat = fs.statSync(real);
    if (!stat.isFile()) {
      return {
        allowed: false,
        realPath: real,
        reason: 'Path is not a regular file',
      };
    }
    const extension = path.extname(real).toLowerCase();
    if (!FILE_SOURCE_EXTENSIONS.has(extension)) {
      return {
        allowed: false,
        realPath: real,
        reason: 'File type is not a supported text source',
      };
    }
    if (stat.size > FILE_SOURCE_MAX_BYTES) {
      return {
        allowed: false,
        realPath: real,
        reason: `File exceeds ${FILE_SOURCE_MAX_BYTES} byte limit`,
      };
    }
    const blockedMatch = isBlockedFilePath(real);
    if (blockedMatch) {
      return {
        allowed: false,
        realPath: real,
        reason: `Path matches blocked pattern: ${blockedMatch}`,
      };
    }

    const internalRoots = [STORE_DIR, GROUPS_DIR]
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => fs.realpathSync(candidate));
    const underInternalRoot = internalRoots.some((root) =>
      pathWithinRoot(real, root),
    );
    if (!underInternalRoot) {
      const mount: AdditionalMount = { hostPath: mountedPath, readonly: true };
      const validation = mountValidator(mount, actorContext.isMain === true);
      if (!validation.allowed || validation.realHostPath !== real) {
        return {
          allowed: false,
          realPath: real,
          reason: 'Path is outside approved mounted roots',
        };
      }
    }

    const content = fs.readFileSync(real);
    if (content.includes(0)) {
      return {
        allowed: false,
        realPath: real,
        reason: 'Binary content is not supported',
      };
    }
    return { allowed: true, realPath: real, reason: '' };
  } catch (err) {
    return {
      allowed: false,
      realPath: mountedPath,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

async function collectMountedFileSource(
  collectionId: string,
  descriptor: SourceDescriptor,
  actorContext: SourceCollectionActorContext,
  mountValidator: typeof validateMount,
): Promise<{ section: string; citation: { label: string; source: string } }> {
  const mountedPath = descriptor.mountedPath;
  if (!mountedPath) {
    throw new Error('mountedPath is required for file scope');
  }
  const validation = validateMountedSource(
    mountedPath,
    actorContext,
    mountValidator,
  );
  if (!validation.allowed) {
    throw new Error(validation.reason);
  }

  const content = fs.readFileSync(validation.realPath, 'utf-8');
  const fileName = path.basename(validation.realPath);
  const label = sourceLabelForFile(descriptor, fileName);
  const sourceUrl = `file:${label}`;
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const preview = normalizedContent.slice(0, FILE_SOURCE_MAX_PREVIEW_BYTES);
  const citationText = `Mounted file source: ${label}\n\n${preview}`;

  addLedgerEntry(
    collectionId,
    'file',
    label,
    citationText,
    sourceUrl,
    undefined,
  );

  return {
    section: `## ${label}\n\nSource: ${sourceUrl}\n\n\`\`\`text\n${preview}\n\`\`\``,
    citation: { label, source: sourceUrl },
  };
}

async function collectSourceDescriptor(
  record: SourceCollectionRecord,
  descriptor: SourceDescriptor,
  actorContext: SourceCollectionActorContext,
  helpers: {
    sections: string[];
    citations: Array<{ label: string; source: string }>;
    availableConnectors: string[];
    authorize: typeof authorizeConnectorAction;
    githubFetch: typeof githubApi;
    listMemories: typeof listMemoryRecords;
    mountValidator: typeof validateMount;
  },
): Promise<void> {
  const {
    sections,
    citations,
    availableConnectors,
    authorize,
    githubFetch,
    listMemories,
    mountValidator,
  } = helpers;
  const itemLabel =
    descriptor.scope === 'file'
      ? sourceLabelForFile(descriptor)
      : descriptor.sourceLabel ||
        descriptor.mountedPath ||
        descriptor.connectorId;

  switch (descriptor.scope) {
    case 'file': {
      const { section, citation } = await collectMountedFileSource(
        record.id,
        descriptor,
        actorContext,
        mountValidator,
      );
      sections.push(section);
      citations.push(citation);
      markScopeCollected(
        record.id,
        'file',
        1,
        [`mounted:${citation.source}`],
        undefined,
        itemLabel,
      );
      break;
    }
    case 'connector': {
      if (!descriptor.connectorId) {
        markScopeFailed(
          record.id,
          'connector',
          'No connectors available for source collection',
          undefined,
          [],
          itemLabel,
        );
        return;
      }
      if (!availableConnectors.includes(descriptor.connectorId)) {
        markScopeFailed(
          record.id,
          'connector',
          `Connector not available: ${descriptor.connectorId}`,
          descriptor.connectorId,
          [],
          descriptor.sourceLabel,
        );
        return;
      }
      const authorization = authorizeSourceConnector(
        record.reportJobId,
        descriptor.connectorId,
        actorContext,
        authorize,
      );
      if (!authorization.allowed) {
        markScopeFailed(
          record.id,
          'connector',
          `Connector access ${authorization.decision}: ${authorization.reason}`,
          descriptor.connectorId,
          [`authorization:${authorization.decision}`],
          descriptor.sourceLabel,
        );
        return;
      }
      try {
        await fetchConnectorSource(
          record.id,
          descriptor.connectorId,
          descriptor.sourceLabel,
          descriptor.query || '',
          sections,
          citations,
          githubFetch,
        );
      } catch (err) {
        markScopeFailed(
          record.id,
          'connector',
          err instanceof Error ? err.message : String(err),
          descriptor.connectorId,
          [],
          descriptor.sourceLabel,
        );
      }
      break;
    }
    case 'journal': {
      const entries = listJournalEntryRecords({ limit: 10 });
      const events = descriptor.query
        ? findJournalEvents({ query: descriptor.query, limit: 10 })
        : [];
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
        [],
        undefined,
        itemLabel,
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
      markScopeCollected(
        record.id,
        'memory',
        memories.length,
        [],
        undefined,
        itemLabel,
      );
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
      markScopeCollected(
        record.id,
        'research',
        researchJobs.length,
        [],
        undefined,
        itemLabel,
      );
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
      markScopeCollected(
        record.id,
        'artifact',
        artifacts.length,
        [],
        undefined,
        itemLabel,
      );
      break;
    }
    default:
      markScopeFailed(
        record.id,
        descriptor.scope,
        'Source scope not yet implemented',
        descriptor.connectorId,
        [],
        itemLabel,
      );
  }
}

export async function collectReportSources(
  reportJobId: string,
  actorContext: SourceCollectionActorContext,
  sourceDescriptors: SourceDescriptor[],
  dependencies: SourceCollectionDependencies = {},
): Promise<CollectedSources> {
  const availableConnectors =
    dependencies.availableConnectors ?? getAvailableConnectors();
  const authorize =
    dependencies.authorizeConnectorAction ?? authorizeConnectorAction;
  const githubFetch = dependencies.githubApi ?? githubApi;
  const listMemories = dependencies.listMemoryRecords ?? listMemoryRecords;
  const mountValidator = dependencies.validateMount ?? validateMount;

  const expanded: SourceDescriptor[] = [];
  for (const descriptor of sourceDescriptors) {
    if (descriptor.scope === 'connector' && !descriptor.connectorId) {
      if (availableConnectors.length === 0) {
        expanded.push(descriptor);
      } else {
        for (const connectorId of availableConnectors) {
          expanded.push({ ...descriptor, connectorId });
        }
      }
    } else {
      expanded.push(descriptor);
    }
  }

  const requestedScopes = [
    ...new Set(expanded.map((descriptor) => descriptor.scope)),
  ];
  const record = startSourceCollection(reportJobId, requestedScopes, {
    availableConnectors,
    sourceDescriptors: expanded,
    query: expanded[0]?.query,
    actorContext,
  });

  const sections: string[] = [];
  const citations: Array<{ label: string; source: string }> = [];
  const helpers = {
    sections,
    citations,
    availableConnectors,
    authorize,
    githubFetch,
    listMemories,
    mountValidator,
  };

  for (const descriptor of expanded) {
    try {
      await collectSourceDescriptor(record, descriptor, actorContext, helpers);
    } catch (err) {
      const itemLabel =
        descriptor.scope === 'file'
          ? sourceLabelForFile(descriptor)
          : descriptor.sourceLabel ||
            descriptor.mountedPath ||
            descriptor.connectorId;
      markScopeFailed(
        record.id,
        descriptor.scope,
        err instanceof Error ? err.message : String(err),
        descriptor.connectorId,
        [],
        itemLabel,
      );
    }
  }

  return { sections, citations, sourceCollectionId: record.id };
}

export async function collectSources(
  reportJobId: string,
  sourceScopes: string[],
  query: string,
  actorContext: SourceCollectionActorContext,
  dependencies: SourceCollectionDependencies = {},
): Promise<CollectedSources> {
  const availableConnectors =
    dependencies.availableConnectors ?? getAvailableConnectors();
  const descriptors: SourceDescriptor[] = [];
  for (const sourceScope of sourceScopes) {
    const connectorMatch = /^(?:mcp|connector):(.+)$/.exec(sourceScope);
    if (connectorMatch) {
      descriptors.push({
        scope: 'connector',
        connectorId: connectorMatch[1],
        query,
      });
      continue;
    }
    const fileMatch = /^(?:file|mounted):(.+)$/.exec(sourceScope);
    if (fileMatch) {
      descriptors.push({ scope: 'file', mountedPath: fileMatch[1], query });
      continue;
    }
    if (!isSourceScope(sourceScope)) continue;
    const scope = sourceScope;
    if (scope === 'connector') {
      if (availableConnectors.length === 0) {
        descriptors.push({ scope: 'connector', query });
      } else {
        for (const connectorId of availableConnectors) {
          descriptors.push({ scope: 'connector', connectorId, query });
        }
      }
    } else {
      descriptors.push({ scope, query });
    }
  }
  return collectReportSources(
    reportJobId,
    actorContext,
    descriptors,
    dependencies,
  );
}

export async function retrySourceCollection(
  collectionId: string,
  actorContext: SourceCollectionActorContext,
  dependencies: SourceCollectionDependencies = {},
): Promise<SourceCollectionRecord> {
  const record = getSourceCollection(collectionId);
  if (!record) throw new Error(`Source collection not found: ${collectionId}`);

  const availableConnectors =
    dependencies.availableConnectors ?? getAvailableConnectors();
  const authorize =
    dependencies.authorizeConnectorAction ?? authorizeConnectorAction;
  const githubFetch = dependencies.githubApi ?? githubApi;

  let resetAny = false;
  const expandedItems: SourceCollectionItem[] = [];
  for (const item of record.items) {
    if (item.scope === 'connector' && item.status === 'failed') {
      if (!item.connectorId) {
        if (availableConnectors.length === 0) continue;
        for (const connectorId of availableConnectors) {
          expandedItems.push({
            ...item,
            connectorId,
            sourceLabel: item.sourceLabel || connectorId,
            status: 'pending',
            completedAt: null,
            failureReason: null,
            provenance: [],
          });
        }
        resetAny = true;
        continue;
      }
      item.status = 'pending';
      item.completedAt = null;
      item.failureReason = null;
      item.provenance = [];
      resetAny = true;
    }
    expandedItems.push(item);
  }

  if (resetAny) record.items = expandedItems;

  if (!resetAny) {
    return record;
  }

  record.status = 'collecting';
  record.completedAt = null;
  record.failureReason = null;

  const collections = readCollections();
  const idx = collections.findIndex((c) => c.id === collectionId);
  if (idx >= 0) collections[idx] = record;
  writeCollections(collections);

  for (const item of record.items) {
    if (
      item.scope !== 'connector' ||
      item.status !== 'pending' ||
      !item.connectorId
    ) {
      continue;
    }

    if (!availableConnectors.includes(item.connectorId)) {
      markScopeFailed(
        record.id,
        'connector',
        `Connector not available: ${item.connectorId}`,
        item.connectorId,
        [],
        item.sourceLabel,
      );
      continue;
    }

    const authorization = authorizeSourceConnector(
      record.reportJobId,
      item.connectorId,
      actorContext,
      authorize,
    );
    if (!authorization.allowed) {
      markScopeFailed(
        record.id,
        'connector',
        `Connector access ${authorization.decision}: ${authorization.reason}`,
        item.connectorId,
        [`authorization:${authorization.decision}`],
        item.sourceLabel,
      );
      continue;
    }

    try {
      await fetchConnectorSource(
        record.id,
        item.connectorId,
        item.sourceLabel,
        record.query || '',
        [],
        [],
        githubFetch,
      );
    } catch (err) {
      markScopeFailed(
        record.id,
        'connector',
        err instanceof Error ? err.message : String(err),
        item.connectorId,
        [],
        item.sourceLabel,
      );
    }
  }

  return getSourceCollection(collectionId)!;
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
