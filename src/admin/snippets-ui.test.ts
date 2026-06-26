import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const mockPath = path.join(process.cwd(), 'src/admin/mock-data.ts');

describe('Snippets pattern library UI', () => {
  it('frames snippets as a reusable pattern library', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('Pattern library');
    expect(source).toContain('Snippets');
    expect(source).toContain('snippets-command-center');
    expect(source).toContain('snippets-stats');
    expect(source).toContain('snippet-reuse-map');
    expect(source).toContain('snippet-library-grid');
    expect(source).toContain('snippet-library-card');
    expect(source).toContain('snippet-data-health');
    expect(source).toContain('Data health');
    expect(source).toContain('Snippet library loaded without known fallback.');
    expect(source).toContain("loadIssues.push('Snippet library unavailable')");
    expect(source).toContain('Snippet feed needs review');
    expect(source).toContain('Saved reusable patterns did not load.');
    expect(source).toContain('Library empty');
    expect(source).toContain('renderSnippetEmptyState');
    expect(source).toContain('Start with one reusable pattern');
    expect(source).toContain('No snippets match this search');
    expect(source).toContain('Failed to load snippets');
    expect(source).toContain('Snippet unavailable');
    expect(source).toContain('Failed to load snippet');
    expect(source).toContain('clearSnippetSearch');
    expect(source).toContain('snippet-empty-flow');
    expect(source).toContain('snippets-empty-actions');
    expect(source).toContain('Skill candidates');
    expect(source).toContain('snippetReuseLanes');
    expect(source).toContain('snippetPromotionSteps');
    expect(source).toContain('snippetDecisionGate');
    expect(source).toContain('snippet-promotion-path');
    expect(source).toContain('snippet-decision-gate');
    expect(source).toContain('snippetLibraryBriefText');
    expect(source).toContain('_snippetLibraryState');
    expect(source).toContain('loadIssues,');
    expect(source).toContain('copySnippetLibraryBrief');
    expect(source).toContain('Copy snippet brief');
    expect(source).toContain('Snippet library brief');
    expect(source).toContain(
      'Keep reusable phrasing for quick plain-chat requests.',
    );
    expect(source).toContain(
      'Turn repeated planning, summary, and document patterns into project context.',
    );
    expect(source).toContain(
      'Save review checklists, fix commands, and verification recipes.',
    );
    expect(source).toContain(
      'Capture routine commands for releases, incidents, and maintenance.',
    );
    expect(source).toContain(
      'Keep quick plain-chat wording in Snippets, project-specific working context in Cowork projects, durable personal facts in Memory, and stable repeated capabilities in Skills.',
    );
    expect(source).toContain('Promote a snippet into a Skill');
    expect(source).toContain('Promotion path');
    expect(source).toContain('Keep as snippet');
    expect(source).toContain('Move to Cowork');
    expect(source).toContain('Route to Code');
    expect(source).toContain(
      'Use when the workflow needs trigger rules, stable instructions, provider-neutral tools, or repeated agent behavior.',
    );
    expect(source).toContain('Decision gate');
    expect(source).toContain(
      'Put the pattern where future work will look for it.',
    );
    expect(source).toContain('One-off wording');
    expect(source).toContain('Project context');
    expect(source).toContain('Repository proof');
    expect(source).toContain('Repeated capability');
    expect(source).toContain(
      'Save short prompts, commands, and checklists that should stay fast and editable.',
    );
    expect(source).toContain(
      'Move patterns that depend on files, artifacts, MCP sources, or previous project chats.',
    );
    expect(source).toContain(
      'Route patterns that name diffs, tests, review rules, release checks, or implementation work.',
    );
    expect(source).toContain(
      'Promote workflows with trigger rules, tool usage, stable instructions, or repeatable agent behavior.',
    );
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('skills')");
  });

  it('keeps search, create, edit, update, and delete wiring intact', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("api('/dev/snippets')");
    expect(source).toContain('id="snippet-search"');
    expect(source).toContain('id="snippet-form-area"');
    expect(source).toContain('id="snippet-list"');
    expect(source).toContain('id="snippet-title"');
    expect(source).toContain('id="snippet-lang"');
    expect(source).toContain('id="snippet-tags"');
    expect(source).toContain('id="snippet-code"');
    expect(source).toContain('id="snippet-edit-title"');
    expect(source).toContain('id="snippet-edit-code"');
    expect(source).toContain('showNewSnippetForm');
    expect(source).toContain('saveNewSnippet');
    expect(source).toContain('viewSnippet');
    expect(source).toContain('updateSnippet');
    expect(source).toContain('deleteSnippet');
    expect(source).toContain('snippetsLoadError');
  });

  it('uses recovery-oriented snippet action errors', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const snippetBlock = source.slice(
      source.indexOf('function renderSnippetForm'),
      source.indexOf('window.copySnippetLibraryBrief'),
    );

    expect(snippetBlock).toContain('function snippetActionErrorMessage');
    expect(snippetBlock).toContain(
      'Snippet was not saved. Keep the text in the editor, check the title and snippet store, then retry before reusing this pattern.',
    );
    expect(snippetBlock).toContain(
      'Snippet could not be opened. Refresh the library or load a starter pattern while this saved snippet is unavailable.',
    );
    expect(snippetBlock).toContain(
      'Snippet was not updated. Keep the edited text visible, check the snippet store, and retry before relying on this pattern.',
    );
    expect(snippetBlock).toContain(
      'Snippet was not deleted. Check whether this pattern is still shared in Code, Cowork, or a recurring workflow before retrying.',
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('save', r), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('save', err), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('load', err), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('update', r), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('update', err), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('delete', r), 'error')",
    );
    expect(snippetBlock).toContain(
      "toast(snippetActionErrorMessage('delete', err), 'error')",
    );
    expect(snippetBlock).not.toContain("toast(r.error || 'Failed', 'error')");
    expect(snippetBlock).not.toContain(
      "toast('Failed to save snippet', 'error')",
    );
    expect(snippetBlock).not.toContain(
      "toast('Failed to load snippet', 'error')",
    );
    expect(snippetBlock).not.toContain(
      "toast('Failed to update snippet', 'error')",
    );
    expect(snippetBlock).not.toContain(
      "toast('Failed to delete snippet', 'error')",
    );
  });

  it('offers starter patterns for repeated productivity workflows', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('SNIPPET_STARTERS');
    expect(source).toContain('Starter patterns');
    expect(source).toContain('Review handoff checklist');
    expect(source).toContain('Release proof commands');
    expect(source).toContain('Cowork project summary');
    expect(source).toContain('MCP email brief prompt');
    expect(source).toContain('MCP source-to-document brief');
    expect(source).toContain(
      'approved MCP tools and project files to gather source context',
    );
    expect(source).toContain(
      'draft a markdown document in the project workspace',
    );
    expect(source).toContain('ask before publishing externally');
    expect(source).toContain('truncate(starter.code, 160)');
    expect(source).toContain('applySnippetStarter');
    expect(source).toContain('renderSnippetForm(starter)');
    expect(source).toContain('Starter loaded. Adjust it');
    expect(source).toContain('area.scrollIntoView');
  });

  it('uses class-based snippet previews and editor fields', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const snippetBlock = source.slice(
      source.indexOf('function renderSnippetList'),
      source.indexOf('window.copySnippetLibraryBrief'),
    );

    expect(snippetBlock).toContain('snippet-code snippet-code-preview');
    expect(snippetBlock).toContain('search-input snippet-editor-field');
    expect(snippetBlock).not.toContain(
      'class="snippet-code" style="margin-top:8px"',
    );
    expect(snippetBlock).not.toContain(
      'class="search-input" style="max-width:100%"',
    );
    expect(style).toContain('.snippet-code-preview');
    expect(style).toContain('.snippet-editor-field');
  });

  it('uses actionable empty, search, and error states', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain(
      "renderSnippetList(filtered, { kind: q.trim() ? 'search' : 'empty', query: q })",
    );
    expect(source).toContain(
      "renderSnippetList(snippetsData, { kind: snippetsLoadError ? 'loadError' : 'empty' })",
    );
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain('Load starter');
    expect(source).toContain('Clear search');
    expect(source).not.toContain(
      '\'<div class="snippets-empty-state"><h3>Library empty</h3><p>No snippets found. Create one or load a starter pattern.</p></div>\'',
    );
    expect(style).toContain('.snippets-empty-state.is-error');
    expect(style).toContain('.snippet-empty-flow');
    expect(style).toContain('.snippets-empty-actions');
    expect(style).toContain('.snippet-empty-flow span');
    expect(style).toContain(
      '.snippets-empty-state {\n    grid-template-columns: 1fr;',
    );
  });

  it('styles the library cards and editor responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.snippets-command-center');
    expect(source).toContain('.snippets-stats');
    expect(source).toContain('.snippet-stat.is-warning');
    expect(source).toContain('.snippet-data-health');
    expect(source).toContain('.snippet-data-health.is-warning');
    expect(source).toContain('.snippet-data-health.is-ready');
    expect(source).toContain('.snippet-reuse-map');
    expect(source).toContain('.snippet-reuse-card');
    expect(source).toContain('.snippet-promotion-path');
    expect(source).toContain('.snippet-promotion-steps');
    expect(source).toContain('.snippet-promotion-step');
    expect(source).toContain('.snippet-decision-gate');
    expect(source).toContain('.snippet-decision-head');
    expect(source).toContain('.snippet-decision-actions');
    expect(source).toContain('.snippet-decision-grid');
    expect(source).toContain('.snippet-decision-card');
    expect(source).toContain('.snippet-library-card');
    expect(source).toContain('.snippet-starters-panel');
    expect(source).toContain('.snippet-starter-grid');
    expect(source).toContain('.snippet-starter-card:focus-visible');
    expect(source).toContain('.snippet-editor-panel');
    expect(source).toContain('.snippet-editor-textarea');
    expect(source).toContain('.snippet-empty-flow');
    expect(source).toContain('.snippets-empty-actions');
    expect(source).toContain('.snippet-starter-grid,');
    expect(source).toContain('.snippet-reuse-map,');
    expect(source).toContain('.snippet-promotion-steps,');
    expect(source).toContain('.snippet-decision-grid,');
    expect(source).toContain('.snippet-starters-head,');
    expect(source).toContain('.snippets-stats,');
  });

  it('serves mock snippets with code bodies for card previews', () => {
    const source = fs.readFileSync(mockPath, 'utf8');

    expect(source).toContain("pathname === '/dev/snippets'");
    expect(source).toContain('Provider preflight checklist');
    expect(source).toContain('Check credentials');
    expect(source).toContain('systemctl --user restart nanocrab');
  });
});
