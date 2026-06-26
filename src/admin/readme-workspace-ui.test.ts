import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const readmePath = path.join(process.cwd(), 'README.md');

describe('README workspace model', () => {
  it('documents the current Copilot, Cowork, Code, and More dashboard surfaces', () => {
    const source = fs.readFileSync(readmePath, 'utf8');

    expect(source).toContain('**Copilot**, **Cowork**, and **Code**');
    expect(source).toContain('ChatGPT-style plain conversations');
    expect(source).toContain('there is no agent template or project workspace');
    expect(source).toContain(
      'generated title fallback after the first message',
    );
    expect(source).toContain('Cowork projects are virtual folders');
    expect(source).toContain('approved MCP server access');
    expect(source).toContain('GitHub Copilot');
    expect(source).toContain(
      'Memory and Skills are intentionally not buried in Cowork',
    );
    expect(source).toContain(
      'Dashboard, Channels, Messages, Deploy, Monitoring',
    );
    expect(source).toContain('Copilot / Cowork / Code / More');
    expect(source).not.toContain('Chat / Work / Code / More');
    expect(source).not.toContain('per-thread agent template');
  });
});
