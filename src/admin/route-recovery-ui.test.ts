import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Route recovery UI', () => {
  it('renders page errors as a workspace recovery surface', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderPageError');
    expect(source).toContain('function routeRecoveryBriefText');
    expect(source).toContain('function renderRouteRecoveryActions');
    expect(source).toContain('window._routeRecoveryState');
    expect(source).toContain('route-recovery-card is-error');
    expect(source).toContain('route-recovery-retry');
    expect(source).toContain('Page recovery');
    expect(source).toContain('Try again or move to another workspace lane');
    expect(source).toContain('Copy recovery brief');
    expect(source).toContain('window.copyRouteRecoveryBrief');
    expect(source).toContain('NanoCrab route recovery brief');
    expect(source).toContain('Request path:');
    expect(source).toContain('HTTP status:');
    expect(source).toContain('Recovery routes:');
    expect(source).toContain(
      'Keep any external MCP/document/email/calendar writes approval-gated while recovering.',
    );
    expect(source).toContain("navigate('chat')");
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('gitcode')");
    expect(source).toContain("navigate('help')");
    expect(source).not.toContain(
      'style="margin-top:8px;color:var(--text-muted)"',
    );
  });

  it('uses a custom not-found route instead of a plain dead-end card', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function renderNotFoundPage');
    expect(source).toContain('Route not found');
    expect(source).toContain('This workspace route is not available');
    expect(source).toContain('Copilot for plain chat');
    expect(source).toContain('Cowork for projects and agents');
    expect(source).toContain('Code for repositories');
    expect(source).toContain('else renderNotFoundPage(el, page);');
    expect(source).not.toContain(
      'else el.innerHTML = \'<div class="card empty">Page not found</div>\'',
    );
  });

  it('routes tab-level destinations to their consolidated parent and activates the tab', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('const PAGE_TAB_ALIASES = {');
    expect(source).toContain(
      "terminal: { page: 'devhub', container: 'dev-tabs', tab: 'terminal' }",
    );
    expect(source).toContain(
      "mounts: { page: 'devhub', container: 'dev-tabs', tab: 'mounts' }",
    );
    expect(source).toContain(
      "files: { page: 'devhub', container: 'dev-tabs', tab: 'files' }",
    );
    expect(source).toContain(
      "providers: { page: 'integrations', container: 'int-tabs', tab: 'providers' }",
    );
    expect(source).toContain(
      "mcp: { page: 'integrations', container: 'int-tabs', tab: 'mcp' }",
    );
    expect(source).toContain(
      "logs: { page: 'monitoring', container: 'mon-tabs', tab: 'logs' }",
    );
    expect(source).toContain(
      "system: { page: 'monitoring', container: 'mon-tabs', tab: 'system' }",
    );
    expect(source).toContain(
      "wiki: { page: 'memory', container: 'mem-tabs', tab: 'wiki' }",
    );
    expect(source).toContain(
      "snippets: { page: 'gitcode', container: 'gc-tabs', tab: 'snippets' }",
    );
    expect(source).toContain(
      "'custom-containers': { page: 'containers', container: 'ct-tabs', tab: 'custom' }",
    );
    expect(source).toContain('let pendingPageTabAlias = null');
    expect(source).toContain('function tabAliasForPage(page)');
    expect(source).toContain('function activatePageTabAlias(alias)');
    expect(source).toContain('window.switchTab?.(alias.container, alias.tab)');
    expect(source).toContain(
      'window._tabLoaderRegistry?.[alias.container]?.(alias.tab)',
    );
    expect(source).toContain(
      'pendingPageTabAlias = tabAliasForPage(requestedPage)',
    );
    expect(source).toContain(
      "const newHash = '#/' + (pendingPageTabAlias ? requestedPage : page)",
    );
    expect(source).toContain('const routeTabAlias =');
    expect(source).toContain('activatePageTabAlias(routeTabAlias)');
    expect(source).toContain('renderRoute(el, renderFn, afterRouteRender)');
  });

  it('styles the recovery card and actions globally', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.route-recovery-card');
    expect(source).toContain('.route-recovery-card.is-error');
    expect(source).toContain('.route-recovery-card.is-missing');
    expect(source).toContain('.route-recovery-kicker');
    expect(source).toContain('.route-recovery-retry');
    expect(source).toContain('.route-recovery-facts');
    expect(source).toContain('.route-recovery-actions');
  });
});
