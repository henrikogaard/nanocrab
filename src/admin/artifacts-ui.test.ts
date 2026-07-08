import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const modesPath = path.join(process.cwd(), 'src/admin/public/modes.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Cowork artifact vault UI', () => {
  it('places reports and artifacts in Cowork navigation', () => {
    const source = fs.readFileSync(modesPath, 'utf8');

    expect(source).toContain("'reports'");
    expect(source).toContain("'artifacts'");
    expect(source).toContain("'approvals'");
    expect(source.indexOf("'reports'")).toBeLessThan(
      source.indexOf("'artifacts'"),
    );
  });

  it('frames artifacts as generated Cowork outputs with evidence and actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Cowork outputs');
    expect(source).toContain('Output hub');
    expect(source).toContain('Create document');
    expect(source).toContain("navigate('reports')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain('artifacts-command-center');
    expect(source).toContain('artifacts-lifecycle-map');
    expect(source).toContain('artifacts-reuse-router');
    expect(source).toContain('artifacts-reuse-grid');
    expect(source).toContain('artifacts-workbench');
    expect(source).toContain('artifacts-record-panel');
    expect(source).toContain('artifactLifecycleCards');
    expect(source).toContain('artifactReuseRoutes');
    expect(source).toContain('window._artifactVaultState');
    expect(source).toContain('Data health');
    expect(source).toContain('Artifact vault records unavailable');
    expect(source).toContain('Artifact vault summary unavailable');
    expect(source).toContain('Vault records and summary loaded');
    expect(source).toContain(
      "artifacts-command-stat ${loadIssues.length ? 'is-warning' : ''}",
    );
    expect(source).toContain('Decide where the artifact should work next.');
    expect(source).toContain(
      'active project work, stable knowledge, reusable procedure, or approval-gated delivery',
    );
    expect(source).toContain('Continue the project');
    expect(source).toContain('Promote stable reference');
    expect(source).toContain('Extract repeatable process');
    expect(source).toContain('Deliver externally');
    expect(source).toContain(
      'Generate documents, summaries, and exports from Cowork or scheduled work.',
    );
    expect(source).toContain(
      'Keep source links beside each artifact so reviewers can trust the output.',
    );
    expect(source).toContain(
      'Download finished artifacts or return to the source job when evidence or approvals are missing.',
    );
    expect(source).toContain(
      'Track expiry and prune old generated work when it is no longer useful.',
    );
  });

  it('surfaces source, retention, evidence, and download affordances per record', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('artifactExpiryBadge');
    expect(source).toContain('artifactHandoffBriefText');
    expect(source).toContain('artifactResumePromptText');
    expect(source).toContain('artifactMcpFollowupPromptText');
    expect(source).toContain('Source jobs');
    expect(source).toContain('With evidence');
    expect(source).toContain('retention clear');
    expect(source).toContain('artifact-source-line');
    expect(source).toContain('artifact-evidence-row');
    expect(source).toContain('artifactDownloadHref');
    expect(source).toContain('artifactProjectHref');
    expect(source).toContain('Open in project');
    expect(source).toContain('Continue chat');
    expect(source).toContain("record.sourceType === 'cowork-project'");
    expect(source).toContain('renderArtifactFacetChips');
    expect(source).toContain('artifact-facet-empty');
    expect(source).toContain('No artifact kinds indexed');
    expect(source).toContain(
      'Create a report, project document, or MCP summary to classify outputs.',
    );
    expect(source).toContain('No file formats indexed');
    expect(source).toContain(
      'Reindex report outputs after Markdown, HTML, DOCX, or PDF files exist.',
    );
    expect(source).toContain('renderArtifactEmptyState');
    expect(source).toContain('artifact-empty-state');
    expect(source).toContain('No artifacts indexed yet.');
    expect(source).toContain('turn a Cowork project into a document');
    expect(source).toContain('Copy the artifact handoff');
    expect(source).toContain('window.copyArtifactHandoffBrief');
    expect(source).toContain('Artifact handoff copied');
    expect(source).toContain('window.copyArtifactResumePrompt');
    expect(source).toContain('Cowork prompt');
    expect(source).toContain('Report prompt');
    expect(source).toContain('Artifact resume prompt copied');
    expect(source).toContain('MCP follow-up');
    expect(source).toContain('window.copyArtifactMcpFollowupPrompt');
    expect(source).toContain('Artifact MCP follow-up copied');
    expect(source).toContain(
      'Cowork artifact records preserve the owning project and selected project path.',
    );
    expect(source).toContain(
      'Use this NanoCrab artifact for an MCP-backed Cowork follow-up.',
    );
    expect(source).toContain(
      'Use approved MCP servers only when they fit the question, such as mail, calendar, document, storage, or custom source systems.',
    );
    expect(source).toContain(
      'Combine this artifact with any relevant project files, previous Cowork chats, and MCP evidence.',
    );
    expect(source).toContain(
      'Create or update a local Cowork project draft first, such as a markdown brief, summary document, action list, or source ledger.',
    );
    expect(source).toContain('Source ledger required:');
    expect(source).toContain('MCP server and tool-call purpose.');
    expect(source).toContain(
      'Query window, sender filter, topic filter, or document scope.',
    );
    expect(source).toContain('Local project file or artifact path created.');
    expect(source).toContain(
      'Reading approved source systems and writing local Cowork drafts is allowed.',
    );
    expect(source).toContain(
      'If a needed MCP connector or permission is missing, say exactly what is missing instead of inventing source results.',
    );
    expect(source).toContain('Use this NanoCrab artifact in ${destination}.');
    expect(source).toContain('Destination guidance:');
    expect(source).toContain(
      'Create or update a report/document from this artifact',
    );
    expect(source).toContain('Continue the Cowork project from this artifact');
    expect(source).toContain('Before changing the output:');
    expect(source).toContain(
      'Summarize what the artifact already proves and what remains uncertain.',
    );
    expect(source).toContain(
      'Keep the first revision as a local Cowork draft, report draft, or Code note before external delivery.',
    );
    expect(source).toContain('Use this NanoCrab artifact as Cowork context.');
    expect(source).toContain('Resume package checklist:');
    expect(source).toContain('Reuse routing:');
    expect(source).toContain('${item.route}: ${item.action}. ${item.detail}');
    expect(source).toContain("route: 'Cowork'");
    expect(source).toContain("route: 'Wiki'");
    expect(source).toContain("route: 'Skills'");
    expect(source).toContain("route: 'Approvals'");
    expect(source).toContain(
      'Confirm the project, artifact path, source job, evidence links, and approval boundary before continuing.',
    );
    expect(source).toContain(
      'If evidence is missing, rerun the source request as read-only in Cowork before changing the document.',
    );
    expect(source).toContain(
      'Keep follow-up drafts in the same Cowork project and export a new artifact after review.',
    );
    expect(source).toContain(
      'Ask before publishing externally, sending email, or updating any third-party document.',
    );
    expect(source).toContain('window._artifactRecords');
    expect(source).not.toContain(
      '<div class="empty artifact-empty">No artifacts indexed yet. Create a report or reindex reports after generating deliverables.</div>',
    );
    expect(source).not.toContain(
      '<span class="badge badge-muted">No kinds yet</span>',
    );
    expect(source).not.toContain(
      '<span class="badge badge-muted">No formats yet</span>',
    );
  });

  it('uses artifact-specific recovery messages for vault maintenance actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const artifactBlock = source.slice(
      source.indexOf('function artifactSize'),
      source.indexOf('// Skills'),
    );

    expect(artifactBlock).toContain('function artifactActionErrorMessage');
    expect(artifactBlock).toContain('Artifact search did not finish.');
    expect(artifactBlock).toContain('Artifact reindex did not finish.');
    expect(artifactBlock).toContain('Expired artifacts were not pruned.');
    expect(artifactBlock).toContain(
      'report outputs were reindexed after generation',
    );
    expect(artifactBlock).toContain(
      'source-link metadata before relying on the vault for Cowork handoff',
    );
    expect(artifactBlock).toContain(
      'active Cowork follow-ups before removing generated outputs',
    );
    expect(artifactBlock).toContain(
      "toast(artifactActionErrorMessage('search', err), 'error')",
    );
    expect(artifactBlock).toContain(
      "toast(artifactActionErrorMessage('reindex', r), 'error')",
    );
    expect(artifactBlock).toContain(
      "toast(artifactActionErrorMessage('reindex', err), 'error')",
    );
    expect(artifactBlock).toContain(
      "toast(artifactActionErrorMessage('prune', r), 'error')",
    );
    expect(artifactBlock).toContain(
      "toast(artifactActionErrorMessage('prune', err), 'error')",
    );
    expect(artifactBlock).not.toContain(
      "toast(r.error || 'Reindex failed', 'error')",
    );
    expect(artifactBlock).not.toContain(
      "toast(r.error || 'Prune failed', 'error')",
    );
  });

  it('styles the artifact vault as a responsive output workbench', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.artifacts-command-center');
    expect(source).toContain('.artifacts-command-stats');
    expect(source).toContain('.artifacts-command-stat.is-warning');
    expect(source).toContain('.artifacts-command-stat.is-warning strong');
    expect(source).toContain('.artifacts-command-stat small');
    expect(source).toContain('.artifacts-lifecycle-map');
    expect(source).toContain('.artifacts-lifecycle-card');
    expect(source).toContain('.artifacts-reuse-router');
    expect(source).toContain('.artifacts-reuse-router-head');
    expect(source).toContain('.artifacts-reuse-grid');
    expect(source).toContain('.artifacts-reuse-card');
    expect(source).toContain('.artifacts-workbench');
    expect(source).toContain('.artifacts-search-grid');
    expect(source).toContain('.artifact-record-card');
    expect(source).toContain('.artifact-path');
    expect(source).toContain('.artifact-empty-state');
    expect(source).toContain('.artifact-facet-empty');
    expect(source).toContain('.artifact-empty-actions');
    expect(source).toContain('.artifact-empty-flow');
    expect(source).toContain('.artifacts-lifecycle-map,');
    expect(source).toContain('.artifacts-reuse-grid,');
    expect(source).toContain(
      '.artifacts-command-center,\n  .artifacts-lifecycle-map,\n  .artifacts-reuse-grid,\n  .artifacts-workbench',
    );
  });
});
