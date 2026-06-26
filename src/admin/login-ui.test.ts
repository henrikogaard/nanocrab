import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Login workspace entry UI', () => {
  it('frames login as the entry to the workspace split', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function showLogin');
    expect(source).toContain('Personal AI workspace');
    expect(source).toContain(
      'Pick up chats, projects, code work, and operations from one local dashboard.',
    );
    expect(source).toContain('login-product-brief');
    expect(source).toContain('login-lane-grid');
    expect(source).toContain('login-entry-checklist');
    expect(source).toContain('login-resume-strip');
    expect(source).toContain('Before sign-in');
    expect(source).toContain('After sign-in');
    expect(source).toContain('Copilot');
    expect(source).toContain('Cowork');
    expect(source).toContain('Code');
    expect(source).toContain('Use Copilot for quick questions after login.');
    expect(source).toContain(
      'Use Cowork when files, MCP tools, or documents need project context.',
    );
    expect(source).toContain(
      'Use Code when repository agents, tests, or GitHub Copilot should own the work.',
    );
    expect(source).toContain('Dashboard');
    expect(source).toContain('Daily brief and next action');
    expect(source).toContain('Approvals');
    expect(source).toContain('External writes waiting');
    expect(source).toContain('Projects');
    expect(source).toContain('Cowork artifacts and MCP context');
    expect(source).toContain('Repository agents and checks');
  });

  it('keeps authentication and 2FA behavior wired without inline input styles', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain("await api('/login'");
    expect(source).toContain('res.requires2fa');
    expect(source).toContain('login-totp-group');
    expect(source).toContain('login-totp-input');
    expect(source).toContain('login-error-info');
    expect(source).toContain('login-submit');
    expect(source).toContain(
      "err.className = 'login-error login-error-info is-visible'",
    );
    expect(source).toContain("err.className = 'login-error is-visible'");
    expect(source).not.toContain('style="width:100%"');
    expect(source).not.toContain(
      'style="margin-top:8px;text-align:center;font-size:18px;letter-spacing:6px"',
    );
    expect(source).not.toContain("err.style.display = 'block'");
  });

  it('styles the login brief, lane chips, submit button, and 2FA state', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.login-product-brief');
    expect(source).toContain('.login-lane-grid');
    expect(source).toContain('.login-lane-grid span');
    expect(source).toContain('.login-entry-checklist');
    expect(source).toContain('.login-entry-checklist li::before');
    expect(source).toContain('.login-resume-strip');
    expect(source).toContain('.login-resume-strip > span');
    expect(source).toContain('.login-resume-strip div');
    expect(source).toContain('.login-resume-strip strong,');
    expect(source).toContain('.login-error.is-visible');
    expect(source).toContain('.login-error-info');
    expect(source).toContain('.login-submit');
    expect(source).toContain('.login-totp-group');
    expect(source).toContain('.login-card .login-totp-input');
  });
});
