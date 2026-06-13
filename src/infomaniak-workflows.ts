import fs from 'fs';
import path from 'path';

import type { ConnectorPermission } from './connector-permissions.js';

export type InfomaniakWorkflowStatus = 'ready' | 'attention' | 'blocked';
export type InfomaniakWorkflowSeverity = 'required' | 'advisory';

export interface InfomaniakWorkflowServer {
  name: string;
  allEnvSet?: boolean;
  envStatus?: Array<{ key: string; isSet: boolean }>;
  permission?: ConnectorPermission;
}

export interface InfomaniakWorkflowPreset {
  name: string;
  installed?: boolean;
}

export interface InfomaniakWorkflowItem {
  id: string;
  label: string;
  status: InfomaniakWorkflowStatus;
  detail: string;
  tools: string[];
  approvalRequired: boolean;
}

export interface InfomaniakWorkflowCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: InfomaniakWorkflowSeverity;
  detail: string;
  hint?: string;
}

export interface InfomaniakWorkflowResult {
  status: InfomaniakWorkflowStatus;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  checks: InfomaniakWorkflowCheck[];
  workflows: InfomaniakWorkflowItem[];
}

export interface BuildInfomaniakWorkflowInput {
  servers: InfomaniakWorkflowServer[];
  presets: InfomaniakWorkflowPreset[];
  skillPath: string;
  now?: Date;
}

const KDRIVE_KEYS = ['INFOMANIAK_TOKEN', 'KDRIVE_ID'];
const DAV_KEYS = ['DAV_USER', 'DAV_PASSWORD'];
const MAIL_KEYS = ['MAIL_USER', 'MAIL_PASSWORD'];

function hasEnv(server: InfomaniakWorkflowServer | undefined, key: string) {
  return !!server?.envStatus?.some(
    (status) => status.key === key && status.isSet,
  );
}

function workflowStatus(
  ok: boolean,
  advisoryOnly = false,
): InfomaniakWorkflowStatus {
  if (ok) return 'ready';
  return advisoryOnly ? 'attention' : 'blocked';
}

function summarize(workflows: InfomaniakWorkflowItem[]) {
  return {
    total: workflows.length,
    ready: workflows.filter((workflow) => workflow.status === 'ready').length,
    attention: workflows.filter((workflow) => workflow.status === 'attention')
      .length,
    blocked: workflows.filter((workflow) => workflow.status === 'blocked')
      .length,
  };
}

export function buildInfomaniakWorkflows(
  input: BuildInfomaniakWorkflowInput,
): InfomaniakWorkflowResult {
  const server = input.servers.find(
    (candidate) => candidate.name === 'infomaniak',
  );
  const preset = input.presets.find(
    (candidate) => candidate.name === 'infomaniak',
  );
  const permission = server?.permission;
  const skillInstalled = fs.existsSync(input.skillPath);
  const presetInstalled = !!server || !!preset?.installed;
  const kdriveReady = KDRIVE_KEYS.every((key) => hasEnv(server, key));
  const davReady = DAV_KEYS.every((key) => hasEnv(server, key));
  const mailReady = MAIL_KEYS.every((key) => hasEnv(server, key));
  const readAllowed =
    !!permission &&
    permission.allowedActions.some(
      (action) =>
        action === '*' || action.includes('read') || action === 'tools.expose',
    );
  const writesApprovalGated = !!permission?.requiresApproval;

  const checks: InfomaniakWorkflowCheck[] = [
    {
      id: 'preset-installed',
      label: 'Infomaniak MCP preset',
      ok: presetInstalled,
      severity: 'required',
      detail: presetInstalled
        ? 'Infomaniak kSuite MCP server is installed'
        : 'Infomaniak kSuite MCP server is not installed',
      hint: 'Install the Infomaniak kSuite preset from MCP Servers',
    },
    {
      id: 'kdrive-credentials',
      label: 'kDrive credentials',
      ok: kdriveReady,
      severity: 'required',
      detail: kdriveReady
        ? 'INFOMANIAK_TOKEN and KDRIVE_ID are configured'
        : 'INFOMANIAK_TOKEN or KDRIVE_ID is missing',
      hint: 'Add Infomaniak API token and kDrive ID in Credentials',
    },
    {
      id: 'dav-credentials',
      label: 'DAV credentials',
      ok: davReady,
      severity: 'advisory',
      detail: davReady
        ? 'DAV credentials are configured for contacts and calendars'
        : 'DAV credentials are missing',
      hint: 'Add DAV_USER and DAV_PASSWORD to enable contact/calendar workflows',
    },
    {
      id: 'mail-credentials',
      label: 'Mail credentials',
      ok: mailReady,
      severity: 'advisory',
      detail: mailReady
        ? 'Mail credentials are configured'
        : 'Mail credentials are missing',
      hint: 'Add MAIL_USER and MAIL_PASSWORD to use mail-backed document workflows',
    },
    {
      id: 'connector-permission',
      label: 'Connector permission',
      ok: readAllowed,
      severity: 'required',
      detail: readAllowed
        ? 'Read/tool exposure actions are allowed for the connector scope'
        : 'Connector read/tool exposure actions are not allowed',
      hint: 'Allow *.read and tools.expose for the Infomaniak connector',
    },
    {
      id: 'write-approval',
      label: 'Write approval gate',
      ok: writesApprovalGated,
      severity: 'required',
      detail: writesApprovalGated
        ? 'Write-capable workflows require approval'
        : 'Write-capable workflows are not approval gated',
      hint: 'Keep requiresApproval enabled for upload, share, delete, and outbound mail actions',
    },
    {
      id: 'skill-installed',
      label: 'Agent skill',
      ok: skillInstalled,
      severity: 'advisory',
      detail: skillInstalled
        ? 'infomaniak-ksuite skill is available to agents'
        : 'infomaniak-ksuite skill is missing',
      hint: 'Install or restore the bundled infomaniak-ksuite skill',
    },
  ];

  const documentReadReady = presetInstalled && kdriveReady && readAllowed;
  const workflows: InfomaniakWorkflowItem[] = [
    {
      id: 'kdrive-search-read',
      label: 'Search and summarize kDrive documents',
      status: workflowStatus(documentReadReady),
      detail: documentReadReady
        ? 'Agents can find approved kDrive sources and summarize them'
        : 'Install the preset, configure kDrive credentials, and allow read tools',
      tools: ['mcp__infomaniak__*', 'infomaniak-ksuite'],
      approvalRequired: false,
    },
    {
      id: 'document-draft',
      label: 'Draft reports from approved kDrive sources',
      status: workflowStatus(documentReadReady && skillInstalled),
      detail:
        documentReadReady && skillInstalled
          ? 'Document drafts can combine approved kDrive sources with report skills'
          : 'Requires kDrive read readiness and the bundled Infomaniak skill',
      tools: ['mcp__infomaniak__*', 'report-writer', 'docx-generation'],
      approvalRequired: false,
    },
    {
      id: 'upload-share',
      label: 'Upload or share document deliverables',
      status: workflowStatus(documentReadReady && writesApprovalGated),
      detail:
        documentReadReady && writesApprovalGated
          ? 'Write-capable kDrive actions are available behind approval'
          : 'Requires kDrive readiness with write actions kept approval gated',
      tools: ['mcp__infomaniak__*'],
      approvalRequired: true,
    },
    {
      id: 'dav-context',
      label: 'Use DAV contacts and calendar context',
      status: workflowStatus(davReady && readAllowed, true),
      detail:
        davReady && readAllowed
          ? 'DAV credentials can support contact and calendar context'
          : 'DAV-backed context is optional and currently incomplete',
      tools: ['mcp__infomaniak__*', 'meeting-briefing'],
      approvalRequired: false,
    },
    {
      id: 'mail-context',
      label: 'Use mail as document context',
      status: workflowStatus(mailReady && readAllowed, true),
      detail:
        mailReady && readAllowed
          ? 'Mail credentials can support inbox/document context workflows'
          : 'Mail-backed document context is optional and currently incomplete',
      tools: ['mcp__infomaniak__*', 'email-assistant'],
      approvalRequired: false,
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

export function infomaniakSkillPath(projectRoot = process.cwd()): string {
  return path.join(
    projectRoot,
    'container',
    'skills',
    'infomaniak-ksuite',
    'SKILL.md',
  );
}
