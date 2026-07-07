export type ConnectorWorkflowDomain =
  | 'email'
  | 'calendar'
  | 'documents'
  | 'github';
export type ConnectorWorkflowRisk = 'low' | 'medium' | 'high';

export interface ConnectorWorkflow {
  id: string;
  domain: ConnectorWorkflowDomain;
  title: string;
  description: string;
  connectors: string[];
  triggerExamples: string[];
  readScopes: string[];
  writeScopes: string[];
  approvalRequired: boolean;
  risk: ConnectorWorkflowRisk;
  skill: string;
  steps: string[];
}

export const CONNECTOR_WORKFLOWS: ConnectorWorkflow[] = [
  {
    id: 'email-inbox-triage',
    domain: 'email',
    title: 'Inbox triage',
    description:
      'Search recent mail, group messages by urgency, and propose follow-up actions.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: [
      'triage my inbox',
      'what emails need replies',
      'summarize unread mail',
    ],
    readScopes: ['gmail:read', 'mail:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/inbox-triage/SKILL.md',
    steps: [
      'Ask for mailbox, date range, labels, or sender filters when unclear.',
      'Search narrowly and summarize sender, subject, date, and urgency.',
      'Draft reply or follow-up actions separately from sending.',
    ],
  },
  {
    id: 'email-draft-reply',
    domain: 'email',
    title: 'Draft email reply',
    description:
      'Prepare a reply from message context without sending it automatically.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: ['draft a reply', 'prepare an answer to this email'],
    readScopes: ['gmail:read', 'mail:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/inbox-triage/SKILL.md',
    steps: [
      'Read only the requested thread or message.',
      'Draft a concise response and call out assumptions.',
      'Ask before saving, sending, forwarding, archiving, or moving mail.',
    ],
  },
  {
    id: 'email-send-approved',
    domain: 'email',
    title: 'Send approved email',
    description:
      'Send, forward, archive, label, or move mail only after explicit approval.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: ['send this email', 'forward this to accounting'],
    readScopes: ['gmail:read', 'mail:read'],
    writeScopes: ['gmail:send', 'mail:send'],
    approvalRequired: true,
    risk: 'high',
    skill: 'container/skills/connector-operator/SKILL.md',
    steps: [
      'Show recipient, subject, body, attachments, and account before action.',
      'Request explicit approval for the exact send or mailbox mutation.',
      'After sending, report message id or connector confirmation when available.',
    ],
  },
  {
    id: 'calendar-availability-review',
    domain: 'calendar',
    title: 'Availability review',
    description:
      'Read calendar availability for a bounded date range and summarize open slots.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: ['check my calendar tomorrow', 'when am I free Friday'],
    readScopes: ['calendar:read', 'dav:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/calendar-assistant/SKILL.md',
    steps: [
      'Confirm timezone, date range, and calendar when unclear.',
      'Read only the requested window.',
      'Summarize busy/free blocks without exposing private event details unnecessarily.',
    ],
  },
  {
    id: 'calendar-meeting-brief',
    domain: 'calendar',
    title: 'Meeting preparation',
    description:
      'Prepare agendas and context from calendar events, memory, documents, and recent decisions.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: [
      'prepare me for this meeting',
      'make an agenda for my next call',
    ],
    readScopes: ['calendar:read', 'dav:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/meeting-briefing/SKILL.md',
    steps: [
      'Identify event, attendees, purpose, and desired output.',
      'Gather approved context and cite sources when possible.',
      'Provide agenda, risks, open questions, and follow-up suggestions.',
    ],
  },
  {
    id: 'calendar-event-change-approved',
    domain: 'calendar',
    title: 'Create or change calendar event',
    description:
      'Create, move, delete, or invite attendees only after explicit approval.',
    connectors: ['google-workspace', 'infomaniak'],
    triggerExamples: ['schedule a meeting', 'move this event', 'invite Alex'],
    readScopes: ['calendar:read', 'dav:read'],
    writeScopes: ['calendar:write', 'dav:write'],
    approvalRequired: true,
    risk: 'high',
    skill: 'container/skills/connector-operator/SKILL.md',
    steps: [
      'Show calendar, title, time, attendees, location, and description before action.',
      'Ask for approval for the exact create, move, delete, or invite operation.',
      'After the change, report connector confirmation and any attendee impact.',
    ],
  },
  {
    id: 'kdrive-file-search',
    domain: 'documents',
    title: 'kDrive file search',
    description:
      'Find files in kDrive and summarize metadata before reading document contents.',
    connectors: ['infomaniak'],
    triggerExamples: [
      'find the latest contract in kDrive',
      'search kDrive for invoices',
    ],
    readScopes: ['kdrive:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/infomaniak-ksuite/SKILL.md',
    steps: [
      'Ask for folder, filename, date, or owner filters when unclear.',
      'List candidate files with names, dates, and paths.',
      'Read contents only for the selected file or clearly relevant matches.',
    ],
  },
  {
    id: 'kdrive-document-report',
    domain: 'documents',
    title: 'Document-backed report',
    description:
      'Prepare reports or summaries from approved kDrive document sources.',
    connectors: ['infomaniak'],
    triggerExamples: [
      'summarize this kDrive folder',
      'make a report from these files',
    ],
    readScopes: ['kdrive:read'],
    writeScopes: [],
    approvalRequired: false,
    risk: 'medium',
    skill: 'container/skills/report-writer/SKILL.md',
    steps: [
      'Confirm source files and report audience.',
      'Extract and cite source filenames or paths.',
      'Draft locally before any upload, share, or delivery action.',
    ],
  },
  {
    id: 'kdrive-write-approved',
    domain: 'documents',
    title: 'Upload, move, or share kDrive file',
    description:
      'Upload, move, rename, delete, or share kDrive files only after explicit approval.',
    connectors: ['infomaniak'],
    triggerExamples: ['upload this report to kDrive', 'share this folder'],
    readScopes: ['kdrive:read'],
    writeScopes: ['kdrive:write'],
    approvalRequired: true,
    risk: 'high',
    skill: 'container/skills/connector-operator/SKILL.md',
    steps: [
      'Show source file, destination path, share target, and overwrite risk.',
      'Ask for approval for the exact file operation.',
      'After action, report final path, link, or connector confirmation.',
    ],
  },
];

export function listConnectorWorkflows(
  filter: {
    domain?: ConnectorWorkflowDomain;
  } = {},
): ConnectorWorkflow[] {
  return CONNECTOR_WORKFLOWS.filter(
    (workflow) => !filter.domain || workflow.domain === filter.domain,
  );
}
