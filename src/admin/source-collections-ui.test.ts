import { describe, expect, it } from 'vitest';
import fs from 'fs';
import * as vm from 'node:vm';
import path from 'path';

const sourceCollectionsPath = path.join(
  process.cwd(),
  'src/admin/public/pages/source-collections.js',
);

function loadSourceCollectionsUi(apiResponse: unknown = []) {
  const context = {
    window: {} as Record<string, unknown>,
    api: async () => apiResponse,
    esc: (value: unknown) => String(value),
    console,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(sourceCollectionsPath, 'utf8'), context);
  return context.window as {
    NanoSourceCollections: {
      normalize(value: unknown): unknown[];
    };
    renderSourceCollections(el: {
      innerHTML: string;
      querySelectorAll(selector: string): unknown[];
    }): Promise<void>;
  };
}

describe('source collections classic-script contract', () => {
  it('normalizes array responses, including empty arrays', () => {
    const { NanoSourceCollections } = loadSourceCollectionsUi();
    const collections = [{ id: 'collection-1' }];

    expect(NanoSourceCollections.normalize(collections)).toEqual(collections);
    expect(NanoSourceCollections.normalize([])).toEqual([]);
  });

  it('rejects non-array responses with an explicit contract error', () => {
    const { NanoSourceCollections } = loadSourceCollectionsUi();

    for (const value of [null, undefined, {}, 'invalid', 1]) {
      expect(() => NanoSourceCollections.normalize(value)).toThrow(
        'Source collection response must be an array',
      );
    }
  });

  it('fails closed when the page receives a malformed response', async () => {
    const { renderSourceCollections } = loadSourceCollectionsUi({ items: [] });
    const el = {
      innerHTML: '',
      querySelectorAll: () => [],
    };

    await renderSourceCollections(el);

    expect(el.innerHTML).toContain(
      'Failed to load source collections: Source collection response must be an array',
    );
  });

  it('keeps explicit empty and retry states', async () => {
    const emptyUi = loadSourceCollectionsUi([]);
    const emptyEl = {
      innerHTML: '',
      querySelectorAll: () => [],
    };

    await emptyUi.renderSourceCollections(emptyEl);
    expect(emptyEl.innerHTML).toContain('No source collections.');

    const retryUi = loadSourceCollectionsUi([
      {
        id: 'source-collection-mock-1',
        reportJobId: 'report-mock-2',
        requestedScopes: ['connector', 'file'],
        items: [
          {
            scope: 'connector',
            connectorId: 'gmail',
            sourceLabel: 'Launch readiness email',
            status: 'completed',
            requestedAt: '2026-06-09T20:10:00.000Z',
            completedAt: '2026-06-09T20:12:00.000Z',
            itemCount: 1,
            failureReason: null,
            provenance: ['mcp:gmail'],
          },
          {
            scope: 'file',
            sourceLabel: 'AuroraDocs project notes',
            status: 'failed',
            requestedAt: '2026-06-09T20:10:00.000Z',
            completedAt: '2026-06-09T20:12:00.000Z',
            itemCount: 0,
            failureReason: 'Mounted project source is unavailable',
            provenance: [],
          },
        ],
        ledger: [
          {
            id: 'source-ledger-mock-1',
            reportJobId: 'report-mock-2',
            scope: 'connector',
            connectorId: 'gmail',
            sourceLabel: 'Launch readiness email',
            sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/mock-thread',
            citationText:
              'The launch readiness review is scheduled for Friday.',
            collectedAt: '2026-06-09T20:12:00.000Z',
            provenance: ['mcp:gmail', 'message:mock-thread'],
          },
        ],
        status: 'partial',
        startedAt: '2026-06-09T20:10:00.000Z',
        completedAt: '2026-06-09T20:12:00.000Z',
        failureReason: 'One source failed to collect',
      },
    ]);
    const retryEl = {
      innerHTML: '',
      querySelectorAll: () => [],
    };

    await retryUi.renderSourceCollections(retryEl);

    expect(retryEl.innerHTML).toContain('Retry failed sources');
    expect(retryEl.innerHTML).toContain(
      '<button type="button" class="btn btn-sm btn-ghost source-collection-retry"',
    );
    expect(retryEl.innerHTML).toContain('data-id="source-collection-mock-1"');
  });
});
