import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const learningProposalsPath = path.join(
  process.cwd(),
  'src/admin/public/pages/learning-proposals.js',
);
const sourceCollectionsPath = path.join(
  process.cwd(),
  'src/admin/public/pages/source-collections.js',
);

describe('learning and source review UI', () => {
  it('renders the complete learning proposal evidence', () => {
    const source = fs.readFileSync(learningProposalsPath, 'utf8');

    expect(source).toContain('proposal.extractedLesson');
    expect(source).toContain('proposal.proposedScope');
    expect(source).toContain('proposal.validationResult');
    expect(source).toContain('proposal.diff');
    expect(source).toContain('Extracted lesson');
    expect(source).toContain('Diff summary');
    expect(source).toContain('learning-proposal-validation');
  });

  it('renders source ledger citations and provenance metadata', () => {
    const source = fs.readFileSync(sourceCollectionsPath, 'utf8');

    expect(source).toContain('entry.sourceLabel');
    expect(source).toContain('entry.citationText');
    expect(source).toContain('entry.sourceUrl');
    expect(source).toContain('entry.scope');
    expect(source).toContain('entry.connectorId');
    expect(source).toContain('entry.collectedAt');
    expect(source).toContain('entry.provenance');
    expect(source).toContain('<blockquote class="source-ledger-citation">');
    expect(source).toContain('rel="noopener noreferrer"');
  });
});
