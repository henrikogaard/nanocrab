import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-artifact-vault-${Date.now()}`,
);

vi.mock('./config.js', () => ({
  STORE_DIR,
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
  listArtifactVault,
  pruneArtifactVault,
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

    const pruneResult = pruneArtifactVault({
      now: new Date('2027-07-08T10:20:00.000Z'),
    });
    expect(pruneResult.removed).toBe(0);
    expect(fs.existsSync(artifactPath)).toBe(true);
  });
});
