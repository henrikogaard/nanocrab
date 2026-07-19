import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-artifact-vault-${Date.now()}`,
);
const GROUPS_DIR = path.join(STORE_DIR, 'groups');

vi.mock('./config.js', () => ({
  STORE_DIR,
  GROUPS_DIR,
}));

vi.mock('./journal-store.js', () => ({
  findJournalEvents: () => [],
  listJournalEntryRecords: () => [],
}));

vi.mock('./memory-store.js', () => ({
  listMemoryRecords: () => [],
}));

const {
  buildArtifactVaultFromCoworkArtifacts,
  buildArtifactVaultFromReports,
  getArtifactVaultRecord,
  ingestArtifactFromSource,
  listArtifactVault,
  pruneArtifactVault,
  resolveArtifactVaultPath,
  searchArtifactVault,
} = await import('./artifact-vault.js');

const { createReportJob, approveReportOutline } =
  await import('./report-jobs.js');

function writeReportWithArtifact() {
  const deliverablesDir = path.join(STORE_DIR, 'deliverables');
  fs.mkdirSync(deliverablesDir, { recursive: true });
  const artifactPath = path.join(deliverablesDir, 'weekly-digest.md');
  fs.writeFileSync(
    artifactPath,
    '# Weekly Digest\n\nFleet crash near Kepler.\n',
  );
  const job = createReportJob({
    title: 'Weekly Digest',
    request: 'Summarize fleet crash and follow-up actions.',
    outputFormats: ['markdown'],
    deliverablesDir,
    requireOutlineApproval: false,
    requireDeliveryApproval: false,
  });
  return { job, artifactPath };
}

describe('artifact vault', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
  });

  it('indexes report artifacts with searchable source links', async () => {
    const { job } = writeReportWithArtifact();
    const exported = await approveReportOutline(job.id);
    exported.citations = [
      { label: 'Fleet crash near Kepler', source: 'journal:evt-1' },
      { label: 'Standing defense memory', source: 'memory:mem-1' },
    ];

    const result = buildArtifactVaultFromReports({
      reports: [exported],
      now: new Date('2026-06-13T12:00:00.000Z'),
    });

    expect(result.updated).toBe(1);
    expect(searchArtifactVault({ query: 'kepler' })).toContainEqual(
      expect.objectContaining({
        title: 'Weekly Digest',
        kind: 'report',
        sourceLinks: expect.arrayContaining([
          expect.objectContaining({ source: 'journal:evt-1' }),
        ]),
      }),
    );
  });

  it('prunes expired vault records without deleting external deliverable files', () => {
    const { job, artifactPath } = writeReportWithArtifact();
    buildArtifactVaultFromReports({
      reports: [
        {
          ...job,
          artifacts: [{ format: 'markdown', path: artifactPath }],
          citations: [],
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      now: new Date('2026-01-01T00:00:00.000Z'),
      retentionDays: 1,
    });

    const result = pruneArtifactVault({
      now: new Date('2026-01-03T00:00:00.000Z'),
    });

    expect(result.removed).toBe(1);
    expect(listArtifactVault()).toEqual([]);
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('indexes Cowork project artifacts as active project records', () => {
    const projectDir = path.join(STORE_DIR, 'projects', 'aurora-docs');
    const artifactPath = path.join(projectDir, 'artifacts', 'brief.md');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, '# Brief\n\nSource-backed draft.\n');

    const result = buildArtifactVaultFromCoworkArtifacts({
      artifacts: [
        {
          projectId: 'project-aurora',
          projectName: 'Aurora Docs',
          projectSlug: 'aurora-docs',
          title: 'Launch brief',
          filePath: 'artifacts/brief.md',
          hostPath: artifactPath,
          artifactId: 'run:run-1:artifacts/brief.md',
          sourceLinks: [
            {
              label: 'Run source ledger',
              source: 'cowork-run:run-1',
            },
          ],
          createdAt: '2026-07-08T10:00:00.000Z',
          updatedAt: '2026-07-08T10:15:00.000Z',
        },
      ],
      now: new Date('2026-07-08T10:20:00.000Z'),
    });

    expect(result.added).toBe(1);
    expect(searchArtifactVault({ query: 'Aurora Docs' })).toContainEqual(
      expect.objectContaining({
        title: 'Launch brief',
        kind: 'cowork-artifact',
        sourceType: 'cowork-project',
        sourceId: 'project-aurora',
        projectId: 'project-aurora',
        projectSlug: 'aurora-docs',
        projectFilePath: 'artifacts/brief.md',
        retentionDays: 0,
        expiresAt: null,
        sourceLinks: expect.arrayContaining([
          expect.objectContaining({ source: 'cowork-run:run-1' }),
        ]),
      }),
    );
    expect(searchArtifactVault({ query: 'artifacts/brief.md' })).toContainEqual(
      expect.objectContaining({ projectFilePath: 'artifacts/brief.md' }),
    );
    expect(searchArtifactVault({ query: 'cowork-run:run-1' })).toContainEqual(
      expect.objectContaining({ title: 'Launch brief' }),
    );
    expect(searchArtifactVault({ query: 'Launch brief' })).toContainEqual(
      expect.objectContaining({ projectId: 'project-aurora' }),
    );
    expect(searchArtifactVault({ source: 'aurora-docs' })).toContainEqual(
      expect.objectContaining({ projectSlug: 'aurora-docs' }),
    );

    const secondResult = buildArtifactVaultFromCoworkArtifacts({
      artifacts: [
        {
          projectId: 'project-aurora',
          projectName: 'Aurora Docs',
          projectSlug: 'aurora-docs',
          title: 'Launch brief',
          filePath: 'artifacts/brief.md',
          hostPath: artifactPath,
          artifactId: 'run:run-1:artifacts/brief.md',
          updatedAt: '2026-07-08T10:30:00.000Z',
        },
      ],
      now: new Date('2026-07-08T10:35:00.000Z'),
    });

    expect(secondResult).toMatchObject({ added: 0, updated: 1, total: 1 });

    const pruneResult = pruneArtifactVault({
      now: new Date('2027-07-08T10:20:00.000Z'),
    });
    expect(pruneResult.removed).toBe(0);
    expect(fs.existsSync(artifactPath)).toBe(true);
  });

  it('ingests non-report artifacts with provenance and source-ledger linkage', () => {
    const sourceFile = path.join(STORE_DIR, 'external-note.md');
    fs.writeFileSync(sourceFile, '# External note\n\nSource-backed content.');

    const result = ingestArtifactFromSource({
      title: 'External note',
      path: sourceFile,
      sourceType: 'mcp',
      sourceId: 'collection-123',
      sourceLinks: [{ label: 'Source ledger', source: 'ledger:ledger-abc' }],
      tags: ['mcp'],
    });

    expect(result.added).toBe(true);
    expect(result.record).toMatchObject({
      title: 'External note',
      kind: 'source',
      sourceType: 'mcp',
      sourceId: 'collection-123',
      sourceLinks: expect.arrayContaining([
        expect.objectContaining({ source: 'ledger:ledger-abc' }),
      ]),
      tags: expect.arrayContaining(['source', 'mcp']),
    });
    expect(searchArtifactVault({ query: 'External note' })).toContainEqual(
      expect.objectContaining({ id: result.record.id }),
    );
    expect(getArtifactVaultRecord(result.record.id)?.id).toBe(result.record.id);
  });

  it('resolves an ingested artifact path for download inside allowed roots', () => {
    const sourceFile = path.join(STORE_DIR, 'downloadable-note.md');
    fs.writeFileSync(sourceFile, 'Downloadable content.');

    const { record } = ingestArtifactFromSource({
      title: 'Downloadable note',
      path: sourceFile,
      sourceType: 'mounted',
      sourceId: 'collection-456',
    });

    const resolved = resolveArtifactVaultPath(record);
    expect(resolved.path).toBe(fs.realpathSync(sourceFile));
    expect(resolved.root).toBe(fs.realpathSync(STORE_DIR));
  });

  it('keeps same-named source artifacts from different directories distinct', () => {
    const firstDirectory = path.join(STORE_DIR, 'first');
    const secondDirectory = path.join(STORE_DIR, 'second');
    fs.mkdirSync(firstDirectory, { recursive: true });
    fs.mkdirSync(secondDirectory, { recursive: true });
    const first = path.join(firstDirectory, 'note.md');
    const second = path.join(secondDirectory, 'note.md');
    fs.writeFileSync(first, 'First');
    fs.writeFileSync(second, 'Second');

    const firstRecord = ingestArtifactFromSource({
      title: 'First note',
      path: first,
      sourceType: 'mcp',
      sourceId: 'collection-same',
    }).record;
    const secondRecord = ingestArtifactFromSource({
      title: 'Second note',
      path: second,
      sourceType: 'mcp',
      sourceId: 'collection-same',
    }).record;

    expect(firstRecord.id).not.toBe(secondRecord.id);
    expect(getArtifactVaultRecord(firstRecord.id)).toBeDefined();
    expect(getArtifactVaultRecord(secondRecord.id)).toBeDefined();
  });

  it('rejects source paths that cannot be opened through vault controls', () => {
    const outside = path.join('/tmp', `nanocrab-outside-${Date.now()}.md`);
    fs.writeFileSync(outside, 'Outside');
    try {
      expect(() =>
        ingestArtifactFromSource({
          title: 'Outside',
          path: outside,
          sourceType: 'mounted',
          sourceId: 'outside',
        }),
      ).toThrow(/outside allowed roots/i);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('retains non-report artifacts with configurable retention and prunes on expiry', () => {
    const sourceFile = path.join(STORE_DIR, 'retained-note.md');
    fs.writeFileSync(sourceFile, 'Retained content.');

    const { record } = ingestArtifactFromSource({
      title: 'Retained note',
      path: sourceFile,
      sourceType: 'mounted',
      sourceId: 'collection-789',
      retentionDays: 1,
    });

    expect(record.retentionDays).toBe(1);
    expect(record.expiresAt).not.toBeNull();

    const pruned = pruneArtifactVault({
      now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    });
    expect(pruned.removed).toBeGreaterThanOrEqual(1);
    expect(listArtifactVault()).not.toContainEqual(
      expect.objectContaining({ id: record.id }),
    );
    expect(fs.existsSync(sourceFile)).toBe(true);
  });
});
