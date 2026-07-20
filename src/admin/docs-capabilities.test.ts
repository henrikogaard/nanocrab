import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const capabilitiesPath = path.join(process.cwd(), 'docs/CAPABILITIES.md');
const userGuidePath = path.join(process.cwd(), 'docs/USER_GUIDE.md');
const readmePath = path.join(process.cwd(), 'README.md');

describe('current capability documentation', () => {
  it('publishes a current capability matrix with UI and command wiring', () => {
    const source = fs.readFileSync(capabilitiesPath, 'utf8');

    expect(source).toContain('# NanoCrab Capabilities');
    expect(source).toContain('Last updated: 2026-07-20');
    expect(source).toMatch(
      /\|\s*Capability\s*\|\s*UI route\s*\|\s*Backend\/API\s*\|\s*Command or MCP path\s*\|\s*Status\s*\|/,
    );
    expect(source).toContain('Today overview');
    expect(source).toMatch(/\|\s*Chat\s*\|\s*`#\/chat`\s*\|/);
    expect(source).toContain('Cowork projects');
    expect(source).toContain('Git & Code workspace');
    expect(source).toContain('GitHub Autofix');
    expect(source).toContain('Provider profiles');
    expect(source).toContain('Memory, Journal, and Skills');
    expect(source).toContain('Reports, Research, and Artifacts');
    expect(source).toContain('Source Collections');
    expect(source).toContain('Tasks, Workflows, Missions, and Briefings');
    expect(source).toContain('Approvals, Audit, and Security');
    expect(source).toContain('Integrations, MCP, and Credentials');
    expect(source).toContain('Monitoring, Backup, and Usage');
    expect(source).toContain('Route hygiene');
    expect(source).toContain(
      'WhatsApp, Telegram, Signal, Slack, Discord, web threads',
    );
    expect(source).toContain('Slack Socket Mode');
    expect(source).toContain('Discord gateway');
    expect(source).toContain('Hermes alignment');
    expect(source).toContain('OpenClaw alignment');
    expect(source).toContain('Focus Stack Foundation');
    expect(source).toContain('top-level JSON array');
  });

  it('updates user-facing docs to the current Chat/Cowork/Code model', () => {
    const userGuide = fs.readFileSync(userGuidePath, 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');

    expect(userGuide).toContain('Chat / Cowork / Code / More');
    expect(userGuide).toContain('Capability overview');
    expect(userGuide).toContain('See [CAPABILITIES.md](CAPABILITIES.md)');
    expect(userGuide).toContain('Plain conversations with provider/model');
    expect(userGuide).toContain(
      'Durable project, document, MCP, and artifact work',
    );
    expect(userGuide).toContain(
      'Repository automation, tests, PRs, snippets, and coding-agent handoffs',
    );
    expect(readme).toContain(
      'For a current route-by-route capability matrix, see [docs/CAPABILITIES.md](docs/CAPABILITIES.md).',
    );
  });
});
