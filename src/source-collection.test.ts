import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  startSourceCollection,
  markScopeCollected,
  markScopeFailed,
  cancelSourceCollection,
  addLedgerEntry,
  getSourceCollection,
  getSourceCollectionByReportJobId,
  listSourceCollections,
  getSourceLedger,
  collectSources,
} from './source-collection.js';
import { STORE_DIR } from './config.js';

const SOURCE_COLLECTIONS_PATH = path.join(STORE_DIR, 'source-collections.json');
const SOURCE_LEDGER_PATH = path.join(STORE_DIR, 'source-ledger.jsonl');

function cleanSourceCollectionState() {
  try {
    fs.unlinkSync(SOURCE_COLLECTIONS_PATH);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(SOURCE_LEDGER_PATH);
  } catch {
    /* ignore */
  }
}

describe('source-collection', () => {
  beforeEach(() => {
    cleanSourceCollectionState();
  });

  afterEach(() => {
    cleanSourceCollectionState();
  });

  describe('startSourceCollection', () => {
    it('creates a new source collection record', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      expect(collection).not.toBeNull();
      expect(collection.reportJobId).toBe('report-123');
      expect(collection.requestedScopes).toEqual(['memory', 'journal']);
      expect(collection.status).toBe('collecting');
      expect(collection.items.length).toBe(2);
    });

    it('initializes all scopes as pending', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
        'research',
      ]);
      expect(collection.items.every((i) => i.status === 'pending')).toBe(true);
    });

    it('finalizes a connector-only collection as failed when none are ready', () => {
      const startWithConnectors = startSourceCollection as unknown as (
        reportJobId: string,
        scopes: ['connector'],
        options: { availableConnectors: string[] },
      ) => ReturnType<typeof startSourceCollection>;
      const collection = startWithConnectors(
        'report-no-connector',
        ['connector'],
        { availableConnectors: [] },
      );

      expect(collection.status).toBe('failed');
      expect(collection.completedAt).not.toBeNull();
      expect(collection.items[0].status).toBe('failed');
    });
  });

  describe('collectSources connector authorization', () => {
    type Context = {
      actor: string;
      groupFolder: string;
      agentId: string;
    };
    type Dependencies = {
      availableConnectors: string[];
      authorizeConnectorAction: ReturnType<typeof vi.fn>;
      githubApi: ReturnType<typeof vi.fn>;
      listMemoryRecords?: ReturnType<typeof vi.fn>;
    };
    const collectWithContext = collectSources as unknown as (
      reportJobId: string,
      scopes: string[],
      query: string,
      context: Context,
      dependencies: Dependencies,
    ) => ReturnType<typeof collectSources>;

    it('authorizes the concrete GitHub read before fetching', async () => {
      const authorize = vi.fn().mockReturnValue({
        allowed: true,
        decision: 'allowed',
        reason: 'allowed',
      });
      const githubApi = vi.fn().mockResolvedValue({ items: [] });

      const collected = await collectWithContext(
        'report-authorized',
        ['connector'],
        'nanocrab',
        {
          actor: 'henrik',
          groupFolder: 'whatsapp_main',
          agentId: 'default_reports',
        },
        {
          availableConnectors: ['github'],
          authorizeConnectorAction: authorize,
          githubApi,
        },
      );

      expect(authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          connectorId: 'github',
          action: 'issues.read',
          groupFolder: 'whatsapp_main',
          agentId: 'default_reports',
        }),
      );
      expect(githubApi).toHaveBeenCalledOnce();
      expect(getSourceCollection(collected.sourceCollectionId)?.status).toBe(
        'completed',
      );
    });

    it('does not fetch on denial and records safe failed provenance', async () => {
      const authorize = vi.fn().mockReturnValue({
        allowed: false,
        decision: 'denied',
        reason: 'outside connector scope',
      });
      const githubApi = vi.fn();

      const collected = await collectWithContext(
        'report-denied',
        ['connector'],
        'nanocrab',
        {
          actor: 'henrik',
          groupFolder: 'whatsapp_main',
          agentId: 'default_reports',
        },
        {
          availableConnectors: ['github'],
          authorizeConnectorAction: authorize,
          githubApi,
        },
      );

      expect(githubApi).not.toHaveBeenCalled();
      const collection = getSourceCollection(collected.sourceCollectionId)!;
      expect(collection.status).toBe('failed');
      expect(collection.items[0]).toMatchObject({
        status: 'failed',
        provenance: ['authorization:denied'],
      });
    });

    it('keeps mixed local success and connector denial visibly partial', async () => {
      const collected = await collectWithContext(
        'report-partial',
        ['memory', 'connector'],
        'nanocrab',
        {
          actor: 'henrik',
          groupFolder: 'whatsapp_main',
          agentId: 'default_reports',
        },
        {
          availableConnectors: ['github'],
          authorizeConnectorAction: vi.fn().mockReturnValue({
            allowed: false,
            decision: 'denied',
            reason: 'outside connector scope',
          }),
          githubApi: vi.fn(),
          listMemoryRecords: vi.fn().mockReturnValue([]),
        },
      );

      expect(getSourceCollection(collected.sourceCollectionId)?.status).toBe(
        'partial',
      );
    });
  });

  describe('markScopeCollected', () => {
    it('marks a scope as completed', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      const updated = markScopeCollected(collection.id, 'memory', 5, [
        'db:memories',
      ]);
      const memoryItem = updated.items.find((i) => i.scope === 'memory');
      expect(memoryItem?.status).toBe('completed');
      expect(memoryItem?.itemCount).toBe(5);
      expect(memoryItem?.provenance).toEqual(['db:memories']);
    });

    it('updates overall status to partial when some scopes fail', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      markScopeCollected(collection.id, 'memory', 5);
      markScopeFailed(collection.id, 'journal', 'connector unavailable');
      const updated = getSourceCollection(collection.id)!;
      expect(updated.status).toBe('partial');
    });

    it('updates overall status to completed when all scopes succeed', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      markScopeCollected(collection.id, 'memory', 5);
      const updated = markScopeCollected(collection.id, 'journal', 3);
      expect(updated.status).toBe('completed');
    });

    it('throws for non-existent collection', () => {
      expect(() => markScopeCollected('non-existent', 'memory', 5)).toThrow(
        /not found/,
      );
    });

    it('throws for non-existent scope', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      expect(() => markScopeCollected(collection.id, 'journal', 5)).toThrow(
        /not in collection/,
      );
    });
  });

  describe('markScopeFailed', () => {
    it('marks a scope as failed with reason', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      const updated = markScopeFailed(collection.id, 'memory', 'timeout');
      const memoryItem = updated.items.find((i) => i.scope === 'memory');
      expect(memoryItem?.status).toBe('failed');
      expect(memoryItem?.failureReason).toBe('timeout');
    });

    it('updates overall status to failed when all scopes fail', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      markScopeFailed(collection.id, 'memory', 'error1');
      const updated = markScopeFailed(collection.id, 'journal', 'error2');
      expect(updated.status).toBe('failed');
    });
  });

  describe('cancelSourceCollection', () => {
    it('cancels a collection and all pending items', () => {
      const collection = startSourceCollection('report-123', [
        'memory',
        'journal',
      ]);
      const updated = cancelSourceCollection(collection.id);
      expect(updated.status).toBe('cancelled');
      expect(updated.items.every((i) => i.status === 'cancelled')).toBe(true);
    });

    it('throws for non-existent collection', () => {
      expect(() => cancelSourceCollection('non-existent')).toThrow(/not found/);
    });
  });

  describe('addLedgerEntry', () => {
    it('adds a citation-ready ledger entry', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      const entry = addLedgerEntry(
        collection.id,
        'memory',
        'User prefers dark mode',
        'User prefers dark mode for all interfaces',
        'mem://abc123',
      );
      expect(entry.reportJobId).toBe('report-123');
      expect(entry.scope).toBe('memory');
      expect(entry.sourceLabel).toBe('User prefers dark mode');
      expect(entry.citationText).toBe(
        'User prefers dark mode for all interfaces',
      );
    });

    it('appends to the ledger file', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      addLedgerEntry(collection.id, 'memory', 'Test', 'Test citation');
      const ledger = getSourceLedger('report-123');
      expect(ledger.length).toBe(1);
    });
  });

  describe('getSourceCollection', () => {
    it('returns a collection by id', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      const fetched = getSourceCollection(collection.id);
      expect(fetched).not.toBeUndefined();
      expect(fetched!.id).toBe(collection.id);
    });

    it('returns undefined for non-existent id', () => {
      expect(getSourceCollection('non-existent')).toBeUndefined();
    });
  });

  describe('getSourceCollectionByReportJobId', () => {
    it('returns a collection by report job id', () => {
      startSourceCollection('report-123', ['memory']);
      const fetched = getSourceCollectionByReportJobId('report-123');
      expect(fetched).not.toBeUndefined();
      expect(fetched!.reportJobId).toBe('report-123');
    });
  });

  describe('listSourceCollections', () => {
    it('lists all collections by default', () => {
      startSourceCollection('report-123', ['memory']);
      startSourceCollection('report-456', ['journal']);
      expect(listSourceCollections().length).toBe(2);
    });

    it('filters by status', () => {
      const c1 = startSourceCollection('report-123', ['memory']);
      startSourceCollection('report-456', ['journal']);
      cancelSourceCollection(c1.id);
      expect(listSourceCollections({ status: 'cancelled' }).length).toBe(1);
    });

    it('filters by reportJobId', () => {
      startSourceCollection('report-123', ['memory']);
      startSourceCollection('report-456', ['journal']);
      expect(listSourceCollections({ reportJobId: 'report-123' }).length).toBe(
        1,
      );
    });

    it('respects limit', () => {
      startSourceCollection('report-1', ['memory']);
      startSourceCollection('report-2', ['memory']);
      startSourceCollection('report-3', ['memory']);
      expect(listSourceCollections({ limit: 2 }).length).toBe(2);
    });
  });

  describe('getSourceLedger', () => {
    it('returns ledger entries for a report job', () => {
      const collection = startSourceCollection('report-123', ['memory']);
      addLedgerEntry(collection.id, 'memory', 'Source 1', 'Citation 1');
      addLedgerEntry(collection.id, 'memory', 'Source 2', 'Citation 2');
      const ledger = getSourceLedger('report-123');
      expect(ledger.length).toBe(2);
    });

    it('returns empty array for report job with no entries', () => {
      expect(getSourceLedger('non-existent')).toEqual([]);
    });
  });
});
