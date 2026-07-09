import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const helpPath = path.join(process.cwd(), 'src/admin/public/pages/help.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Help productivity manual UI', () => {
  it('frames help around the workspace split and productivity paths', () => {
    const source = fs.readFileSync(helpPath, 'utf8');

    expect(source).toContain('Productivity manual');
    expect(source).toContain('Current capability map');
    expect(source).toContain('Every supported capability has a UI route, a documented command/MCP path, or both.');
    expect(source).toContain("navigate('help')");
    expect(source).toContain('Open capability docs');
    expect(source).toContain('Capability map');
    expect(source).toContain('UI route');
    expect(source).toContain('Command or MCP path');
    expect(source).toContain('Chat threads');
    expect(source).toContain('Cowork projects');
    expect(source).toContain('Provider profiles');
    expect(source).toContain('Governed memory');
    expect(source).toContain('Skill registry');
    expect(source).toContain('Route hygiene');
    expect(source).toContain('Copilot');
    expect(source).toContain('Cowork');
    expect(source).toContain('Code');
    expect(source).toContain('Start a pure conversation');
    expect(source).toContain('Create a project workspace');
    expect(source).toContain('Use MCP tools in project chat');
    expect(source).toContain('Automate repository work');
    expect(source).toContain('Open Copilot');
    expect(source).toContain('Open Projects');
    expect(source).toContain('Use Project Chat');
    expect(source).toContain('actionLadder');
    expect(source).toContain('help-action-ladder');
    expect(source).toContain('Turn the manual into the next useful move');
    expect(source).toContain(
      'Use this when you know what you need, but not which part of NanoCrab should own it',
    );
    expect(source).toContain('stuckStateRoutes');
    expect(source).toContain('help-stuck-router');
    expect(source).toContain('Stuck state router');
    expect(source).toContain(
      'When the next step is unclear, recover the work instead of restarting it.',
    );
    expect(source).toContain('helpProductivityBriefText');
    expect(source).toContain('NanoCrab productivity routing brief');
    expect(source).toContain('Copy routing brief');
    expect(source).toContain('copyHelpProductivityBrief');
    expect(source).toContain('Help routing brief copied');
    expect(source).toContain('workspacePromptDeck');
    expect(source).toContain('Starter prompt deck');
    expect(source).toContain('Copy the first useful ask');
    expect(source).toContain('copyHelpWorkspacePrompt');
    expect(source).toContain('workspace prompt copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("window.prompt('Copy Help routing brief:'");
  });

  it('adds an intent-based decision guide that routes to the right workspace', () => {
    const source = fs.readFileSync(helpPath, 'utf8');

    expect(source).toContain('Action ladder');
    expect(source).toContain('Ask in Copilot when nothing needs to persist');
    expect(source).toContain(
      'Use a plain provider-backed conversation for quick clarification, drafting, or thinking',
    );
    expect(source).toContain('Move durable work into Cowork');
    expect(source).toContain(
      'Create or open a project when the output should become a file, document, artifact, or remembered thread',
    );
    expect(source).toContain('Route repository tasks to Code');
    expect(source).toContain(
      'Use Code when the next step needs a repo, issue, branch, diff, tests, or GitHub Copilot',
    );
    expect(source).toContain('Check setup before external tools write');
    expect(source).toContain(
      'Use Integrations, Credentials, Providers, and Approvals before MCP tools publish, send, update, or change records',
    );
    expect(source).toContain('Decision guide');
    expect(source).toContain('Pick the smallest workspace that fits the job');
    expect(source).toContain('Answer this as a plain Copilot chat.');
    expect(source).toContain(
      'In this Cowork project, turn the request into a durable project artifact.',
    );
    expect(source).toContain('Route this to Code.');
    expect(source).toContain(
      'Before delegating this work, check provider, credential, MCP, approval, memory, and skill readiness.',
    );
    expect(source).toContain('Open Cowork</button>');
    expect(source).toContain("routeLabel: 'Open Code'");
    expect(source).toContain("routeLabel: 'Check setup'");
    expect(source).toContain('Agent output stalled');
    expect(source).toContain('External tool failed');
    expect(source).toContain('Need proof before acting');
    expect(source).toContain('Useful result should persist');
    expect(source).toContain(
      'Use Sessions to find the latest transcript, approvals, artifacts, and handoff score before starting over.',
    );
    expect(source).toContain(
      'Check Logs for MCP, email, document, webhook, or provider errors before retrying the request.',
    );
    expect(source).toContain(
      'Open Approvals when an external send, document publish, calendar update, webhook, or repository write needs a human decision.',
    );
    expect(source).toContain(
      'Send finished documents, summaries, and reviewed outputs to Artifacts so future agents can reuse the evidence.',
    );
    expect(source).toContain("navigate('sessions')");
    expect(source).toContain("navigate('logs')");
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('artifacts')");
    expect(source).toContain('Stuck state router');
    expect(source).toContain('open ${item.route}');
    expect(source).toContain('I need a quick answer');
    expect(source).toContain(
      'Copilot: simple ChatGPT-style conversation with provider and optional title.',
    );
    expect(source).toContain('Copilot chat');
    expect(source).toContain(
      'Talk with the assistant directly from the dashboard when the request does not need project files, MCP tools, or repository context.',
    );
    expect(source).toContain('I need a document from external context');
    expect(source).toContain('I need repository automation');
    expect(source).toContain('I need platform setup');
    expect(source).toContain("navigate('chat')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain("navigate('agents')");
    expect(source).toContain("navigate('settings')");
  });

  it('documents Cowork projects and MCP-backed chat workflows', () => {
    const source = fs.readFileSync(helpPath, 'utf8');

    expect(source).toContain('Cowork projects');
    expect(source).toContain('Project chats');
    expect(source).toContain('Artifacts and documents');
    expect(source).toContain('MCP tools from Cowork');
    expect(source).toContain('summarize the latest emails');
    expect(source).toContain('Cowork MCP runbook');
    expect(source).toContain('Turn external context into project artifacts');
    expect(source).toContain('Choose a tool-capable provider');
    expect(source).toContain(
      'MCP work needs a provider that supports tool calls',
    );
    expect(source).toContain('Approve external writes');
    expect(source).toContain('mcpPromptRecipes');
    expect(source).toContain('Copy-ready prompts');
    expect(source).toContain('Latest email digest');
    expect(source).toContain('review the latest emails');
    expect(source).toContain('Sender brief');
    expect(source).toContain('recent emails from [person or domain]');
    expect(source).toContain('Source-backed document');
    expect(source).toContain('approved document MCP tools');
    expect(source).toContain('help-mcp-recipe-grid');
    expect(source).toContain('help-mcp-recipe-actions');
    expect(source).toContain('copyHelpMcpPromptRecipe');
    expect(source).toContain('Copy prompt');
    expect(source).toContain('Use in Cowork');
    expect(source).toContain('`${recipe.label} prompt copied`');
    expect(source).toContain('`Copy ${recipe.label} prompt`');
    expect(source).toContain('helpMcpRunbookText');
    expect(source).toContain('Copy runbook');
    expect(source).toContain('copyHelpMcpRunbook');
    expect(source).toContain('Help MCP runbook copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain("window.prompt('Copy Help MCP runbook:'");
    expect(source).toContain('save a draft artifact in the project workspace');
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain('Personal memory');
    expect(source).toContain('GitHub Copilot belongs with Code work');
  });

  it('keeps search and table-of-contents hooks wired', () => {
    const source = fs.readFileSync(helpPath, 'utf8');

    expect(source).toContain('id="help-search"');
    expect(source).toContain('id="help-sections"');
    expect(source).toContain('id="help-toc"');
    expect(source).toContain('buildSectionsHtml');
    expect(source).toContain('renderHelpSearchEmptyState');
    expect(source).toContain('Search fallback');
    expect(source).toContain('No manual topics matched');
    expect(source).toContain(
      'Try a workspace route or use one of the starter searches below',
    );
    expect(source).toContain(
      'Memory is personal context learned across agents',
    );
    expect(source).toContain('help-empty-route-grid');
    expect(source).toContain('help-empty-route-card');
    expect(source).toContain('Plain conversation');
    expect(source).toContain('Project and MCP work');
    expect(source).toContain('Repos and GitHub Copilot');
    expect(source).toContain('Personal knowledge');
    expect(source).toContain('MCP setup');
    expect(source).toContain("navigate('memory')");
    expect(source).toContain("navigate('integrations')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain('MCP tools');
    expect(source).toContain('Cowork projects');
    expect(source).toContain('email summary');
    expect(source).toContain('GitHub Copilot');
    expect(source).not.toContain(
      '<div class="help-empty-state">No results matching your search. Try "MCP", "project", "email", "memory", or "Copilot".</div>',
    );
    expect(source).toContain("label: 'Copilot'");
    expect(source).toContain(
      'Copilot is for plain conversation, Cowork is for project files and MCP context, Code is for repository work, and Memory is personal context learned across agents.',
    );
    expect(source).toContain('scrollIntoView');
    expect(source).toContain('help-toc');
    expect(source).toContain("toc.classList.add('visible')");
  });

  it('styles the help command center, paths, cards, and responsive layout', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.help-command-center');
    expect(source).toContain('.help-command-actions');
    expect(source).toContain('.help-path-grid');
    expect(source).toContain('.help-action-ladder');
    expect(source).toContain('.help-action-head');
    expect(source).toContain('.help-action-grid');
    expect(source).toContain('.help-action-card');
    expect(source).toContain('.help-capability-map');
    expect(source).toContain('.help-capability-head');
    expect(source).toContain('.help-capability-grid');
    expect(source).toContain('.help-capability-card');
    expect(source).toContain('.help-decision-strip');
    expect(source).toContain('.help-decision-grid');
    expect(source).toContain('.help-decision-card');
    expect(source).toContain('.help-workspace-prompts');
    expect(source).toContain('.help-workspace-prompt-head');
    expect(source).toContain('.help-workspace-prompt-grid');
    expect(source).toContain('.help-workspace-prompt');
    expect(source).toContain('.help-workspace-prompt-actions');
    expect(source).toContain('.help-workspace-prompt-actions .btn');
    expect(source).toContain('.help-stuck-router');
    expect(source).toContain('.help-stuck-head');
    expect(source).toContain('.help-stuck-grid');
    expect(source).toContain('.help-stuck-card');
    expect(source).toContain('.help-stuck-card:hover');
    expect(source).toContain('.help-mcp-runbook');
    expect(source).toContain('.help-mcp-runbook-head > div');
    expect(source).toContain('.help-mcp-step-grid');
    expect(source).toContain('.help-mcp-step');
    expect(source).toContain('.help-mcp-recipe-grid');
    expect(source).toContain('.help-mcp-recipe');
    expect(source).toContain('.help-mcp-recipe span');
    expect(source).toContain('.help-mcp-recipe-actions');
    expect(source).toContain('.help-mcp-recipe-actions .btn');
    expect(source).toContain('.help-search-panel');
    expect(source).toContain('.help-section-card');
    expect(source).toContain('.help-topic-card');
    expect(source).toContain('.help-empty-routes');
    expect(source).toContain('.help-empty-route-grid');
    expect(source).toContain('.help-empty-route-card');
    expect(source).toContain('.help-empty-route-card:hover');
    expect(source).toContain('.help-empty-route-card:focus-visible');
    expect(source).toContain('.help-empty-route-card:active');
    expect(source).toContain('.help-empty-searches');
    expect(source).toContain('.help-empty-searches button:focus-visible');
    expect(source).toContain('.help-toc.visible');
    expect(source).toContain(
      '.help-path-grid,\n  .help-action-grid,\n  .help-capability-grid,\n  .help-decision-grid,\n  .help-workspace-prompt-grid,\n  .help-empty-route-grid,\n  .help-stuck-grid,\n  .help-mcp-step-grid,\n  .help-mcp-recipe-grid,\n  .help-layout',
    );
    expect(source).toContain('.help-capability-grid,');
    expect(source).toContain('.help-workspace-prompt-grid,');
    expect(source).toContain('.help-empty-route-grid,');
    expect(source).toContain('.help-stuck-grid,');
  });
});
