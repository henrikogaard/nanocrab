import fs from 'fs';
import path from 'path';

import type { ConnectorPermission } from './connector-permissions.js';

export type CalendarWorkflowStatus = 'ready' | 'attention' | 'blocked';
export type CalendarWorkflowSeverity = 'required' | 'advisory';

export interface CalendarWorkflowServer {
  name: string;
  allEnvSet?: boolean;
  envStatus?: Array<{ key: string; isSet: boolean }>;
  permission?: ConnectorPermission;
}

export interface CalendarWorkflowItem {
  id: string;
  label: string;
  status: CalendarWorkflowStatus;
  detail: string;
  providers: string[];
  approvalRequired: boolean;
}

export interface CalendarWorkflowCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: CalendarWorkflowSeverity;
  detail: string;
  hint?: string;
}

export interface CalendarWorkflowResult {
  status: CalendarWorkflowStatus;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    attention: number;
    blocked: number;
  };
  checks: CalendarWorkflowCheck[];
  workflows: CalendarWorkflowItem[];
}

export interface BuildCalendarWorkflowInput {
  servers: CalendarWorkflowServer[];
  calendarSkillPath: string;
  meetingSkillPath: string;
  now?: Date;
}

const GOOGLE_KEYS = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];
const INFOMANIAK_DAV_KEYS = ['DAV_USER', 'DAV_PASSWORD'];

function hasEnv(server: CalendarWorkflowServer | undefined, key: string) {
  return !!server?.envStatus?.some(
    (status) => status.key === key && status.isSet,
  );
}

function hasReadPermission(server: CalendarWorkflowServer | undefined) {
  const actions = server?.permission?.allowedActions || [];
  return actions.some(
    (action) =>
      action === '*' || action.includes('read') || action === 'tools.expose',
  );
}

function approvalGated(server: CalendarWorkflowServer | undefined) {
  return !server || !!server.permission?.requiresApproval;
}

function summarize(workflows: CalendarWorkflowItem[]) {
  return {
    total: workflows.length,
    ready: workflows.filter((workflow) => workflow.status === 'ready').length,
    attention: workflows.filter((workflow) => workflow.status === 'attention')
      .length,
    blocked: workflows.filter((workflow) => workflow.status === 'blocked')
      .length,
  };
}

function status(ok: boolean, advisoryOnly = false): CalendarWorkflowStatus {
  if (ok) return 'ready';
  return advisoryOnly ? 'attention' : 'blocked';
}

export function buildCalendarWorkflows(
  input: BuildCalendarWorkflowInput,
): CalendarWorkflowResult {
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
  const infomaniakDavReady =
    !!infomaniak &&
    INFOMANIAK_DAV_KEYS.every((key) => hasEnv(infomaniak, key)) &&
    hasReadPermission(infomaniak);
  const anyCalendarReadReady = googleReady || infomaniakDavReady;
  const writeApprovalReady = approvalGated(google) && approvalGated(infomaniak);
  const calendarSkill = fs.existsSync(input.calendarSkillPath);
  const meetingSkill = fs.existsSync(input.meetingSkillPath);
  const readyProviders = [
    googleReady ? 'Google Calendar' : null,
    infomaniakDavReady ? 'Infomaniak DAV' : null,
  ].filter((provider): provider is string => !!provider);

  const checks: CalendarWorkflowCheck[] = [
    {
      id: 'calendar-provider',
      label: 'Calendar provider',
      ok: anyCalendarReadReady,
      severity: 'required',
      detail: anyCalendarReadReady
        ? `${readyProviders.join(' and ')} ready for calendar reads`
        : 'No calendar provider is ready',
      hint: 'Configure Google Workspace calendar credentials or Infomaniak DAV credentials with read tool exposure',
    },
    {
      id: 'google-calendar',
      label: 'Google Calendar',
      ok: googleReady,
      severity: 'advisory',
      detail: googleReady
        ? 'Google Workspace calendar credentials and read permissions are ready'
        : 'Google Workspace calendar is not ready',
      hint: 'Configure Google OAuth credentials and the google-workspace MCP server',
    },
    {
      id: 'infomaniak-dav',
      label: 'Infomaniak DAV calendar',
      ok: infomaniakDavReady,
      severity: 'advisory',
      detail: infomaniakDavReady
        ? 'Infomaniak DAV credentials and read permissions are ready'
        : 'Infomaniak DAV calendar is not ready',
      hint: 'Configure DAV_USER and DAV_PASSWORD on the Infomaniak MCP preset',
    },
    {
      id: 'write-approval',
      label: 'Calendar write approval',
      ok: writeApprovalReady,
      severity: 'required',
      detail: writeApprovalReady
        ? 'Calendar writes are approval gated'
        : 'At least one calendar connector allows writes without approval',
      hint: 'Keep requiresApproval enabled for create, update, delete, invite, and reschedule actions',
    },
    {
      id: 'calendar-skill',
      label: 'Calendar assistant skill',
      ok: calendarSkill,
      severity: 'required',
      detail: calendarSkill
        ? 'calendar-assistant skill is available'
        : 'calendar-assistant skill is missing',
      hint: 'Restore the bundled calendar-assistant skill',
    },
    {
      id: 'meeting-briefing-skill',
      label: 'Meeting briefing skill',
      ok: meetingSkill,
      severity: 'advisory',
      detail: meetingSkill
        ? 'meeting-briefing skill is available'
        : 'meeting-briefing skill is missing',
      hint: 'Restore the bundled meeting-briefing skill for richer meeting prep',
    },
  ];

  const workflows: CalendarWorkflowItem[] = [
    {
      id: 'agenda-review',
      label: 'Review upcoming agenda',
      status: status(anyCalendarReadReady && calendarSkill),
      detail:
        anyCalendarReadReady && calendarSkill
          ? 'Agents can list upcoming calendar events and summarize the day'
          : 'Requires a ready calendar provider and calendar skill',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'availability',
      label: 'Check availability and conflicts',
      status: status(anyCalendarReadReady && calendarSkill),
      detail:
        anyCalendarReadReady && calendarSkill
          ? 'Agents can inspect availability and identify conflicts'
          : 'Requires calendar read access',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'meeting-briefing',
      label: 'Prepare meeting briefings',
      status: status(
        anyCalendarReadReady && calendarSkill && meetingSkill,
        true,
      ),
      detail:
        anyCalendarReadReady && calendarSkill && meetingSkill
          ? 'Agents can combine calendar events with memory, chat, and documents'
          : 'Meeting briefings need calendar read access and the briefing skill',
      providers: readyProviders,
      approvalRequired: false,
    },
    {
      id: 'schedule-change',
      label: 'Create, update, or delete events',
      status: status(
        anyCalendarReadReady && calendarSkill && writeApprovalReady,
      ),
      detail:
        anyCalendarReadReady && calendarSkill && writeApprovalReady
          ? 'Calendar mutations are available behind explicit approval'
          : 'Calendar write workflows require readiness plus approval gates',
      providers: readyProviders,
      approvalRequired: true,
    },
    {
      id: 'follow-up-reminders',
      label: 'Create follow-up reminders',
      status: status(
        anyCalendarReadReady && calendarSkill && writeApprovalReady,
      ),
      detail:
        anyCalendarReadReady && calendarSkill && writeApprovalReady
          ? 'Agents can propose reminders after approved meeting context'
          : 'Reminder creation requires calendar readiness and approval gates',
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

export function calendarSkillPath(projectRoot = process.cwd()): string {
  return path.join(
    projectRoot,
    'container',
    'skills',
    'calendar-assistant',
    'SKILL.md',
  );
}

export function meetingBriefingSkillPath(projectRoot = process.cwd()): string {
  return path.join(
    projectRoot,
    'container',
    'skills',
    'meeting-briefing',
    'SKILL.md',
  );
}
