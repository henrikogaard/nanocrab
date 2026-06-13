import fs from 'fs';
import path from 'path';

import type { ConnectorPermission } from './connector-permissions.js';

export type EmailWorkflowStatus = 'ready' | 'attention' | 'blocked';
export type EmailWorkflowSeverity = 'required' | 'advisory';

export interface EmailWorkflowServer {
  name: string;
  allEnvSet?: boolean;
  envStatus?: Array<{ key: string; isSet: boolean }>;
  permission?: ConnectorPermission;
}

export interface EmailWorkflowItem {
  id: string;
  label: string;
  status: EmailWorkflowStatus;
  detail: string;
  providers: string[];
  approvalRequired: boolean;
}

export interface EmailWorkflowCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: EmailWorkflowSeverity;
  detail: string;
  hint?: string;
}

export interface EmailWorkflowResult {
  status: EmailWorkflowStatus;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  checks: EmailWorkflowCheck[];
  workflows: EmailWorkflowItem[];
}

export interface BuildEmailWorkflowInput {
  servers: EmailWorkflowServer[];
  emailSkillPath: string;
  inboxTriageSkillPath: string;
  now?: Date;
}

const GOOGLE_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];
const INFOMANIAK_MAIL_KEYS = ['MAIL_USER', 'MAIL_PASSWORD'];

function hasEnv(server: EmailWorkflowServer | undefined, key: string) {
  return !!server?.envStatus?.some(
    (status) => status.key === key && status.isSet,
  );
}

function hasReadPermission(server: EmailWorkflowServer | undefined) {
  const actions = server?.permission?.allowedActions || [];
  return actions.some(
    (action) =>
      action === '*' || action.includes('read') || action === 'tools.expose',
  );
}

function approvalGated(server: EmailWorkflowServer | undefined) {
  return !server || !!server.permission?.requiresApproval;
}

function status(ok: boolean, advisoryOnly = false): EmailWorkflowStatus {
  if (ok) return 'ready';
  return advisoryOnly ? 'attention' : 'blocked';
}

function summarize(workflows: EmailWorkflowItem[]) {
  return {
    total: workflows.length,
    ready: workflows.filter((workflow) => workflow.status === 'ready').length,
    attention: workflows.filter((workflow) => workflow.status === 'attention')
      .length,
    blocked: workflows.filter((workflow) => workflow.status === 'blocked')
      .length,
  };
}

export function buildEmailWorkflows(
  input: BuildEmailWorkflowInput,
): EmailWorkflowResult {
  const google = input.servers.find(
    (server) => server.name === 'google-workspace',
  );
  const infomaniak = input.servers.find(
    (server) => server.name === 'infomaniak',
  );
  const googleReady =
    !!google &&
    GOOGLE_KEYS.every((key) => hasEnv(google, key)) &&
    hasReadPermission(google);
  const infomaniakReady =
    !!infomaniak &&
    INFOMANIAK_MAIL_KEYS.every((key) => hasEnv(infomaniak, key)) &&
    hasReadPermission(infomaniak);
  const anyEmailReadReady = googleReady || infomaniakReady;
  const writeApprovalReady = approvalGated(google) && approvalGated(infomaniak);
  const emailSkill = fs.existsSync(input.emailSkillPath);
  const inboxSkill = fs.existsSync(input.inboxTriageSkillPath);
  const readyProviders = [
    googleReady ? 'Gmail' : null,
    infomaniakReady ? 'Infomaniak Mail' : null,
  ].filter((provider): provider is string => !!provider);

  const checks: EmailWorkflowCheck[] = [
    {
      id: 'email-provider',
      label: 'Email provider',
      ok: anyEmailReadReady,
      severity: 'required',
      detail: anyEmailReadReady
        ? `${readyProviders.join(' and ')} ready for email reads`
        : 'No email provider is ready',
      hint: 'Configure Google Workspace Gmail credentials or Infomaniak mail credentials with read tool exposure',
    },
    {
      id: 'gmail',
      label: 'Gmail',
      ok: googleReady,
      severity: 'advisory',
      detail: googleReady
        ? 'Google Workspace Gmail credentials and read permissions are ready'
        : 'Google Workspace Gmail is not ready',
      hint: 'Configure Google OAuth credentials and the google-workspace MCP server',
    },
    {
      id: 'infomaniak-mail',
      label: 'Infomaniak Mail',
      ok: infomaniakReady,
      severity: 'advisory',
      detail: infomaniakReady
        ? 'Infomaniak mail credentials and read permissions are ready'
        : 'Infomaniak mail is not ready',
      hint: 'Configure MAIL_USER and MAIL_PASSWORD on the Infomaniak MCP preset',
    },
    {
      id: 'write-approval',
      label: 'Email write approval',
      ok: writeApprovalReady,
      severity: 'required',
      detail: writeApprovalReady
        ? 'Email sends and mailbox mutations are approval gated'
        : 'At least one email connector allows writes without approval',
      hint: 'Keep requiresApproval enabled for send, reply, forward, delete, archive, and label actions',
    },
    {
      id: 'email-skill',
      label: 'Email assistant skill',
      ok: emailSkill,
      severity: 'required',
      detail: emailSkill
        ? 'email-assistant skill is available'
        : 'email-assistant skill is missing',
      hint: 'Restore the bundled email-assistant skill',
    },
    {
      id: 'inbox-triage-skill',
      label: 'Inbox triage skill',
      ok: inboxSkill,
      severity: 'advisory',
      detail: inboxSkill
        ? 'inbox-triage skill is available'
        : 'inbox-triage skill is missing',
      hint: 'Restore the bundled inbox-triage skill for cleanup workflows',
    },
  ];

  const workflows: EmailWorkflowItem[] = [
    {
      id: 'mail-search-summary',
      label: 'Search and summarize mail',
      status: status(anyEmailReadReady && emailSkill),
      detail:
        anyEmailReadReady && emailSkill
          ? 'Agents can search mail narrowly and summarize relevant threads'
          : 'Requires a ready email provider and email assistant skill',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'inbox-triage',
      label: 'Triage inboxes',
      status: status(anyEmailReadReady && emailSkill && inboxSkill, true),
      detail:
        anyEmailReadReady && emailSkill && inboxSkill
          ? 'Agents can group mail into urgent, waiting, FYI, reply-needed, and follow-up buckets'
          : 'Inbox triage needs email read access and the inbox-triage skill',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'reply-draft',
      label: 'Draft replies and follow-ups',
      status: status(anyEmailReadReady && emailSkill),
      detail:
        anyEmailReadReady && emailSkill
          ? 'Agents can draft replies without sending them'
          : 'Requires email read access and the email assistant skill',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'send-reply',
      label: 'Send or reply to email',
      status: status(anyEmailReadReady && emailSkill && writeApprovalReady),
      detail:
        anyEmailReadReady && emailSkill && writeApprovalReady
          ? 'Outbound mail is available behind explicit approval'
          : 'Sending requires email readiness and approval gates',
      providers: readyProviders,
      approvalRequired: true,
    },
    {
      id: 'mailbox-mutation',
      label: 'Archive, label, delete, or move messages',
      status: status(anyEmailReadReady && inboxSkill && writeApprovalReady),
      detail:
        anyEmailReadReady && inboxSkill && writeApprovalReady
          ? 'Mailbox cleanup actions are available behind explicit approval'
          : 'Mailbox mutation needs inbox triage readiness and approval gates',
      providers: readyProviders,
      approvalRequired: true,
    },
  ];

  const summary = summarize(workflows);
  return {
    status:
      summary.blocked > 0
        ? 'blocked'
        : summary.attention > 0
          ? 'attention'
          : 'ready',
    generatedAt: (input.now || new Date()).toISOString(),
    summary,
    checks,
    workflows,
  };
}

export function emailSkillPath(projectRoot = process.cwd()): string {
  return path.join(
    projectRoot,
    'container',
    'skills',
    'email-assistant',
    'SKILL.md',
  );
}

export function inboxTriageSkillPath(projectRoot = process.cwd()): string {
  return path.join(
    projectRoot,
    'container',
    'skills',
    'inbox-triage',
    'SKILL.md',
  );
}
