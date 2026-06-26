import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Wiki knowledge workbench UI', () => {
  it('frames Wiki as durable agent reference material', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Knowledge base');
    expect(source).toContain(
      'Keep durable reference material close to the agents',
    );
    expect(source).toContain(
      'stable notes, source summaries, project background',
    );
    expect(source).toContain('wiki-command-center');
    expect(source).toContain('wiki-stats');
    expect(source).toContain('wiki-reference-lanes');
    expect(source).toContain('wikiRoutingGate');
    expect(source).toContain('wiki-routing-gate');
    expect(source).toContain('wikiPromotionChecklist');
    expect(source).toContain('wiki-promotion-checklist');
    expect(source).toContain('wiki-layout');
    expect(source).toContain('wikiReferenceBriefText');
    expect(source).toContain('Wiki reference brief');
    expect(source).toContain('Copy reference brief');
    expect(source).toContain('copyWikiReferenceBrief');
    expect(source).toContain('Wiki reference brief copied');
    expect(source).toContain('wikiPromotionPromptText');
    expect(source).toContain('Data health: ${loadIssue ||');
    expect(source).toContain('Wiki page list loaded without known fallback.');
    expect(source).toContain(
      'Wiki page list unavailable. Check logs before assuming no durable references exist.',
    );
    expect(source).toContain('wikiLoadIssue');
    expect(source).toContain('loadIssue: wikiLoadIssue');
    expect(source).toContain('wiki-stat is-warning');
    expect(source).toContain(
      'Promote a stable source summary into a NanoCrab Wiki reference.',
    );
    expect(source).toContain(
      'Start from a Cowork project note, report output, artifact, MCP/email summary, or cited document draft that already has source context attached.',
    );
    expect(source).toContain(
      'Name the source system, project, sender or filter, date window, artifact path, and any MCP server used.',
    );
    expect(source).toContain(
      'Do not promote private email detail, live tasks, unresolved assumptions, or material that still belongs in the active Cowork project.',
    );
    expect(source).toContain(
      'Add a short "Agent use" section explaining when Copilot, Cowork, Code, Reports, or MCP-backed tasks should cite this page.',
    );
    expect(source).toContain(
      'Source ledger naming source systems, project files, artifacts, MCP calls, dates, and any skipped or missing citations.',
    );
    expect(source).toContain('Copy promotion prompt');
    expect(source).toContain('copyWikiPromotionPrompt');
    expect(source).toContain('Wiki promotion prompt copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("prompt('Copy wiki reference brief:'");
    expect(source).not.toContain("prompt('Copy wiki promotion prompt:'");
    expect(source).toContain('window._wikiReferenceState');
    expect(source).not.toContain(
      "pages_list = await api('/wiki');\n  } catch {}",
    );
  });

  it('explains what belongs in Wiki versus Cowork projects and Memory', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('wikiReferenceLanes');
    expect(source).toContain('Summaries and citations');
    expect(source).toContain('Operating notes');
    expect(source).toContain('Reference, not workspace');
    expect(source).toContain('Not memory');
    expect(source).toContain(
      'Keep active files, artifacts, and project chats in Cowork projects',
    );
    expect(source).toContain('Use Memory for personal preferences');
    expect(source).toContain(
      'Use Wiki for stable reference notes, source summaries, operating playbooks, citations, and durable background',
    );
    expect(source).toContain(
      'Cite Wiki pages by title when they inform a Copilot, Cowork, Code, report, or MCP-backed task',
    );
    expect(source).toContain('No wiki pages have been saved yet');
    expect(source).toContain(
      'outlive a single Copilot chat, Cowork project, or Code run',
    );
    expect(source).toContain(
      'Keep active files and artifacts in Cowork projects, durable personal preferences in Memory, and reusable procedures in Skills',
    );
    expect(source).toContain('Knowledge routing gate');
    expect(source).toContain('Put knowledge where agents can use it cleanly');
    expect(source).toContain(
      'When Cowork chats call MCP servers for email, documents, or research',
    );
    expect(source).toContain('Promotion checklist');
    expect(source).toContain(
      'Promote only stable, citable knowledge into Wiki',
    );
    expect(source).toContain(
      'Use this before turning a Cowork project note, report output, email summary, or artifact into durable reference material.',
    );
    expect(source).toContain('Stabilize source');
    expect(source).toContain(
      'The summary, citation, or operating note already exists in Cowork, Reports, or Artifacts with source context attached.',
    );
    expect(source).toContain('Remove live work');
    expect(source).toContain(
      'Draft tasks, private email details, transient decisions, and unresolved assumptions stay in the project workspace.',
    );
    expect(source).toContain('Name citations');
    expect(source).toContain(
      'The page names source systems, artifact paths, project names, and dates clearly enough for an agent to cite later.',
    );
    expect(source).toContain('Choose next owner');
    expect(source).toContain(
      'If this is personal preference, send it to Memory. If it is repeatable procedure, promote it to Skills instead.',
    );
    expect(source).toContain(
      'Save MCP/email summaries to a Cowork project first, then promote durable source summaries or citations into Wiki',
    );
    expect(source).toContain(
      'Promote repeated source handling or document generation patterns into Skills after review',
    );
    expect(source).toContain(
      'Stable source summaries, citable background, operating notes, and reference pages agents should reuse later',
    );
    expect(source).toContain(
      'Personal preferences, durable facts about the user, and approved context that should follow Copilot, Cowork, and Code',
    );
    expect(source).toContain(
      'Active files, MCP/email research outputs, generated documents, artifacts, and project chats agents should keep working on',
    );
    expect(source).toContain(
      'Repeated workflows, trigger rules, source handling steps, and provider-neutral instructions worth reusing',
    );
  });

  it('preserves wiki search, page list, editor, and create hooks', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/wiki')");
    expect(source).toContain('id="wiki-search"');
    expect(source).toContain('id="wiki-page-list"');
    expect(source).toContain('id="wiki-editor"');
    expect(source).toContain('renderWikiPageListHtml');
    expect(source).toContain('renderWikiPageList');
    expect(source).toContain('renderWikiPageListEmptyState');
    expect(source).toContain('renderWikiEditorEmptyState');
    expect(source).toContain('renderWikiLoadErrorState');
    expect(source).toContain('renderWikiPageLoadingState');
    expect(source).toContain('wikiJsStringAttr');
    expect(source).toContain('newWikiPage');
    expect(source).toContain('saveNewWikiPage');
    expect(source).toContain('wiki-reference-card');
    expect(source).toContain('wiki-page-empty');
    expect(source).toContain('wiki-page-empty-state');
    expect(source).toContain('wiki-editor-empty-state');
    expect(source).toContain('wiki-page-loading-state');
    expect(source).toContain('Start with one reusable reference');
    expect(source).toContain('Choose a reference page or draft one here');
    expect(source).toContain(
      'Opening the saved markdown, citation context, and edit controls',
    );
    expect(source).toContain('wiki-title-field');
    expect(source).toContain('wiki-content-field');
  });

  it('keeps selected page editing, saving, and deletion wired', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const wikiSource = source.slice(
      source.indexOf('async function renderWiki'),
      source.indexOf('// --- Workflows ---'),
    );

    expect(source).toContain('selectWikiPage');
    expect(source).toContain('id="wiki-edit-content"');
    expect(source).toContain('saveWikiPage');
    expect(source).toContain('deleteWikiPage');
    expect(source).toContain("deleteWikiPage('${esc(name)}', this)");
    expect(source).toContain('inlineConfirm(btnEl, `Delete "${name}"?`');
    expect(source).toContain('wiki-editor-textarea tall');
    expect(source).toContain('wiki-editor-titlebar');
    expect(source).toContain('wiki-editor-actions');
    expect(source).toContain('Failed to load page');
    expect(source).toContain('Wiki page unavailable');
    expect(source).toContain('Loading ${esc(name ||');
    expect(source).toContain("selectWikiPage('${safeName}')");
    expect(wikiSource).not.toContain(
      'editor.innerHTML = \'<div class="loading">Loading</div>\'',
    );
    expect(wikiSource).not.toContain('confirm(`Delete "${name}"?`)');
    expect(wikiSource).not.toContain('style="max-width:100%"');
    expect(wikiSource).not.toContain('style="margin-top:12px"');
    expect(wikiSource).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"',
    );
  });

  it('uses actionable Wiki errors for reference creation, search, save, and delete', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const wikiSource = source.slice(
      source.indexOf('async function renderWiki'),
      source.indexOf('// --- Workflows ---'),
    );

    expect(wikiSource).toContain('function wikiActionErrorMessage');
    expect(wikiSource).toContain('Wiki page was not created.');
    expect(wikiSource).toContain('Wiki page was not saved.');
    expect(wikiSource).toContain('Wiki page was not deleted.');
    expect(wikiSource).toContain('Wiki search could not refresh.');
    expect(wikiSource).toContain('stable enough to become durable reference');
    expect(wikiSource).toContain('Preserve the editor text');
    expect(wikiSource).toContain(
      'Copilot, Cowork, Code, reports, MCP summaries, or skills still cite this reference',
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('search', err), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('create', r), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('create', err), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('save', r), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('save', err), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('delete', r), 'error')",
    );
    expect(wikiSource).toContain(
      "toast(wikiActionErrorMessage('delete', err), 'error')",
    );
    expect(wikiSource).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(wikiSource).not.toContain("toast('Failed to create page', 'error')");
    expect(wikiSource).not.toContain("toast('Failed to save page', 'error')");
    expect(wikiSource).not.toContain("toast('Failed to delete page', 'error')");
  });

  it('styles the wiki workbench and responsive state', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.wiki-command-center');
    expect(source).toContain('.wiki-stats');
    expect(source).toContain('.wiki-stat.is-warning');
    expect(source).toContain('.wiki-reference-lanes');
    expect(source).toContain('.wiki-routing-gate');
    expect(source).toContain('.wiki-routing-copy');
    expect(source).toContain('.wiki-routing-grid');
    expect(source).toContain('.wiki-routing-card');
    expect(source).toContain('.wiki-promotion-checklist');
    expect(source).toContain('.wiki-promotion-copy');
    expect(source).toContain('.wiki-promotion-grid');
    expect(source).toContain('.wiki-promotion-card');
    expect(source).toContain('.wiki-reference-card');
    expect(source).toContain('.wiki-layout');
    expect(source).toContain('.wiki-page-list');
    expect(source).toContain('.wiki-editor-panel');
    expect(source).toContain('.wiki-page-link.active');
    expect(source).toContain('.wiki-editor-textarea.tall');
    expect(source).toContain('.wiki-editor-titlebar');
    expect(source).toContain('.wiki-editor-actions');
    expect(source).toContain('.wiki-title-field .search-input');
    expect(source).toContain('.wiki-page-empty');
    expect(source).toContain('.wiki-page-empty-state');
    expect(source).toContain('.wiki-editor-empty-state');
    expect(source).toContain('.wiki-load-error-state');
    expect(source).toContain('.wiki-page-loading-state');
    expect(source).toContain('.wiki-loading-bars');
    expect(source).toContain('@keyframes wikiLoadingSweep');
    expect(source).toContain('.wiki-empty-flow');
    expect(source).toContain(
      '.wiki-routing-gate,\n  .wiki-promotion-checklist {\n    grid-template-columns: 1fr;',
    );
    expect(source).toContain(
      '.wiki-stats,\n  .wiki-reference-lanes,\n  .wiki-routing-grid,\n  .wiki-promotion-grid,\n  .wiki-empty-flow {\n    grid-template-columns: 1fr;',
    );
  });
});
