import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const pagePath = path.join(process.cwd(), 'src/admin/public/pages/projects.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');
const shellNavigationUiPath = path.join(
  process.cwd(),
  'src/admin/public/ui/shell-navigation.js',
);

describe('Cowork Projects UI wiring', () => {
  it('registers the Projects page in the dashboard shell', () => {
    const source = fs.readFileSync(appPath, 'utf8');
    const shellNavigationSource = fs.readFileSync(
      shellNavigationUiPath,
      'utf8',
    );

    expect(shellNavigationSource).toContain(
      "projects: { label: 'Cowork Projects'",
    );
    expect(source).toContain("projects: 'renderProjects'");
    expect(source).toContain("'project-chat': 'renderProjectChatPage'");
    expect(source).toContain('parseProjectChatHash');
    expect(source).toContain('parseProjectFileHash');
    expect(source).toContain('window._pendingProjectFileRoute');
    expect(source).toContain("showShell('project-chat')");
    expect(source).toContain("showShell('projects')");
    expect(source).toContain('Preparing Cowork chat');
    expect(source).toContain(
      'Loading project context, previous thread history, and approved MCP access',
    );
    expect(source).toContain('Preparing conversation');
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading project chat...</div>\'',
    );
    expect(source).not.toContain(
      'el.innerHTML = \'<div class="loading">Loading conversation…</div>\'',
    );
  });

  it('renders project workspaces with files and thread history', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain("api('/projects')");
    expect(source).toContain("api('/projects/' + encodeURIComponent");
    expect(source).toContain('/threads');
    expect(source).toContain('Project files');
    expect(source).toContain('Chat history');
    expect(source).toContain('project-file-preview');
    expect(source).toContain('renderProjectFilePreviewState');
    expect(source).toContain('project-file-preview-state');
    expect(source).toContain('Project file preview');
    expect(source).toContain('Preview source material, drafts, and artifacts.');
    expect(source).toContain('Use in prompt');
    expect(source).toContain('Continue in chat');
    expect(source).toContain('Use folder in prompt');
    expect(source).toContain('Create artifact');
    expect(source).toContain('Source -> document');
    expect(source).toContain('Reference path');
    expect(source).toContain('Save output');
    expect(source).toContain('Refresh project');
    expect(source).not.toContain(
      '<div class="project-file-preview-empty">Select a project file to inspect the document or artifact before asking an agent to work with it.</div>',
    );
    expect(source).not.toContain(
      '<div class="project-file-preview-empty">Preview is not available for this file type yet. The file remains available to project chats.</div>',
    );
    expect(source).toContain('project-panel-empty project-files-empty');
    expect(source).toContain('Add the material this project should use.');
    expect(source).toContain(
      'Notes, briefs, drafts, and artifacts stay with the project.',
    );
    expect(source).toContain('project-panel-empty project-threads-empty');
    expect(source).toContain('Start the first project chat.');
    expect(source).toContain(
      'Threads stay attached to the files and context here.',
    );
    expect(source).toContain('applyProjectMcpRecipe(2)');
    expect(source).toContain('applyProjectMcpRecipe(0)');
    expect(source).not.toContain(
      '<div class="empty project-empty">No project files yet.</div>',
    );
    expect(source).not.toContain(
      '<div class="empty project-empty">No project chats yet. Use a quick start above to create the first working thread.</div>',
    );
    expect(source).toContain('window.previewProjectFile');
    expect(source).toContain('window.previewProjectFolder');
    expect(source).toContain('projectFileHash');
    expect(source).toContain('project-file-tree');
    expect(source).toContain('project-folder-row');
    expect(source).toContain("isFile && file.kind === 'folder'");
    expect(source).toContain('continueProjectPathInChat');
    expect(source).toContain('consumeProjectFileRoute');
    expect(source).toContain('project-file-route-active');
    expect(source).toContain('/files/read?path=');
    expect(source).toContain('projectFileDownloadHref');
    expect(source).toContain('/files/download?path=');
    expect(source).toContain('project-file-download');
    expect(source).toContain('download="');
    expect(source).toContain('>Download</a>');
    expect(source).toContain('Use in prompt');
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain('window.saveProjectSettings');
    expect(source).toContain('window.toggleProjectSettings');
    expect(source).toContain('toggleProjectPanel');
    expect(source).toContain('project-settings-form is-hidden');
    expect(source).toContain('project-file-form is-hidden');
    expect(source).toContain('project-create is-hidden');
    expect(source).toContain("panel.classList.toggle('is-hidden'");
    expect(source).toContain('project-settings-description');
    expect(source).toContain('project-settings-instructions');
    expect(source).toContain('Settings');
    expect(source).toContain('Save context');
    expect(source).toContain('renderProjectDesignSystems');
    expect(source).toContain('project-design-system-upload');
    expect(source).toContain('project-design-system-default');
    expect(source).toContain('uploadProjectDesignSystem');
    expect(source).toContain('saveProjectDesignSystemDefault');
    expect(source).toContain('Use project default design system');
    expect(source).toContain('Design systems');
    expect(source).toContain('projectHandoffBriefText');
    expect(source).toContain('Cowork project handoff');
    expect(source).toContain('MCP status: ');
    expect(source).toContain('Provider data health: ');
    expect(source).toContain('Provider catalog loaded without known fallback.');
    expect(source).toContain(
      'Provider catalog unavailable. Project chats can still use the backend default',
    );
    expect(source).toContain('external tools available');
    expect(source).toContain('MCP tools');
    expect(source).toContain(
      'No external MCP servers connected yet. Use project files and local drafts',
    );
    expect(source).toContain('MCP-ready requests');
    expect(source).toContain(
      'Latest emails -> source-backed project summary document',
    );
    expect(source).toContain(
      'Emails from a person or domain -> brief with follow-ups and open questions',
    );
    expect(source).toContain(
      'Project files plus document tools -> markdown draft saved in the workspace first',
    );
    expect(source).toContain('PROJECT_TEMPLATES');
    expect(source).toContain('renderProjectLoadingState');
    expect(source).toContain('cowork-kicker');
    expect(source).toContain('Loading project workspaces');
    expect(source).toContain(
      'virtual folders, source files, project chats, artifacts, and approved MCP context',
    );
    expect(source).toContain('renderProjectEmptyWorkbench');
    expect(source).toContain('projects-empty-list');
    expect(source).toContain('Cowork queue');
    expect(source).toContain('Pick a starter or create a virtual folder');
    expect(source).toContain('toggleProjectCreate(true)');
    expect(source).not.toContain(
      '<div class="projects-empty-list">No projects yet. Pick a starter or create one from scratch.</div>',
    );
    expect(source).toContain('project-empty-workbench');
    expect(source).toContain('Create a project workspace.');
    expect(source).toContain(
      'Keep files, chats, drafts, and artifacts together.',
    );
    expect(source).toContain('Inbox digest');
    expect(source).toContain('Document workspace');
    expect(source).toContain('Launch plan');
    expect(source).toContain('applyProjectTemplate');
    expect(source).toContain("toggleProjectCreate(true, 'project-name')");
    expect(source).toContain('name.value = template.name');
    expect(source).toContain('description.value = template.description');
    expect(source).toContain('instructions.value = template.instructions');
    expect(source).toContain('renderProjectMcpAccess');
    expect(source).toContain('Tools');
    expect(source).toContain('Available in project chat.');
    expect(source).toContain(
      'Connect mail, calendar, docs, storage, or a custom server.',
    );
    expect(source).not.toContain('Local only');
    expect(source).toContain('External writes require approval.');
    expect(source).toContain('Copy handoff');
    expect(source).not.toContain('Copy handoff brief</button>');
    expect(source).toContain('window.copyProjectHandoffBrief');
    expect(source).toContain('Project handoff copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).toContain('window.copyProjectFilePreview');
    expect(source).toContain('Copy project file preview');
    expect(source).not.toContain('navigator.clipboard.writeText(content)');
    expect(source).not.toContain('Could not copy file preview: ');
    expect(source).not.toContain("window.prompt('Copy project handoff:'");
    expect(source).toContain('activeProjectDetail = detail');
    expect(source).toContain("api('/system/provider')");
    expect(source).toContain('loadProjectProviderState');
    expect(source).toContain('id="project-chat-provider"');
    expect(source).toContain('id="project-chat-model"');
    expect(source).toContain('id="project-chat-title"');
    expect(source).toContain('renderProjectChatComposer');
    expect(source).toContain('Export citation ledger');
    expect(source).toContain('window.exportProjectRunCitationLedger');
    expect(source).toContain('/research/export-ledger');
    expect(source).toContain('project-chat-entry');
    expect(source).toContain('Ask in this project');
    expect(source).toContain(
      'Files, history, and approved tools are attached.',
    );
    expect(source).toContain(
      'Summarize files, draft a document, check emails from a sender, or plan the next step.',
    );
    expect(source).toContain('updateProjectChatModels');
    expect(source).not.toContain(
      'id="project-settings-form" style="display:none"',
    );
    expect(source).not.toContain('id="project-file-form" style="display:none"');
    expect(source).not.toContain('id="project-create" style="display:none"');
    expect(source).not.toContain('<div class="loading">Loading projects</div>');
    expect(source).not.toContain('form.style.display');
  });

  it('renders Cowork runs, context notebook, capabilities, and complexity states', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('renderProjectRuns');
    expect(source).toContain('renderProjectRunDetail');
    expect(source).toContain('renderProjectContextNotebook');
    expect(source).toContain('renderProjectCapabilities');
    expect(source).toContain('renderProjectComplexity');
    expect(source).toContain('project-run-list');
    expect(source).toContain('project-run-detail');
    expect(source).toContain('selectProjectRun');
    expect(source).toContain('retryProjectRun');
    expect(source).toContain('cancelProjectRun');
    expect(source).toContain('copyProjectRunHandoff');
    expect(source).toContain('Copy run handoff');
    expect(source).toContain('Approval checkpoints');
    expect(source).toContain('Run events');
    expect(source).toContain('Generated output');
    expect(source).toContain('project-context-notebook');
    expect(source).toContain('project-capability-panel');
    expect(source).toContain('project-complexity-panel');
    expect(source).toContain('Runs');
    expect(source).toContain('Context notebook');
    expect(source).toContain('Capabilities');
    expect(source).toContain('Complexity');
    expect(source).toContain('Approval risk');
    expect(source).toContain('Sensitivity');
    expect(source).toContain('Provenance');
    expect(source).toContain('projectContextFreshness');
    expect(source).toContain('toggleProjectContextIncluded');
    expect(source).toContain('toggleProjectContextPinned');
    expect(source).toContain('removeProjectContextItem');
    expect(source).toContain('Include in prompt');
    expect(source).toContain('Exclude from prompt');
    expect(source).toContain('Remove from notebook');
    expect(source).toContain('Download source');
    expect(source).toContain('Updated ');
    expect(source).toContain('approval-blocked');
    expect(source).toContain('External writes require approval');
    expect(source).toContain('No Cowork runs yet');
    expect(source).toContain('No context notebook items yet');
  });

  it('validates context source URLs and selects exported citation ledgers', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('safeProjectContextUrl');
    expect(source).toContain('var sourceUrl = safeProjectContextUrl(item.url)');
    expect(source).toContain('result.file && result.file.path');
    expect(source).not.toContain('if (result.path)');
  });

  it('offers productivity quick starts for project chats', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('Email summary');
    expect(source).toContain('Project brief');
    expect(source).toContain('MCP tools');
    expect(source).toContain('Connectors');
    expect(source).toContain('PROJECT_TOOL_LANES');
    expect(source).toContain('MCP workflow');
    expect(source).toContain('Use any approved connector');
    expect(source).toContain('PROJECT_MCP_RECIPES');
    expect(source).not.toContain('PROJECT_MCP_SOURCE_STEPS');
    expect(source).not.toContain('MCP source-to-document checklist');
    expect(source).toContain('Source tools');
    expect(source).toContain('renderProjectSourcePack');
    expect(source).not.toContain('<span>Source pack</span>');
    expect(source).toContain('Shape a source request');
    expect(source).toContain(
      'Useful for email summaries, sender checks, briefs, and document drafts',
    );
    expect(source).toContain('MCP server or source');
    expect(source).toContain('Sender, topic, or filter');
    expect(source).toContain('Date window');
    expect(source).toContain('Artifact to create');
    expect(source).toContain('Use source');
    expect(source).toContain('Copy source pack prompt');
    expect(source).toContain('clearProjectSourcePack');
    expect(source).toContain('projectSourcePackPromptText');
    expect(source).toContain('Source pack prompt copied');
    expect(source).toContain('the configured MCP source');
    expect(source).toContain(
      'through the approved MCP tool boundary for this Cowork project',
    );
    expect(source).toContain('Source scope:');
    expect(source).toContain('Project context:');
    expect(source).toContain('Available MCP scope:');
    expect(source).toContain('Project workspace:');
    expect(source).toContain('Output artifact:');
    expect(source).toContain('Save a ');
    expect(source).toContain(
      'Include a source ledger naming the MCP server, tool-call purpose, sender/topic filter, date window, and local artifact path.',
    );
    expect(source).toContain(
      'If the requested MCP server or tool is not exposed, say which connector or permission is missing instead of inventing source results.',
    );
    expect(source).toContain(
      'inside the project workspace before creating or updating anything outside NanoCrab',
    );
    expect(source).toContain(
      'Ask for approval before sending email, publishing documents, changing calendar events, updating third-party records, or calling write-capable MCP tools.',
    );
    expect(source).toContain('Latest emails -> summary');
    expect(source).toContain('Emails from X -> brief');
    expect(source).toContain('Source context -> document');
    expect(source).toContain('Summarize source context');
    expect(source).toContain('External writes require approval');
    expect(source).toContain('Draft locally first');
    expect(source).toContain('window.applyProjectMcpRecipe');
    expect(source).toContain("navigate(\\'mcp\\')");
    expect(source).toContain('Approvals');
    expect(source).toContain('window.applyProjectPrompt');
    expect(source).toContain('window.applyProjectToolPrompt');
    expect(source).toContain('Quick starts');
    expect(source).not.toContain(
      '<div class="project-rail-title">Memory</div>',
    );
  });

  it('surfaces project readiness with a status brief and next action', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('renderProjectBrief');
    expect(source).toContain('project-status-brief');
    expect(source).toContain('Add project files');
    expect(source).toContain('Start a project chat');
    expect(source).toContain('Project context is ready');
    expect(source).toContain('Add project rules');
    expect(source).toContain('Start project chat');
    expect(source).not.toContain('Project readiness');
    expect(source).not.toContain('Source files');
    expect(source).not.toContain('Project thread');
    expect(source).toContain('projectProviderState?.loadIssue');
    expect(source).toContain('project-provider-health');
    expect(source).toContain('project-composer-health');
    expect(source).toContain('<small>threads</small>');
    expect(source).not.toContain('<small>mcp</small>');
    expect(source).toContain('Create Cowork project');
    expect(source).toContain(
      'Use a project when files, source systems, artifacts, and multiple chats should stay together.',
    );
    expect(source).toContain(
      'Tone, sources to trust, approval boundaries, and where drafts should be saved.',
    );
    expect(source).toContain('applyProjectInstructionPrompt');
    expect(source).toContain(
      'tone, source-of-truth files, approval boundaries',
    );
  });

  it('styles project file previews as a first-class work surface', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.project-status-brief');
    expect(source).not.toContain('.project-status-metrics');
    expect(source).not.toContain('.project-readiness-steps');
    expect(source).toContain('.project-provider-health');
    expect(source).toContain('.project-composer-health');
    expect(source).toContain('.project-status-brief.is-attention');
    expect(source).toContain('.project-loading-state');
    expect(source).toContain('.project-loading-state::after');
    expect(source).toContain('.project-loading-sidebar');
    expect(source).toContain('.project-loading-flow');
    expect(source).toContain('@keyframes projectLoadingSweep');
    expect(source).toContain('.project-file-preview');
    expect(source).toContain('.project-file-preview-content');
    expect(source).toContain('.project-file-preview-actions');
    expect(source).toContain('.project-file-tree');
    expect(source).toContain('.project-folder-row');
    expect(source).toContain('.project-file-route-active');
    expect(source).toContain('.project-file-open');
    expect(source).toContain('.project-file-download');
    expect(source).toContain('.project-file-download:focus-visible');
    expect(source).toContain('.project-chat-entry');
    expect(source).toContain('.project-file-preview-state');
    expect(source).toContain('.project-file-preview-flow');
    expect(source).toContain('.project-file-preview-state-actions');
    expect(source).toContain('.project-file-row.active');
    expect(source).toContain('.project-panel-empty');
    expect(source).toContain('.project-panel-empty-actions');
    expect(source).toContain('.project-panel-empty strong');
    expect(source).toContain('.project-tool-lanes');
    expect(source).toContain('.project-approval-card');
    expect(source).toContain('.project-mcp-recipes');
    expect(source).toContain('.project-source-pack');
    expect(source).toContain('.project-source-pack-head');
    expect(source).toContain('.project-source-pack-grid');
    expect(source).toContain('.project-source-pack-actions');
    expect(source).toContain('.project-mcp-access');
    expect(source).toContain('.project-mcp-server-list');
    expect(source).toContain('.project-mcp-recipe-grid');
    expect(source).not.toContain('.project-mcp-source-flow');
    expect(source).not.toContain('.project-mcp-source-step');
    expect(source).toContain('.project-mcp-recipe:focus-visible');
    expect(source).toContain('.project-empty-state');
    expect(source).toContain('.project-empty-actions');
    expect(source).toContain('.projects-empty-list');
    expect(source).toContain('.projects-empty-list .btn');
    expect(source).toContain('.project-template-grid');
    expect(source).toContain('.project-template-card');
    expect(source).toContain('.project-template-card:focus-visible');
    expect(source).toContain('.project-heading-actions');
    expect(source).toContain('.project-rail-card-primary .btn');
    expect(source).toContain('.project-settings-form');
    expect(source).toContain('.project-settings-form.is-hidden');
    expect(source).toContain('.project-create.is-hidden');
    expect(source).toContain('.project-create-head');
    expect(source).toContain('.project-create-shortcuts');
    expect(source).toContain('.project-file-form.is-hidden');
    expect(source).toContain('.project-settings-summary');
    expect(source).toContain('.project-settings-actions');
    expect(source).toContain('.project-composer-provider');
    expect(source).toContain('.project-composer-provider label');
    expect(source).not.toContain('.project-mcp-runway');
  });

  it('starts project chats with provider selection and a normal thread message', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('id="project-chat-start-btn"');
    expect(source).toContain('threadBody.provider = provider');
    expect(source).toContain('threadBody.model = model');
    expect(source).toContain('threadBody.title = title.trim()');
    expect(source).toContain('projectchat_last_provider');
    expect(source).toContain('projectchat_last_model_');
    expect(source).toContain('message: prompt');
    expect(source).toContain("'#/projects/'");
    expect(source).toContain("'/chat/'");
    expect(source).not.toContain('content: prompt');
    expect(source).not.toContain('projectTitleFromPrompt');
  });

  it('uses recovery-oriented project action errors', () => {
    const source = fs.readFileSync(pagePath, 'utf8');

    expect(source).toContain('function projectActionErrorMessage');
    expect(source).toContain(
      'Project was not created. Check the name, instructions, and whether the Cowork project store is writable.',
    );
    expect(source).toContain(
      'Project file was not created. Check the relative path, file name, and whether this workspace should hold the draft or artifact.',
    );
    expect(source).toContain(
      'Project context was not saved. Keep using the current instructions, then retry after checking the project store.',
    );
    expect(source).toContain(
      'Project handoff could not be loaded. Refresh the project before copying context into another chat or agent lane.',
    );
    expect(source).toContain(
      'Project chat was not started. Check provider/model readiness, project context, and whether MCP-backed source work should wait.',
    );
    expect(source).toContain(
      'Project chat was created, but the first message was not sent. Open the chat and resend the prompt before assuming the agent received it.',
    );
    expect(source).toContain(
      "toast(projectActionErrorMessage('create', err), 'error')",
    );
    expect(source).toContain(
      "toast(projectActionErrorMessage('file', err), 'error')",
    );
    expect(source).toContain(
      "var message = projectActionErrorMessage('context', err)",
    );
    expect(source).toContain(
      "toast(projectActionErrorMessage('handoff', err), 'error')",
    );
    expect(source).toContain(
      "toast(projectActionErrorMessage('firstMessage', promptError), 'error')",
    );
    expect(source).toContain(
      "toast(projectActionErrorMessage('chat', err), 'error')",
    );
    expect(source).not.toContain(
      "toast('Could not save project context: ' + err.message, 'error')",
    );
    expect(source).not.toContain(
      "toast('Could not load project handoff: ' + (err.message || 'unknown error'), 'error')",
    );
    expect(source).not.toContain(
      "toast('Could not start project chat: ' + err.message, 'error')",
    );
  });
});
