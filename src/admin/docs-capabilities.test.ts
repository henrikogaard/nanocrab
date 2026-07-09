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
    expect(source).toContain('Last updated: 2026-07-09');
    expect(source).toContain(
      '| Capability | UI route | Backend/API | Command or MCP path | Status |',
    );
    expect(source).toContain('Copilot chat');
    expect(source).toContain('Cowork projects');
    expect(source).toContain('Git & Code workspace');
    expect(source).toContain('GitHub Autofix');
    expect(source).toContain('Provider profiles');
    expect(source).toContain('Memory, Journal, and Skills');
    expect(source).toContain('Reports, Research, and Artifacts');
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
  });

  it('updates user-facing docs to the current Chat/Cowork/Code model', () => {
    const userGuide = fs.readFileSync(userGuidePath, 'utf8');
    const readme = fs.readFileSync(readmePath, 'utf8');

    expect(userGuide).toContain('Copilot / Cowork / Code / More');
    expect(userGuide).toContain('Capability overview');
    expect(userGuide).toContain('See [CAPABILITIES.md](CAPABILITIES.md)');
    expect(userGuide).toContain('ChatGPT-style plain conversations');
    expect(userGuide).toContain(
      'durable project, document, MCP, and artifact work',
    );
    expect(userGuide).toContain(
      'repository automation, tests, PRs, snippets, and coding-agent handoffs',
    );
    expect(readme).toContain(
      'For a current route-by-route capability matrix, see [docs/CAPABILITIES.md](docs/CAPABILITIES.md).',
    );
  });
});
