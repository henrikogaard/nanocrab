import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const settingsPagePath = path.join(
  process.cwd(),
  'src/admin/public/pages/settings.js',
);
const stylePath = path.join(process.cwd(), 'src/admin/public/style.css');

describe('Settings personal space UI', () => {
  it('frames Settings as the personal operating space for memory, skills, and access', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain('settings-command-center');
    expect(source).toContain('Personal space');
    expect(source).toContain(
      'Shape what the assistant knows, can do, and may access',
    );
    expect(source).toContain('settingsOperatingBriefText');
    expect(source).toContain('Settings operating brief');
    expect(source).toContain('Copy operating brief');
    expect(source).toContain('copySettingsOperatingBrief');
    expect(source).toContain('Settings operating brief copied');
    expect(source).toContain('copyTextWithFallback');
    expect(source).not.toContain(
      "window.prompt('Copy settings operating brief:'",
    );
    expect(source).toContain('window._settingsOperatingState');
    expect(source).toContain("navigate('memory')");
    expect(source).toContain("navigate('skills')");
    expect(source).toContain("navigate('credentials')");
    expect(source).toContain(
      "scrollToSettingsSection('settings-provider-card')",
    );
  });

  it('summarizes skills, providers, and readiness from current settings data', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain('settingsLoadIssues');
    expect(source).toContain('addSettingsLoadIssue');
    expect(source).toContain(
      'window._settingsOperatingState.settingsLoadIssues',
    );
    expect(source).toContain('Identity profile unavailable');
    expect(source).toContain('Provider and model readiness unavailable');
    expect(source).toContain('Agent boundary data unavailable');
    expect(source).toContain('Assistant avatar profile unavailable');
    expect(source).toContain('Installed skill inventory unavailable');
    expect(source).toContain('Push subscription status unavailable');
    expect(source).toContain('First-run preflight checks unavailable');
    expect(source).toContain('Release diagnostics unavailable');
    expect(source).toContain('Data health');
    expect(source).toContain('Some Settings readiness data used fallbacks');
    expect(source).toContain(
      'Settings data loaded without known endpoint fallbacks',
    );
    expect(source).toContain('activeSkillCount');
    expect(source).toContain('highRiskSkillCount');
    expect(source).toContain('readyProviderCount');
    expect(source).toContain('profileProbeFailures');
    expect(source).toContain('failedPreflightCount');
    expect(source).toContain('releaseStatusLabel');
    expect(source).toContain('Needs review');
    expect(source).toContain('settingsStats');
    expect(source).toContain('settingsQuickLinks');
  });

  it('explains where personal, cowork, and code settings belong', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain('settingsFocusAreas');
    expect(source).toContain('settings-focus-map');
    expect(source).toContain('Where things belong');
    expect(source).toContain(
      'Keep personal memory separate from Cowork projects and Code automation',
    );
    expect(source).toContain('settingsDelegationRunway');
    expect(source).toContain('settings-delegation-runway');
    expect(source).toContain('Delegation runway');
    expect(source).toContain(
      'Check the setup path before agents work unattended',
    );
    expect(source).toContain(
      'Use this before long Cowork MCP jobs, Code automation, scheduled tasks, or anything that can write outside NanoCrab',
    );
    expect(source).toContain(
      'Use Cowork for projects, documents, MCP context, and artifacts',
    );
    expect(source).toContain(
      'Use Code for repositories, Copilot, tests, review rules, and repo automation',
    );
    expect(source).toContain('Before assigning unattended work');
    expect(source).toContain('Memory, identity, and preferences');
    expect(source).toContain('Projects, documents, and MCP context');
    expect(source).toContain('GitHub Copilot and repo automation');
    expect(source).toContain("navigate('projects')");
    expect(source).toContain("navigate('copilot')");
    expect(source).toContain('settingsNotificationRunway');
    expect(source).toContain('renderSettingsNotificationRunway');
    expect(source).toContain('Notification wake-up policy');
    expect(source).toContain('Notify only when attention changes the outcome');
    expect(source).toContain(
      'Use push for uptime failures, approvals waiting on external writes, completed scheduled work, and blocked agent runs.',
    );
    expect(source).toContain('Open the evidence surface before replying');
    expect(source).toContain(
      'Check Logs, Approvals, Cowork project history, or Reports before retrying MCP tools, channel delivery, or document generation.',
    );
    expect(source).toContain('Do not let notifications imply approval');
    expect(source).toContain(
      'Email sends, document publishing, calendar edits, webhooks, and repository writes still need explicit approval gates.',
    );
  });

  it('shows a delegation runway before unattended agent work', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain("label: 'Model'");
    expect(source).toContain('Pick the provider profile for the work');
    expect(source).toContain(
      'Use Copilot for simple answers, Cowork profiles for tool/document work, and Code profiles for repo automation',
    );
    expect(source).toContain(
      "scrollToSettingsSection('settings-provider-card')",
    );
    expect(source).toContain("label: 'Access'");
    expect(source).toContain('Check credentials and MCP scope');
    expect(source).toContain(
      'Confirm secrets, connector access, and project/repo/channel scope before asking agents to read external systems',
    );
    expect(source).toContain("navigate('credentials')");
    expect(source).toContain("label: 'Writes'");
    expect(source).toContain('Keep external changes approval-gated');
    expect(source).toContain(
      'Documents, email sends, record updates, and repo-changing actions should route through Approvals until proven safe',
    );
    expect(source).toContain("navigate('approvals')");
    expect(source).toContain("label: 'Trust'");
    expect(source).toContain('Protect unattended work');
    expect(source).toContain(
      'Use 2FA, token review, audit trails, and security checks before trusting long-running automation',
    );
    expect(source).toContain(
      "scrollToSettingsSection('settings-security-card')",
    );
    expect(source).toContain('runwayLines');
    expect(source).toContain('Delegation runway');
  });

  it('frames assistant identity as cross-workspace personal context', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain('settings-profile-card');
    expect(source).toContain('Assistant identity compass');
    expect(source).toContain('Identity and habits that follow every workspace');
    expect(source).toContain('The profile is personal context');
    expect(source).toContain('Project files stay in Cowork');
    expect(source).toContain('repository behavior stays in Code');
    expect(source).toContain('settings-profile-metric');
    expect(source).toContain(
      "document.getElementById('identity-name')?.focus()",
    );
  });

  it('keeps account, identity, avatar, push, and token create controls class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const accountBlock = source.slice(
      source.indexOf('<div class="settings-account-grid">'),
      source.indexOf('${providerProfilesCard}`'),
    );
    const appearanceBlock = source.slice(
      source.indexOf('<div class="grid grid-2">'),
      source.indexOf('<div class="card" id="settings-report-card">'),
    );
    const uploadBlock = source.slice(
      source.indexOf("document.getElementById('avatar-file').onchange"),
      source.indexOf('// Identity form'),
    );
    const statusHandlers = source.slice(
      source.indexOf("document.getElementById('pw-form').onsubmit"),
      source.indexOf('window.scrollToSettingsSection'),
    );
    const lowerStatusHandlers = source.slice(
      source.indexOf('window.savePersonality'),
      source.indexOf('// --- Pin/Unpin Messages ---'),
    );

    expect(source).toContain('function setSettingsStatus');
    expect(source).toContain(
      "el.classList.remove('is-success', 'is-error', 'is-muted', 'is-visible')",
    );
    expect(source).toContain('el.classList.add(`is-${tone}`)');
    expect(accountBlock).toContain('settings-account-grid');
    expect(accountBlock).toContain('settings-password-msg');
    expect(accountBlock).toContain('settings-readonly-input');
    expect(accountBlock).toContain('settings-identity-actions');
    expect(accountBlock).toContain('settings-form-note');
    expect(appearanceBlock).toContain('settings-theme-section');
    expect(appearanceBlock).toContain('settings-theme-label');
    expect(appearanceBlock).toContain('class="theme-preview is-${t}"');
    expect(source).toContain(
      'onerror="this.classList.add(\'is-unavailable\')"',
    );
    expect(appearanceBlock).toContain('settings-avatar-section');
    expect(appearanceBlock).toContain('settings-avatar-current');
    expect(appearanceBlock).toContain('settings-avatar-preview');
    expect(appearanceBlock).toContain('settings-avatar-copy');
    expect(appearanceBlock).toContain('settings-avatar-file');
    expect(appearanceBlock).toContain('settings-avatar-name');
    expect(appearanceBlock).toContain('settings-avatar-kind');
    expect(appearanceBlock).toContain('settings-avatar-msg');
    expect(appearanceBlock).toContain('renderSettingsAvatarEmptyState()');
    expect(source).toContain('function renderSettingsAvatarEmptyState');
    expect(source).toContain('settings-avatar-empty-state');
    expect(source).toContain('No avatar options available');
    expect(source).toContain('Upload avatar');
    expect(source).toContain("document.getElementById('avatar-file')?.click()");
    expect(appearanceBlock).toContain('settings-push-note');
    expect(appearanceBlock).toContain('settings-push-card');
    expect(appearanceBlock).toContain('settings-push-readiness');
    expect(appearanceBlock).toContain('settings-push-facts');
    expect(source).toContain('settings-push-runway');
    expect(source).toContain('settings-push-empty');
    expect(appearanceBlock).toContain('Push is ready for important work');
    expect(appearanceBlock).toContain('Push needs a subscribed browser');
    expect(appearanceBlock).toContain(
      'Use notifications for outages, approval waits, completed routines, and blocked agents.',
    );
    expect(appearanceBlock).toContain(
      'External writes still require explicit approvals.',
    );
    expect(appearanceBlock).toContain('Copy policy');
    expect(appearanceBlock).toContain('settings-push-actions');
    expect(appearanceBlock).toContain('settings-push-subscriptions');
    expect(appearanceBlock).toContain('settings-owner-grid');
    expect(appearanceBlock).toContain("${!isOwner ? 'is-hidden' : ''}");
    expect(appearanceBlock).toContain('settings-token-create');
    expect(uploadBlock).toContain(
      "setSettingsStatus(msgEl, 'Avatar updated', 'success')",
    );
    expect(accountBlock).not.toContain(
      'style="display:grid;grid-template-columns:1fr 1fr;gap:16px"',
    );
    expect(accountBlock).not.toContain(
      'id="pw-msg" style="margin-bottom:12px;font-size:13px;display:none;padding:8px 12px;border-radius:var(--radius-sm)"',
    );
    expect(accountBlock).not.toContain('disabled style="opacity:0.6"');
    expect(accountBlock).not.toContain(
      'style="display:flex;gap:8px;align-items:center"',
    );
    expect(accountBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:8px"',
    );
    expect(appearanceBlock).not.toContain('style="margin-bottom:16px"');
    expect(appearanceBlock).not.toContain('style="--theme-preview-color');
    expect(appearanceBlock).not.toContain(
      'class="theme-preview" style="background:${themeColors[t]}"',
    );
    expect(appearanceBlock).not.toContain(
      'style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)"',
    );
    expect(appearanceBlock).not.toContain(
      'style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border);background:var(--surface)"',
    );
    expect(appearanceBlock).not.toContain(
      'style="font-size:13px;font-weight:600;color:var(--text)"',
    );
    expect(appearanceBlock).not.toContain(
      'id="push-status" style="font-size:12px;color:var(--text-muted)"',
    );
    expect(appearanceBlock).not.toContain(
      'id="avatar-file" accept="image/*" style="display:none"',
    );
    expect(appearanceBlock).not.toContain(
      '<div class="empty">No avatar options available.</div>',
    );
    expect(appearanceBlock).not.toContain(
      "${!isOwner ? 'style=\"display:none\"' : ''}",
    );
    expect(source).not.toContain('onerror="this.style.opacity=\'0.25\'"');
    expect(uploadBlock).not.toContain('Avatar updated!');
    expect(statusHandlers).toContain(
      "setSettingsStatus(msg, 'Passwords do not match', 'error')",
    );
    expect(statusHandlers).toContain(
      "setSettingsStatus(msg, 'Password changed', 'success')",
    );
    expect(statusHandlers).toContain(
      'Password change failed. Check the current password and try again.',
    );
    expect(statusHandlers).toContain(
      'Could not reach the password endpoint. Check logs before retrying.',
    );
    expect(statusHandlers).toContain(
      "setSettingsStatus(msgEl, 'Uploading...', 'muted')",
    );
    expect(statusHandlers).toContain(
      "setSettingsStatus(msgEl, 'Avatar updated', 'success')",
    );
    expect(source).toContain(
      'Push setup failed. Check browser permission, service worker readiness, and VAPID credentials before relying on wake-up alerts.',
    );
    expect(source).toContain(
      'Test notification was not sent. Check VAPID credentials, active subscriptions, and service worker state before trusting push alerts.',
    );
    expect(source).toContain("toast('Push notifications enabled', 'success')");
    expect(source).toContain("if (statusEl) statusEl.textContent = 'Ready'");
    expect(statusHandlers).toContain(
      'Avatar upload failed. Try a smaller image or check storage permissions.',
    );
    expect(statusHandlers).toContain(
      'Avatar upload could not reach the server. Check logs before retrying.',
    );
    expect(statusHandlers).toContain(
      "setSettingsStatus(msg, 'Name required', 'error')",
    );
    expect(statusHandlers).toContain(
      'Identity save failed. Keep the current assistant profile until this saves.',
    );
    expect(statusHandlers).toContain(
      'Could not save identity. Check the admin API and retry.',
    );
    expect(lowerStatusHandlers).toContain(
      "setSettingsStatus(msg, 'Saved', 'success')",
    );
    expect(lowerStatusHandlers).toContain(
      "setSettingsStatus(msg, 'Avatar saved', 'success')",
    );
    expect(lowerStatusHandlers).toContain(
      'Could not save global instructions. Review logs before editing memory or skills.',
    );
    expect(lowerStatusHandlers).toContain(
      'Could not reach the instructions endpoint. Your changes are still in the editor.',
    );
    expect(lowerStatusHandlers).toContain(
      'Avatar selection failed. Keep the current assistant avatar for now.',
    );
    expect(lowerStatusHandlers).toContain(
      'Report config was not saved. Keep scheduled reports paused until this succeeds.',
    );
    expect(lowerStatusHandlers).toContain(
      'Could not reach report settings. Check the admin API before enabling reports.',
    );
    expect(statusHandlers).not.toContain('msg.style.background');
    expect(statusHandlers).not.toContain('msg.style.color');
    expect(statusHandlers).not.toContain('msg.style.display');
    expect(statusHandlers).not.toContain('msgEl.style.color');
    expect(lowerStatusHandlers).not.toContain('msg.style.color');
    expect(style).toContain('.settings-account-grid');
    expect(style).toContain('.settings-delegation-runway');
    expect(style).toContain('.settings-delegation-head');
    expect(style).toContain('.settings-delegation-grid');
    expect(style).toContain('.settings-delegation-card');
    expect(style).toContain('.settings-delegation-card:hover');
    expect(style).toContain('.settings-delegation-grid,');
    expect(style).toContain('.settings-password-msg');
    expect(style).toContain('.settings-password-msg.is-visible');
    expect(style).toContain('.settings-password-msg.is-success');
    expect(style).toContain('.settings-status-msg.is-success');
    expect(style).toContain('.settings-avatar-preview');
    expect(style).toContain('.avatar-option img.is-unavailable');
    expect(style).toContain('.settings-avatar-file');
    expect(style).toContain('.settings-avatar-empty-state');
    expect(style).toContain('.settings-avatar-empty-actions');
    expect(style).toContain('.settings-owner-grid.is-hidden');
    expect(style).toContain('.settings-push-card');
    expect(style).toContain('.settings-push-readiness');
    expect(style).toContain('.settings-push-readiness.is-ready');
    expect(style).toContain('.settings-push-facts');
    expect(style).toContain('.settings-push-runway');
    expect(style).toContain('.settings-push-runway-step');
    expect(style).toContain('.settings-push-runway-step:focus-visible');
    expect(style).toContain('.settings-push-subscription-row');
    expect(style).toContain('.settings-push-empty');
    expect(style).toContain('.settings-push-actions');
    expect(style).toContain('.theme-preview.is-dark');
    expect(style).toContain('.theme-preview.is-light');
    expect(style).toContain('.theme-preview.is-midnight');
    expect(style).toContain('.theme-preview.is-forest');
    expect(style).toContain('.theme-preview.is-amber');
  });

  it('frames 2FA as a trust-critical workspace protection flow', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');

    expect(source).toContain('settings-2fa-state is-enabled');
    expect(source).toContain(
      'Two-factor authentication protects this workspace',
    );
    expect(source).toContain(
      'Add a second factor before trusting unattended work',
    );
    expect(source).toContain(
      'memory, credentials, approvals, and coding automation',
    );
    expect(source).toContain('settings-2fa-setup-panel');
    expect(source).toContain('Authenticator setup');
    expect(source).toContain('settings-2fa-code');
    expect(source).toContain('Could not load 2FA status');
    expect(source).toContain('load2faStatus()');
  });

  it('keeps provider selection and profile routing controls class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const providerBlock = source.slice(
      source.indexOf('const providerCards = selectableProviders'),
      source.indexOf('const providerProfilesCard = `'),
    );
    const profilesBlock = source.slice(
      source.indexOf('const providerProfilesCard = `'),
      source.indexOf(
        'const avatarOptions',
        source.indexOf('const providerProfilesCard = `'),
      ),
    );

    expect(providerBlock).toContain('settings-provider-option');
    expect(providerBlock).toContain(
      "selectedProvider === p.id ? 'is-selected' : ''",
    );
    expect(providerBlock).toContain('settings-provider-option-head');
    expect(providerBlock).toContain('settings-provider-option-name');
    expect(providerBlock).toContain('settings-mini-badge');
    expect(providerBlock).toContain('settings-provider-option-description');
    expect(providerBlock).toContain('settings-provider-option-meta');
    expect(providerBlock).toContain('settings-provider-base-field');
    expect(providerBlock).toContain('settings-field-label');
    expect(providerBlock).toContain('settings-provider-credential-hint');
    expect(source).toContain('settings-provider-card');
    expect(source).toContain('settings-provider-grid');
    expect(source).toContain('settings-provider-actions');
    expect(source).toContain('settings-provider-model-field');
    expect(source).toContain('settings-inline-check');
    expect(source).toContain('settings-provider-preflight');
    expect(source).toContain('Test and validate');
    expect(source).toContain('testAndValidateProvider');
    expect(source).toContain('URLSearchParams');
    expect(source).toContain('provider-base-url');
    expect(source).toContain('provider-model');
    expect(source).toContain('settings-provider-auth-note');
    expect(source).toContain('renderProviderCheckRows');
    expect(source).toContain('settings-provider-check');
    expect(source).toContain('settings-provider-check-detail');
    expect(source).toContain('settings-provider-check-error');
    expect(profilesBlock).toContain('settings-provider-profiles-card');
    expect(profilesBlock).toContain('settings-card-note');
    expect(profilesBlock).toContain('settings-profile-purpose');
    expect(profilesBlock).toContain('settings-profile-control');
    expect(profilesBlock).toContain('settings-profile-model');
    expect(profilesBlock).toContain('settings-profile-fallback');
    expect(profilesBlock).toContain('settings-profile-probe');
    expect(profilesBlock).toContain('settings-profile-reliability');
    expect(profilesBlock).toContain('settings-profile-error');
    expect(profilesBlock).toContain('settings-profile-action-cell');
    expect(providerBlock).not.toContain(
      'style="text-align:left;padding:14px;border:2px solid',
    );
    expect(providerBlock).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px"',
    );
    expect(providerBlock).not.toContain(
      'style="font-size:14px;color:var(--text)"',
    );
    expect(providerBlock).not.toContain('style="font-size:9px"');
    expect(providerBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted);line-height:1.35"',
    );
    expect(providerBlock).not.toContain(
      'class="form-group" style="margin:0;min-width:280px;flex:1"',
    );
    expect(source).not.toContain(
      'id="settings-provider-card" style="margin-bottom:16px"',
    );
    expect(source).not.toContain(
      'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px"',
    );
    expect(source).not.toContain(
      'class="form-group" style="margin:0;min-width:220px"',
    );
    expect(source).not.toContain(
      'style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted)"',
    );
    expect(source).not.toContain(
      'id="provider-preflight" style="margin-top:8px;font-size:11px;color:var(--text-muted)"',
    );
    expect(source).not.toContain('style="margin-top:4px">${c.ok ?');
    expect(source).not.toContain('style="color:var(--text-muted)"');
    expect(source).not.toContain('style="color:var(--error);margin-top:4px"');
    expect(profilesBlock).not.toContain(
      'class="card" style="margin-bottom:16px"',
    );
    expect(profilesBlock).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(profilesBlock).not.toContain(
      'td style="color:var(--text);font-weight:600"',
    );
    expect(profilesBlock).not.toContain(
      'style="min-width:150px;padding:5px 8px;font-size:12px"',
    );
    expect(profilesBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:4px"',
    );
    expect(profilesBlock).not.toContain(
      'style="font-size:10px;color:var(--error);margin-top:3px"',
    );
    expect(profilesBlock).not.toContain('td style="white-space:nowrap"');
    expect(style).toContain('.settings-provider-option');
    expect(style).toContain('.settings-provider-option.is-selected');
    expect(style).toContain('.settings-provider-card');
    expect(style).toContain('.settings-provider-grid');
    expect(style).toContain('.settings-provider-actions');
    expect(style).toContain('.settings-provider-check');
    expect(style).toContain('.settings-provider-check-detail');
    expect(style).toContain('.settings-provider-check-error');
    expect(style).toContain('.settings-provider-base-field');
    expect(style).toContain('.settings-provider-profiles-card');
    expect(style).toContain('.settings-profile-control');
    expect(style).toContain('.settings-profile-action-cell');
  });

  it('keeps skill family and agent boundary summaries class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const skillsBlock = source.slice(
      source.indexOf('const skillPreferenceRows ='),
      source.indexOf('const agentBoundaryCard ='),
    );
    const boundaryBlock = source.slice(
      source.indexOf('const agentBoundaryCard ='),
      source.indexOf('const setupPreflightCard ='),
    );

    expect(skillsBlock).toContain('settings-skill-family-row');
    expect(skillsBlock).toContain('settings-skill-family-name');
    expect(skillsBlock).toContain('settings-skill-family-meta');
    expect(skillsBlock).toContain('skillPreferenceEmpty');
    expect(skillsBlock).toContain('settings-skill-empty-state');
    expect(skillsBlock).toContain('Reusable agent behavior');
    expect(skillsBlock).toContain('No skills installed yet');
    expect(skillsBlock).toContain('Keep personal facts in Memory');
    expect(skillsBlock).toContain("navigate('marketplace')");
    expect(skillsBlock).toContain("navigate('memory')");
    expect(boundaryBlock).toContain('settings-agent-boundary-card');
    expect(boundaryBlock).toContain('settings-card-note');
    expect(boundaryBlock).toContain('settings-boundary-agent');
    expect(boundaryBlock).toContain('settings-boundary-profiles');
    expect(boundaryBlock).toContain('settings-boundary-empty');
    expect(skillsBlock).not.toContain(
      'style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--border)"',
    );
    expect(skillsBlock).not.toContain(
      'style="font-size:13px;font-weight:600;color:var(--text);text-transform:capitalize"',
    );
    expect(skillsBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(skillsBlock).not.toContain(
      '<div class="empty settings-skill-empty">No skills installed.</div>',
    );
    expect(boundaryBlock).not.toContain(
      'class="card" style="margin-bottom:16px"',
    );
    expect(boundaryBlock).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(boundaryBlock).not.toContain(
      'td style="font-weight:600;color:var(--text)"',
    );
    expect(boundaryBlock).not.toContain(
      'td style="font-size:11px;color:var(--text-muted)"',
    );
    expect(boundaryBlock).not.toContain(
      'td colspan="5" style="color:var(--text-muted)"',
    );
    expect(style).toContain('.settings-skill-family-row');
    expect(style).toContain('.settings-skill-family-name');
    expect(style).toContain('.settings-skill-empty-state');
    expect(style).toContain('.settings-skill-empty-flow');
    expect(style).toContain('.settings-skill-empty-actions');
    expect(style).toContain('.settings-agent-boundary-card');
    expect(style).toContain('.settings-boundary-agent');
  });

  it('keeps setup preflight and release diagnostics class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const diagnosticsCards = source.slice(
      source.indexOf('const setupPreflightCard ='),
      source.indexOf('el.innerHTML = `'),
    );
    const diagnosticsRenderers = source.slice(
      source.indexOf('function renderSetupPreflightChecks'),
      source.indexOf('// --- User Management ---'),
    );
    const diagnosticsRefreshers = source.slice(
      source.indexOf('window.refreshSetupPreflight'),
      source.indexOf('window.saveProviderProfile'),
    );

    expect(diagnosticsCards).toContain('settings-diagnostics-card');
    expect(diagnosticsCards).toContain('settings-diagnostics-head');
    expect(diagnosticsCards).toContain('settings-diagnostics-subtitle');
    expect(diagnosticsCards).toContain('settings-diagnostics-actions');
    expect(diagnosticsCards).toContain('settings-diagnostics-grid');
    expect(diagnosticsCards).toContain('renderSetupPreflightChecks');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-section');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-section-title');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-check');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-check-head');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-detail');
    expect(diagnosticsRenderers).toContain('settings-diagnostic-hint');
    expect(diagnosticsRefreshers).toContain('settings-diagnostic-loading');
    expect(diagnosticsCards).not.toContain(
      'class="card" style="margin-bottom:16px"',
    );
    expect(diagnosticsCards).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px"',
    );
    expect(diagnosticsCards).not.toContain(
      'class="card-title" style="margin:0"',
    );
    expect(diagnosticsCards).not.toContain(
      'style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px"',
    );
    expect(diagnosticsRenderers).not.toContain(
      'style="padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)"',
    );
    expect(diagnosticsRenderers).not.toContain(
      'style="display:flex;justify-content:space-between;gap:8px;align-items:center"',
    );
    expect(diagnosticsRenderers).not.toContain(
      'style="font-size:12px;color:var(--text)"',
    );
    expect(diagnosticsRenderers).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-top:5px;line-height:1.35"',
    );
    expect(diagnosticsRefreshers).not.toContain(
      'style="font-size:12px;color:var(--text-muted)"',
    );
    expect(style).toContain('.settings-diagnostics-card');
    expect(style).toContain('.settings-diagnostics-grid');
    expect(style).toContain('.settings-diagnostic-check');
    expect(style).toContain('.settings-diagnostic-loading');
  });

  it('keeps user management access controls class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const usersBlock = source.slice(
      source.indexOf('async function loadUsersSection'),
      source.indexOf('window.selectProvider'),
    );

    expect(usersBlock).toContain('settings-user-empty-state');
    expect(usersBlock).toContain('renderSettingsUserErrorState');
    expect(usersBlock).toContain('Single-user mode');
    expect(usersBlock).toContain('No additional users yet');
    expect(usersBlock).toContain('The env-based owner account is active');
    expect(usersBlock).toContain('User management unavailable');
    expect(usersBlock).toContain(
      'We could not load additional workspace users.',
    );
    expect(usersBlock).toContain('navigate(&quot;monitoring&quot;)');
    expect(usersBlock).toContain('Choose least privilege');
    expect(usersBlock).toContain('Review audit trail');
    expect(usersBlock).toContain(
      'document.getElementById(&quot;new-user-name&quot;)?.focus()',
    );
    expect(usersBlock).toContain('navigate(&quot;audit&quot;)');
    expect(usersBlock).toContain('settings-user-row');
    expect(usersBlock).toContain('settings-user-name');
    expect(usersBlock).toContain('settings-user-role-badge');
    expect(usersBlock).toContain('settings-user-last-login');
    expect(usersBlock).toContain('settings-user-actions');
    expect(usersBlock).toContain('settings-user-role-select');
    expect(usersBlock).toContain('settings-users-card');
    expect(usersBlock).toContain('settings-card-note');
    expect(usersBlock).toContain('settings-users-list');
    expect(usersBlock).toContain('settings-user-form');
    expect(usersBlock).toContain('settings-user-field');
    expect(usersBlock).toContain('settings-field-label');
    expect(usersBlock).toContain('settings-user-input');
    expect(usersBlock).toContain('settings-user-role-select-large');
    expect(usersBlock).toContain('function settingsUserActionErrorMessage');
    expect(usersBlock).toContain(
      'User was not created. Check the username, password length, selected role, and whether owner-only user management is available.',
    );
    expect(usersBlock).toContain(
      'User role was not updated. Reload users, confirm the target account still exists, and review audit before changing access.',
    );
    expect(usersBlock).toContain(
      'User was not deleted. Check active sessions, owner account requirements, and audit trail before retrying account removal.',
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('create', r), 'error')",
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('create', e), 'error')",
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('role', r), 'error')",
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('role', e), 'error')",
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('delete', r), 'error')",
    );
    expect(source).toContain(
      "toast(settingsUserActionErrorMessage('delete', e), 'error')",
    );
    expect(usersBlock).not.toContain(
      '<div class="empty settings-user-empty">No additional users. Single-user mode is active (env credentials).</div>',
    );
    expect(usersBlock).not.toContain("section.innerHTML = ''");
    expect(usersBlock).not.toContain('class="empty" style="padding:8px"');
    expect(usersBlock).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"',
    );
    expect(usersBlock).not.toContain('span style="font-weight:600"');
    expect(usersBlock).not.toContain('style="margin-left:8px;font-size:11px"');
    expect(usersBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted);margin-left:8px"',
    );
    expect(usersBlock).not.toContain(
      'style="display:flex;align-items:center;gap:8px"',
    );
    expect(usersBlock).not.toContain(
      'select style="font-size:12px;padding:2px 6px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm)"',
    );
    expect(usersBlock).not.toContain('class="card" style="margin-top:16px"');
    expect(usersBlock).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(usersBlock).not.toContain(
      'id="users-list" style="margin-bottom:16px"',
    );
    expect(usersBlock).not.toContain(
      'style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap"',
    );
    expect(usersBlock).not.toContain('class="form-group" style="margin:0"');
    expect(usersBlock).not.toContain('style="max-width:150px"');
    expect(source).not.toContain(
      "toast(r.error || 'Failed', 'error');\n    }\n  } catch (e) {\n    toast('Failed: ' + e.message, 'error');\n  }\n};\n\nwindow.changeUserRole",
    );
    expect(style).toContain('.settings-users-card');
    expect(style).toContain('.settings-user-empty-state');
    expect(style).toContain('.settings-user-empty-flow');
    expect(style).toContain('.settings-user-empty-actions');
    expect(style).toContain('.settings-user-row');
    expect(style).toContain('.settings-user-role-select');
    expect(style).toContain('.settings-user-form');
  });

  it('keeps API tokens, personality, and provenance panels class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const securityCard = source.slice(
      source.indexOf('id="settings-security-card"'),
      source.indexOf('id="settings-report-card"'),
    );
    const provenanceBlock = source.slice(
      source.indexOf('async function loadProvenanceTimeline'),
      source.indexOf('// --- 2FA Management ---'),
    );
    const personalityBlock = source.slice(
      source.indexOf('async function loadPersonalityEditor'),
      source.indexOf('window.savePersonality'),
    );
    const tokenBlock = source.slice(
      source.indexOf('async function loadApiTokens'),
      source.indexOf('window.revokeApiToken'),
    );

    expect(securityCard).toContain('settings-card-note');
    expect(securityCard).toContain('settings-token-list');
    expect(securityCard).toContain('settings-token-input');
    expect(securityCard).toContain('settings-token-display is-hidden');
    expect(securityCard).toContain('settings-token-warning');
    expect(securityCard).toContain('settings-token-value');
    expect(source).toContain('settings-personality-card');
    expect(source).toContain('settings-provenance-card');
    expect(provenanceBlock).toContain('settings-provenance-list');
    expect(provenanceBlock).toContain('settings-provenance-row');
    expect(provenanceBlock).toContain('settings-provenance-time');
    expect(provenanceBlock).toContain('settings-mini-badge');
    expect(provenanceBlock).toContain('settings-provenance-subject');
    expect(provenanceBlock).toContain('settings-provenance-summary');
    expect(provenanceBlock).toContain('renderSettingsProvenanceEmptyState');
    expect(provenanceBlock).toContain('renderSettingsProvenanceErrorState');
    expect(provenanceBlock).toContain('No provenance events yet');
    expect(provenanceBlock).toContain(
      'Memory, skills, and approved learning will appear here.',
    );
    expect(provenanceBlock).toContain("navigate('memory')");
    expect(provenanceBlock).toContain("navigate('skills')");
    expect(provenanceBlock).toContain('Timeline unavailable');
    expect(provenanceBlock).toContain(
      'We could not load memory and skill provenance.',
    );
    expect(personalityBlock).toContain('settings-personality-editor');
    expect(personalityBlock).toContain('settings-personality-actions');
    expect(personalityBlock).toContain('settings-status-msg');
    expect(personalityBlock).toContain('renderSettingsPersonalityErrorState');
    expect(personalityBlock).toContain('settings-personality-error-state');
    expect(personalityBlock).toContain('Personality config unavailable');
    expect(personalityBlock).toContain('global AGENTS.md instructions');
    expect(personalityBlock).toContain("navigate('monitoring')");
    expect(personalityBlock).toContain('loadPersonalityEditor()');
    expect(tokenBlock).toContain('renderSettingsTokenEmptyState');
    expect(tokenBlock).toContain('renderSettingsTokenErrorState');
    expect(tokenBlock).toContain('settings-token-empty-state');
    expect(tokenBlock).toContain('settings-token-error-state');
    expect(tokenBlock).toContain('No API tokens created');
    expect(tokenBlock).toContain(
      "document.getElementById('new-token-name')?.focus()",
    );
    expect(tokenBlock).toContain("navigate('credentials')");
    expect(tokenBlock).toContain('Token list unavailable');
    expect(tokenBlock).toContain(
      'Do not create replacement tokens until the current list loads',
    );
    expect(tokenBlock).toContain('settings-token-row');
    expect(tokenBlock).toContain('settings-token-name');
    expect(tokenBlock).toContain('settings-token-code');
    expect(tokenBlock).toContain('settings-token-actions');
    expect(tokenBlock).toContain('settings-token-last-used');
    expect(tokenBlock).toContain("display.classList.remove('is-hidden')");
    expect(tokenBlock).toContain(
      "settingsActionErrorMessage('token-create', r)",
    );
    expect(tokenBlock).toContain(
      "settingsActionErrorMessage('token-create', e)",
    );
    expect(tokenBlock).not.toContain(
      "toast('Failed to create token', 'error')",
    );
    expect(securityCard).not.toContain(
      'style="font-size:12px;color:var(--text-muted);margin-bottom:12px"',
    );
    expect(securityCard).not.toContain(
      'id="tokens-list" style="margin-bottom:12px"',
    );
    expect(securityCard).not.toContain('style="max-width:200px"');
    expect(securityCard).not.toContain(
      'style="display:none;margin-top:12px;padding:12px;background:var(--bg);border:1px solid var(--accent);border-radius:var(--radius-sm)"',
    );
    expect(provenanceBlock).not.toContain(
      'style="display:flex;flex-direction:column;gap:8px"',
    );
    expect(provenanceBlock).not.toContain(
      'style="display:grid;grid-template-columns:150px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"',
    );
    expect(provenanceBlock).not.toContain(
      '<div class="empty">No provenance events yet</div>',
    );
    expect(provenanceBlock).not.toContain(
      '<div class="empty">Failed to load provenance timeline</div>',
    );
    expect(personalityBlock).not.toContain(
      'style="width:100%;font-family:var(--mono);font-size:12px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;resize:vertical;line-height:1.5"',
    );
    expect(personalityBlock).not.toContain(
      'style="display:flex;gap:8px;align-items:center;margin-top:8px"',
    );
    expect(personalityBlock).not.toContain(
      '<div class="empty">Failed to load personality config</div>',
    );
    expect(tokenBlock).not.toContain('class="empty" style="padding:8px"');
    expect(tokenBlock).not.toContain(
      '<div class="empty settings-token-empty">No API tokens created</div>',
    );
    expect(tokenBlock).not.toContain('} catch {}');
    expect(tokenBlock).not.toContain(
      'style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"',
    );
    expect(tokenBlock).not.toContain("display.style.display = 'block'");
    expect(style).toContain('.settings-personality-editor');
    expect(style).toContain('.settings-personality-error-state');
    expect(style).toContain('.settings-personality-error-actions');
    expect(style).toContain('.settings-provenance-list');
    expect(style).toContain('.settings-provenance-empty-state');
    expect(style).toContain('.settings-provenance-error-state');
    expect(style).toContain('.settings-provenance-empty-actions');
    expect(style).toContain('.settings-token-display');
    expect(style).toContain('.settings-token-empty-state');
    expect(style).toContain('.settings-token-error-state');
    expect(style).toContain('.settings-token-empty-actions');
    expect(style).toContain('.settings-token-row');
  });

  it('keeps scheduled report controls structured for recurring summaries and documents', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const reportBlock = source.slice(
      source.indexOf('async function loadReportConfig'),
      source.indexOf('window.saveReportConfig'),
    );

    expect(reportBlock).toContain('settings-report-toggle');
    expect(reportBlock).toContain('settings-report-grid');
    expect(reportBlock).toContain('settings-report-field');
    expect(reportBlock).toContain('settings-report-block');
    expect(reportBlock).toContain('settings-report-input');
    expect(reportBlock).toContain('settings-report-options');
    expect(reportBlock).toContain('settings-report-check');
    expect(reportBlock).toContain('settings-report-approval');
    expect(reportBlock).toContain('settings-report-actions');
    expect(reportBlock).toContain('settings-report-warning');
    expect(reportBlock).toContain('Report provider profiles unavailable');
    expect(reportBlock).toContain('Provider profiles need review');
    expect(reportBlock).toContain('profile choices did not load');
    expect(reportBlock).toContain('addSettingsLoadIssue(providerProfileIssue)');
    expect(reportBlock).toContain('renderSettingsReportErrorState');
    expect(reportBlock).toContain('settings-report-error-state');
    expect(reportBlock).toContain('Report settings unavailable');
    expect(reportBlock).toContain(
      'We could not load scheduled report automation.',
    );
    expect(reportBlock).toContain("navigate('reports')");
    expect(reportBlock).toContain('settings-status-msg');
    expect(reportBlock).toContain('report-source');
    expect(reportBlock).toContain('report-format');
    expect(reportBlock).toContain('report-outline-approval');
    expect(reportBlock).not.toContain('} catch {}');
    expect(reportBlock).not.toContain(
      'class="channel-card" style="padding:8px 0"',
    );
    expect(reportBlock).not.toContain(
      'style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"',
    );
    expect(reportBlock).not.toContain('class="form-group" style="margin:0"');
    expect(reportBlock).not.toContain('style="max-width:100%"');
    expect(reportBlock).not.toContain(
      'style="display:flex;gap:6px;align-items:center;font-size:12px;color:var(--text-muted);margin-top:4px"',
    );
    expect(reportBlock).not.toContain(
      'style="display:flex;gap:8px;align-items:center;margin-top:8px"',
    );
    expect(style).toContain('.settings-report-toggle');
    expect(style).toContain('.settings-report-grid');
    expect(style).toContain('.settings-report-check');
    expect(style).toContain('.settings-report-warning');
    expect(style).toContain('.settings-report-error-state');
    expect(style).toContain('.settings-report-error-actions');
    expect(style).toContain(
      '.settings-report-error-state,\n  .settings-report-grid,\n  .settings-2fa-setup-panel',
    );
  });

  it('keeps plugin toggles readable and class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const pluginCard = source.slice(
      source.indexOf('id="settings-plugins-card"'),
      source.indexOf('id="settings-2fa-card"'),
    );
    const pluginBlock = source.slice(
      source.indexOf('async function loadPluginsList'),
      source.indexOf('window.togglePlugin'),
    );

    expect(pluginCard).toContain('settings-plugins-card');
    expect(pluginBlock).toContain('settings-plugin-row');
    expect(pluginBlock).toContain('settings-plugin-version');
    expect(pluginBlock).toContain('settings-plugin-description');
    expect(pluginBlock).toContain('settings-plugin-toggle');
    expect(pluginBlock).toContain('renderSettingsPluginEmptyState');
    expect(pluginBlock).toContain('renderSettingsPluginErrorState');
    expect(pluginBlock).toContain(
      "addSettingsLoadIssue('Plugin registry unavailable')",
    );
    expect(pluginBlock).toContain('No optional plugins installed');
    expect(pluginBlock).toContain(
      'Built-in Copilot, Cowork, Code, and System surfaces are ready.',
    );
    expect(pluginBlock).toContain("navigate('marketplace')");
    expect(pluginBlock).toContain('Plugin registry unavailable');
    expect(pluginBlock).toContain(
      'We could not read installed plugin metadata.',
    );
    expect(pluginBlock).toContain('togglePlugin');
    expect(pluginCard).not.toContain(
      'id="settings-plugins-card" style="margin-top:16px"',
    );
    expect(pluginBlock).not.toContain(
      '<div class="empty">No plugins installed</div>',
    );
    expect(pluginBlock).not.toContain(
      '<div class="empty">Failed to load plugins</div>',
    );
    expect(source).not.toContain(
      "window._pluginsList = await api('/plugins').catch(() => [])",
    );
    expect(source).toContain(
      "addSettingsLoadIssue('Plugin registry unavailable after toggle')",
    );
    expect(pluginBlock).not.toContain(
      'class="channel-card" style="padding:10px 0;display:flex;justify-content:space-between;align-items:center"',
    );
    expect(pluginBlock).not.toContain(
      'style="font-size:11px;color:var(--text-muted)"',
    );
    expect(pluginBlock).not.toContain(
      'style="font-size:12px;color:var(--text-muted)"',
    );
    expect(pluginBlock).not.toContain(
      'style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0"',
    );
    expect(style).toContain('.settings-plugins-card');
    expect(style).toContain('.settings-plugin-row');
    expect(style).toContain('.settings-plugin-toggle');
    expect(style).toContain('.settings-plugin-empty-state');
    expect(style).toContain('.settings-plugin-error-state');
    expect(style).toContain('.settings-plugin-empty-actions');
    expect(style).toContain('.settings-report-error-state');
    expect(style).toContain('.settings-report-warning');
    expect(style).toContain(
      '.settings-plugin-empty-state,\n.settings-plugin-error-state',
    );
  });

  it('keeps lower Settings panels and app summary class-based', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');
    const lowerBlock = source.slice(
      source.indexOf('id="settings-plugins-card"'),
      source.indexOf('// Load user management'),
    );

    expect(lowerBlock).toContain('settings-card-note');
    expect(lowerBlock).toContain('settings-2fa-card');
    expect(lowerBlock).toContain('settingsPanelLoadingState');
    expect(lowerBlock).toContain('Loading optional workspace plugins');
    expect(lowerBlock).toContain('Loading two-factor status');
    expect(lowerBlock).toContain('Loading global personality context');
    expect(lowerBlock).toContain('Loading memory and skill provenance');
    expect(lowerBlock).toContain('settings-personality-card');
    expect(lowerBlock).toContain('settings-skills-card');
    expect(lowerBlock).toContain('skillPreferenceEmpty');
    expect(lowerBlock).toContain('settings-skills-actions');
    expect(lowerBlock).toContain('settings-provenance-card');
    expect(lowerBlock).toContain('settings-about-card');
    expect(lowerBlock).toContain('settings-about-head');
    expect(lowerBlock).toContain('settings-about-mark');
    expect(lowerBlock).toContain('settings-about-name');
    expect(lowerBlock).toContain('settings-about-version');
    expect(lowerBlock).toContain('settings-about-table');
    expect(lowerBlock).not.toContain(
      'id="settings-2fa-card" style="margin-top:16px"',
    );
    expect(lowerBlock).not.toContain(
      'id="settings-skills-card" style="margin-top:16px"',
    );
    expect(lowerBlock).not.toContain('class="empty" style="padding:8px"');
    expect(lowerBlock).not.toContain(
      '<div class="empty settings-skill-empty">No skills installed.</div>',
    );
    expect(lowerBlock).not.toContain('style="margin-top:12px"');
    expect(lowerBlock).not.toContain('class="card" style="margin-top:16px"');
    expect(lowerBlock).not.toContain(
      'style="display:flex;align-items:center;gap:20px"',
    );
    expect(lowerBlock).not.toContain('style="width:64px;height:64px"');
    expect(lowerBlock).not.toContain(
      'style="font-size:20px;font-weight:700;color:var(--text)"',
    );
    expect(lowerBlock).not.toContain('style="font-size:13px;margin-top:16px"');
    expect(lowerBlock).not.toContain(
      'style="padding:4px 16px 4px 0;color:var(--text-muted)"',
    );
    expect(style).toContain('.settings-2fa-card');
    expect(style).toContain('.settings-skills-actions');
    expect(style).toContain('.settings-about-card');
    expect(style).toContain('.settings-about-table td:first-child');
  });

  it('uses contextual loading panels for asynchronous Settings sections', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const style = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('function settingsPanelLoadingState');
    expect(source).toContain('settings-panel-loading');
    expect(source).toContain('Loading API token inventory');
    expect(source).toContain(
      'Checking external access tokens before you create, revoke, or rotate credentials.',
    );
    expect(source).toContain('Loading report automation settings');
    expect(source).toContain(
      'Fetching briefing cadence, source scope, format, and approval rules for recurring summaries.',
    );
    expect(source).toContain('Loading optional workspace plugins');
    expect(source).toContain(
      'Checking which extension surfaces are installed and whether they are enabled.',
    );
    expect(source).toContain('Loading two-factor status');
    expect(source).toContain(
      'Confirming whether unattended work is protected by a second factor.',
    );
    expect(source).toContain('Loading global personality context');
    expect(source).toContain(
      'personal operating instructions that follow Copilot, Cowork, Code, and channel agents.',
    );
    expect(source).toContain('Loading memory and skill provenance');
    expect(source).toContain(
      'Reviewing what changed across personal memory, approved learning, and reusable skills.',
    );
    expect(source).not.toContain(
      '<div id="tokens-list" class="settings-token-list"><div class="empty">Loading...</div></div>',
    );
    expect(source).not.toContain(
      '<div id="report-config-area"><div class="empty">Loading...</div></div>',
    );
    expect(source).not.toContain(
      '<div id="plugins-list"><div class="empty">Loading...</div></div>',
    );
    expect(source).not.toContain(
      '<div id="2fa-area"><div class="empty">Loading...</div></div>',
    );
    expect(source).not.toContain(
      '<div id="personality-area"><div class="empty">Loading...</div></div>',
    );
    expect(source).not.toContain(
      '<div id="provenance-timeline"><div class="empty">Loading...</div></div>',
    );
    expect(style).toContain('.settings-panel-loading');
    expect(style).toContain('.settings-panel-loading::after');
    expect(style).toContain('@keyframes settingsPanelLoadingSweep');
    expect(style).toContain('.settings-panel-loading.is-security');
    expect(style).toContain('.settings-panel-loading.is-reports');
    expect(style).toContain('.settings-panel-loading.is-personal');
  });

  it('uses specific recovery copy for Settings action failures', () => {
    const source = fs.readFileSync(settingsPagePath, 'utf8');
    const start = source.indexOf('function settingsActionErrorMessage');
    const end = source.indexOf('window.selectProvider', start);
    const actionBlock = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(actionBlock).toContain('Provider was not changed');
    expect(actionBlock).toContain('Provider profile was not saved');
    expect(actionBlock).toContain('Plugin setting was not changed');
    expect(actionBlock).toContain('2FA was not disabled');
    expect(actionBlock).toContain('Message was not pinned');
    expect(actionBlock).toContain('Message was not unpinned');
    expect(actionBlock).toContain('API token was not created');
    expect(actionBlock).toContain(
      'whether this integration should use Credentials or MCP access instead',
    );
    expect(source).toContain("settingsActionErrorMessage('provider'");
    expect(source).toContain("settingsActionErrorMessage('profile'");
    expect(source).toContain("settingsActionErrorMessage('plugin'");
    expect(source).toContain("settingsActionErrorMessage('2fa-disable'");
    expect(source).toContain("settingsActionErrorMessage('pin'");
    expect(source).toContain("settingsActionErrorMessage('unpin'");
    expect(source).toContain("settingsActionErrorMessage('token-create'");
    expect(source).not.toContain("toast(r.error || 'Failed'");
    expect(source).not.toContain("toast(res.error || 'Failed");
    expect(source).not.toContain("toast('Failed: ' + e.message");
    expect(source).not.toContain("toast(r.error || 'Failed to pin'");
    expect(source).not.toContain("toast(r.error || 'Failed to unpin'");
  });

  it('styles the personal command center responsively', () => {
    const source = fs.readFileSync(stylePath, 'utf8');

    expect(source).toContain('.settings-command-center');
    expect(source).toContain('.settings-command-stats');
    expect(source).toContain('.settings-quick-panel');
    expect(source).toContain('.settings-quick-link:focus-visible');
    expect(source).toContain('.settings-focus-map');
    expect(source).toContain('.settings-focus-grid');
    expect(source).toContain('.settings-focus-card.is-code::before');
    expect(source).toContain('.settings-profile-card');
    expect(source).toContain('.settings-profile-grid');
    expect(source).toContain('.settings-profile-metric');
    expect(source).toContain('.settings-provider-option');
    expect(source).toContain('.settings-provider-profiles-card');
    expect(source).toContain('.settings-skill-family-row');
    expect(source).toContain('.settings-agent-boundary-card');
    expect(source).toContain('.settings-diagnostics-card');
    expect(source).toContain('.settings-users-card');
    expect(source).toContain('.settings-plugin-row');
    expect(source).toContain('.settings-about-card');
    expect(source).toContain('.settings-personality-editor');
    expect(source).toContain('.settings-provenance-row');
    expect(source).toContain('.settings-token-row');
    expect(source).toContain('.settings-report-grid');
    expect(source).toContain('.settings-2fa-state');
    expect(source).toContain('.settings-2fa-setup-panel');
    expect(source).toContain('.settings-2fa-code');
    expect(source).toContain(
      '.settings-command-stats,\n  .settings-quick-panel,\n  .settings-focus-grid,\n  .settings-delegation-grid,\n  .settings-profile-card,\n  .settings-profile-grid,\n  .settings-account-grid,\n  .settings-personality-error-state,\n  .settings-panel-loading,\n  .settings-plugin-empty-state,\n  .settings-plugin-error-state,\n  .settings-provenance-empty-state,\n  .settings-provenance-error-state,\n  .settings-token-empty-state,\n  .settings-token-error-state,\n  .settings-report-error-state,\n  .settings-report-grid,\n  .settings-2fa-setup-panel {\n    grid-template-columns: 1fr;',
    );
  });
});
