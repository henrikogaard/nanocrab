import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Report Studio UI', () => {
  it('associates every report and briefing field label with its control', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    for (const [label, id] of [
      ['Source Scopes', 'report-sources'],
      ['Provider Profile', 'report-provider-profile'],
      ['Cadence', 'briefing-cadence'],
      ['Local Time', 'briefing-time'],
      ['Target Group', 'briefing-group'],
      ['Source Scopes', 'briefing-sources'],
      ['Provider Profile', 'briefing-provider-profile'],
    ]) {
      expect(source).toContain(`<label for="${id}">${label}</label>`);
    }
  });

  it('keeps production actions compact and gives the approval path visual priority', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const actionStyles = style.slice(
      style.indexOf('.report-production-actions {'),
      style.indexOf('.report-source-recipes {'),
    );

    expect(source).toContain(
      '<button class="report-production-primary" type="button" onclick="navigate(\'approvals\')">Review approvals</button>',
    );
    expect(actionStyles).toContain('grid-column: 1 / -1;');
    expect(actionStyles).toContain('display: flex;');
    expect(actionStyles).toContain('min-height: 38px;');
    expect(actionStyles).not.toContain('min-height: 82px;');
    expect(actionStyles).toContain(
      '.report-production-actions .report-production-primary',
    );
  });

  it('summarizes the production queue before report creation controls', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderReportProductionBrief');
    expect(source).toContain('function reportProductionStatus');
    expect(source).toContain('function reportLatestArtifact');
    expect(source).toContain('function reportProductionBriefText');
    expect(source).toContain('function reportCoworkPromptText');
    expect(source).toContain('function renderReportSourceRecipes');
    expect(source).toContain('function reportOutputGate');
    expect(source).toContain('function renderReportOutputGate');
    expect(source).toContain('Production queue');
    expect(source).toContain('Approvals waiting');
    expect(source).toContain('Ready outputs');
    expect(source).toContain('Copy production brief');
    expect(source).toContain('copyReportProductionBrief');
    expect(source).toContain('Report production brief copied');
    expect(source).toContain('Report Studio production brief');
    expect(source).toContain('Data health');
    expect(source).toContain(
      'Report jobs, briefing schedules, groups, and provider profiles loaded without known fallback.',
    );
    expect(source).toContain('Report job queue unavailable');
    expect(source).toContain('Briefing schedules unavailable');
    expect(source).toContain('Group delivery targets unavailable');
    expect(source).toContain('Provider profiles unavailable');
    expect(source).toContain('Report data loaded');
    expect(source).toContain('report-production-health');
    expect(source).toContain('loadIssues');
    expect(source).toContain('Copy Cowork prompt');
    expect(source).toContain('copyReportCoworkPrompt');
    expect(source).toContain('Report Cowork prompt copied');
    expect(source).toContain('Copy report Cowork prompt');
    expect(source).toContain(
      'Create a Cowork project report from approved sources.',
    );
    expect(source).toContain(
      'Return the draft, a short source ledger, open questions, and the next approval needed.',
    );
    expect(source).toContain('window._reportProductionState');
    expect(source).toContain("navigate('artifacts')");
    expect(
      source.indexOf(
        'renderReportProductionBrief(reportJobs, briefingSchedules, loadIssues)',
      ),
    ).toBeLessThan(source.indexOf('<section class="report-studio-hero">'));
    expect(source.indexOf('renderReportSourceRecipes()')).toBeLessThan(
      source.indexOf('<section class="report-studio-hero">'),
    );
    expect(source.indexOf('renderReportOutputGate()')).toBeLessThan(
      source.indexOf('<section class="report-studio-hero">'),
    );
  });

  it('offers source recipes for Cowork and MCP-backed document generation', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('reportSourceRecipes');
    expect(source).toContain('Latest email digest');
    expect(source).toContain('Sender summary');
    expect(source).toContain('Project handoff');
    expect(source).toContain('Decision log');
    expect(source).toContain('mcp:email, project, memory');
    expect(source).toContain(
      'Use Latest email digest for MCP-backed inbox summaries',
    );
    expect(source).toContain(
      'Use Sender summary when a Cowork project needs all recent email from a person or domain',
    );
    expect(source).toContain(
      'Keep outline and delivery approvals enabled for documents that may leave NanoCrab',
    );
    expect(source).toContain('Source-to-artifact checklist');
    expect(source).toContain('Output readiness gate');
    expect(source).toContain('Prove the document before it leaves Cowork');
    expect(source).toContain('Source window named');
    expect(source).toContain(
      'The request names the MCP server, sender/filter, project, date range, and the question the report should answer.',
    );
    expect(source).toContain('Cowork draft exists');
    expect(source).toContain(
      'The first markdown draft or summary lives inside the Cowork project before external document creation.',
    );
    expect(source).toContain('Evidence attached');
    expect(source).toContain(
      'The artifact records source systems, project files, previous chats, and approval IDs used to produce the output.',
    );
    expect(source).toContain('Delivery boundary set');
    expect(source).toContain(
      'Name the MCP server, source system, sender/filter, and search window before drafting',
    );
    expect(source).toContain(
      'Save the first draft inside the Cowork project so chats, files, and MCP evidence stay together',
    );
    expect(source).toContain(
      'Ask for approval before sending email, publishing documents, or updating external systems',
    );
    expect(source).toContain(
      'Use the current Cowork project files, recent project chats, memory, and any approved MCP servers that match the source scopes.',
    );
    expect(source).toContain(
      'If email, calendar, document, storage, or custom MCP tools are needed, gather read-only source context first and cite the source system, query/filter, and date window.',
    );
    expect(source).toContain(
      'Save the first markdown draft or summary inside the Cowork project before creating external documents.',
    );
    expect(source).toContain(
      'Record any artifact paths, approval IDs, MCP servers, and project files used.',
    );
    expect(source).toContain(
      'source window, decisions, blockers, and next actions',
    );
    expect(source).toContain('selected sender or domain');
    expect(source).toContain('applyReportRecipe');
    expect(source).toContain("navigate('projects')");
  });

  it('turns the empty report queue into a Cowork and MCP starter surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderReportJobsEmptyState');
    expect(source).toContain('Create a durable summary from live context');
    expect(source).toContain('MCP-backed email digest');
    expect(source).toContain('Latest email digest</button>');
    expect(source).toContain('applyReportRecipe(0)');
    expect(source).toContain('Project handoff</button>');
    expect(source).toContain('applyReportRecipe(2)');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain(
      "document.getElementById('report-request')?.focus()",
    );
    expect(source).toContain('renderReportJobsEmptyState()');
  });

  it('turns missing report artifacts into an actionable job state', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderReportJobArtifactState');
    expect(source).toContain('report-job-artifact-state');
    expect(source).toContain('Artifacts pending');
    expect(source).toContain('No exported artifacts yet.');
    expect(source).toContain(
      'Approve the outline before draft generation and artifact export can continue.',
    );
    expect(source).toContain(
      'The job has not produced downloadable Markdown, HTML, DOCX, or PDF output yet.',
    );
    expect(source).toContain('renderReportJobArtifactState(job)');
    expect(source).toContain("navigate('artifacts')");
    expect(source).not.toContain(
      '\'<div class="report-job-meta">No exported artifacts yet.</div>\'',
    );
    expect(style).toContain('.report-job-artifact-state');
    expect(style).toContain('.report-job-artifact-actions');
  });

  it('turns empty briefing schedules into a recurring-summary setup path', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function renderBriefingSchedulesEmptyState');
    expect(source).toContain('Create a recurring summary loop');
    expect(source).toContain(
      'Pick a target group, source scopes, and approval boundary',
    );
    expect(source).toContain(
      'Connect or register a group before scheduled briefings',
    );
    expect(source).toContain(
      "document.getElementById('briefing-title')?.focus()",
    );
    expect(source).toContain("navigate('groups')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain(
      'renderBriefingSchedulesEmptyState(groupList.length)',
    );
    expect(source).not.toContain(
      '\'<div class="empty report-empty">No briefing schedules yet.</div>\'',
    );
    expect(style).toContain('.briefing-empty-state');
  });

  it('uses source-aware recovery messages for report and briefing actions', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const reportBlock = source.slice(
      source.indexOf('function reportStatusBadge'),
      source.indexOf('function artifactSize'),
    );

    expect(reportBlock).toContain('function reportActionErrorMessage');
    expect(reportBlock).toContain('Report was not created.');
    expect(reportBlock).toContain('Briefing schedule was not created.');
    expect(reportBlock).toContain('Report outline was not approved.');
    expect(reportBlock).toContain('Report delivery was not approved.');
    expect(reportBlock).toContain(
      'source scopes, MCP/provider readiness, output formats, deliverables directory, and approval gates',
    );
    expect(reportBlock).toContain('recurring summaries should stay paused');
    expect(reportBlock).toContain(
      'source window, project context, and approval record',
    );
    expect(reportBlock).toContain(
      'exported artifacts, source citations, delivery boundary, and approval record',
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('create', r), 'error')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('create', err), 'error')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('briefing', r), 'error')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('briefing', err), 'error')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('outline', r), 'warning')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('outline', err), 'warning')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('delivery', r), 'warning')",
    );
    expect(reportBlock).toContain(
      "toast(reportActionErrorMessage('delivery', err), 'warning')",
    );
    expect(reportBlock).not.toContain(
      "toast(r.error || 'Failed to create report', 'error')",
    );
    expect(reportBlock).not.toContain(
      "toast(r?.error || 'Failed to create briefing', 'error')",
    );
    expect(reportBlock).not.toContain(
      "toast(r.error || 'Approval is still pending', 'warning')",
    );
    expect(reportBlock).not.toContain(
      "toast(r.error || 'Delivery approval is still pending', 'warning')",
    );
  });

  it('styles the production brief as a responsive report command surface', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.report-production-brief');
    expect(source).toContain('.report-production-main');
    expect(source).toContain('.report-production-meta');
    expect(source).toContain('.report-production-actions');
    expect(source).toContain(
      '.report-production-meta .report-production-health.is-warning',
    );
    expect(source).toContain(
      '.report-production-meta .report-production-health.is-warning strong',
    );
    expect(source).toContain('.report-create-actions');
    expect(source).toContain('.report-source-recipes');
    expect(source).toContain('.report-recipe-grid');
    expect(source).toContain('.report-recipe-card');
    expect(source).toContain('.report-output-gate');
    expect(source).toContain('.report-output-gate-grid');
    expect(source).toContain('.report-output-gate-card');
    expect(source).toContain('.report-production-brief,');
    expect(source).toContain('.report-recipe-grid,');
    expect(source).toContain('.report-output-gate-grid,');
    expect(source).toContain('.report-production-actions,');
    expect(source).toContain('.report-create-actions');
    expect(source).toContain('.report-empty-state');
    expect(source).toContain('.briefing-empty-state');
    expect(source).toContain('.report-empty-flow');
    expect(source).toContain('.report-empty-actions');
  });
});
