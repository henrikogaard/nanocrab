import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const appPath = path.join(process.cwd(), 'src/admin/public/app.js');
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Login workspace entry UI', () => {
  it('keeps login focused on authentication instead of product promotion', () => {
    const source = fs.readFileSync(appPath, 'utf8');

    expect(source).toContain('function showLogin');
    expect(source).toContain('login-brand-mark');
    expect(source).toContain('Admin console');
    expect(source).toContain(
      'Sign in to manage local agents, channels, approvals, and workspace state.',
    );
    expect(source).toContain('Local dashboard · private runtime');
    expect(source).not.toContain('login-product-brief');
    expect(source).not.toContain('login-lane-grid');
    expect(source).not.toContain('login-entry-checklist');
    expect(source).not.toContain('login-resume-strip');
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

  it('styles the compact login form, submit button, and 2FA state', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.login-brand-mark');
    expect(source).toContain('.login-context');
    expect(source).toContain('.login-field');
    expect(source).toContain('.login-service-note');
    expect(source).toContain('.login-error.is-visible');
    expect(source).toContain('.login-error-info');
    expect(source).toContain('.login-submit');
    expect(source).toContain('.login-totp-group');
    expect(source).toContain('.login-card .login-totp-input');
  });
});
