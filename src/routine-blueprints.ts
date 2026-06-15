import fs from 'fs';
import path from 'path';

import { CONTAINER_SKILLS_DIR } from './config.js';
import type { ScheduledTask } from './types.js';

export type RoutineBlueprintType =
  | 'briefing'
  | 'email'
  | 'monitor'
  | 'github'
  | 'release'
  | 'heartbeat'
  | 'operation';

export type RoutineScriptMode = 'none' | 'gate';

export interface RoutineHeartbeatPolicy {
  quietHours?: {
    start: string;
    end: string;
  };
  activeHours?: {
    start: string;
    end: string;
  };
  staleAfterMinutes?: number;
}

export interface RoutineBlueprint {
  id: string;
  title: string;
  description: string;
  routineType: RoutineBlueprintType;
  schedule: {
    type: ScheduledTask['schedule_type'];
    value: string;
    label: string;
  };
  prompt: string;
  script?: string;
  scriptMode: RoutineScriptMode;
  contextMode: ScheduledTask['context_mode'];
  deliveryMode: NonNullable<ScheduledTask['delivery_mode']>;
  deliveryTarget?: string;
  silentMarker?: string;
  sessionKey?: string;
  providerProfileId: string;
  toolPolicy: string;
  skills: string[];
  contextTaskIds: string[];
  maxRuntimeMs?: number;
  maxActiveRuns?: number;
  heartbeatPolicy?: RoutineHeartbeatPolicy;
  requiredConnectors: string[];
  tags: string[];
}

const SCRIPT_GATE_HEALTH_CHECK = `#!/usr/bin/env bash
set -euo pipefail

echo '{"wakeAgent": true, "data": {"check": "system health", "source": "routine blueprint"}}'
`;

const BLUEPRINTS: RoutineBlueprint[] = [
  {
    id: 'daily-briefing',
    title: 'Daily briefing',
    description:
      'Summarize calendar, email, messages, memory, journal, and open tasks.',
    routineType: 'briefing',
    schedule: {
      type: 'cron',
      value: '0 8 * * 1-5',
      label: 'Weekdays at 08:00',
    },
    prompt:
      'Prepare a concise morning briefing from calendar, email, messages, memory, journal events, and recent task results. Highlight risks, decisions, waiting items, and the next three useful actions.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'daily-briefing',
    providerProfileId: 'default_reports',
    toolPolicy: 'dry-run',
    skills: ['calendar-assistant', 'email-assistant', 'meeting-briefing'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    requiredConnectors: ['calendar', 'email'],
    tags: ['briefing', 'daily', 'operations'],
  },
  {
    id: 'email-triage',
    title: 'Email triage',
    description:
      'Categorize urgent inbox items and draft responses for anything that needs attention.',
    routineType: 'email',
    schedule: {
      type: 'cron',
      value: '0 17 * * 1-5',
      label: 'Weekdays at 17:00',
    },
    prompt:
      'Review recent inbox items, categorize urgent and waiting messages, draft suggested replies for anything important, and do not send external email without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'email-triage',
    providerProfileId: 'default_automation',
    toolPolicy: 'approval-required',
    skills: ['email-assistant', 'inbox-triage'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    requiredConnectors: ['email'],
    tags: ['email', 'triage', 'inbox'],
  },
  {
    id: 'heartbeat-health-check',
    title: 'System health check',
    description:
      'Run a script-gated health check and only wake the agent when the script reports something worth reviewing.',
    routineType: 'heartbeat',
    schedule: {
      type: 'interval',
      value: '3600000',
      label: 'Every hour',
    },
    prompt:
      'Review the script output and summarize system health, outages, stale files, errors, and the next recommended operator action.',
    script: SCRIPT_GATE_HEALTH_CHECK,
    scriptMode: 'gate',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    silentMarker: 'HEARTBEAT_OK',
    sessionKey: 'heartbeat-health-check',
    providerProfileId: 'default_automation',
    toolPolicy: 'dry-run',
    skills: ['incident-analyst'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    heartbeatPolicy: {
      quietHours: { start: '22:00', end: '07:00' },
      staleAfterMinutes: 120,
    },
    requiredConnectors: [],
    tags: ['heartbeat', 'health', 'monitor'],
  },
  {
    id: 'issue-triage',
    title: 'Issue triage',
    description:
      'Review incoming GitHub issues, flag duplicates, identify P0/P1 candidates, and suggest coding-job handoffs.',
    routineType: 'github',
    schedule: {
      type: 'cron',
      value: '30 8 * * 1-5',
      label: 'Weekdays at 08:30',
    },
    prompt:
      'Review new and recently updated GitHub issues. Categorize bugs, feature requests, duplicates, blocked issues, and P0/P1 candidates. Suggest which issue NanoCrab should pick up next, but do not start coding jobs without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'issue-triage',
    providerProfileId: 'default_automation',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'github-issue-agent'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    requiredConnectors: ['github'],
    tags: ['github', 'issues', 'triage'],
  },
  {
    id: 'github-auto-pick-review',
    title: 'GitHub auto-pick review',
    description:
      'Review labeled issues and recommend which Autofix project should pick up next.',
    routineType: 'github',
    schedule: {
      type: 'cron',
      value: '15 9 * * 1-5',
      label: 'Weekdays at 09:15',
    },
    prompt:
      'Review open GitHub issues matching Autofix labels. Identify duplicates, blocked work, missing context, and the best next issue for NanoCrab to pick up. Do not start coding jobs unless explicitly approved or the Autofix project auto-pick setting is enabled.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'github-auto-pick-review',
    providerProfileId: 'default_automation',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'github-issue-agent'],
    contextTaskIds: ['issue-triage'],
    maxActiveRuns: 1,
    maxRuntimeMs: 180000,
    requiredConnectors: ['github'],
    tags: ['github', 'autofix', 'issues'],
  },
  {
    id: 'pr-review-digest',
    title: 'PR review digest',
    description:
      'Summarize open pull requests, stale reviews, CI state, and what needs attention.',
    routineType: 'github',
    schedule: {
      type: 'cron',
      value: '0 15 * * 1-5',
      label: 'Weekdays at 15:00',
    },
    prompt:
      'Review open pull requests and summarize review status, CI status, risk, stale threads, and recommended next actions. Do not merge, comment, or request changes without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'pr-review-digest',
    providerProfileId: 'default_automation',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'code-reviewer'],
    contextTaskIds: ['issue-triage'],
    maxActiveRuns: 1,
    requiredConnectors: ['github'],
    tags: ['github', 'pull-requests', 'digest'],
  },
  {
    id: 'dependency-update-check',
    title: 'Dependency update check',
    description:
      'Scan for outdated packages, security patches, and likely breaking changes.',
    routineType: 'monitor',
    schedule: {
      type: 'cron',
      value: '30 20 * * 1',
      label: 'Mondays at 20:30',
    },
    prompt:
      'Check configured repositories for outdated dependencies, security advisories, lockfile drift, and risky breaking changes. Summarize recommended update order and tests to run.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'dependency-update-check',
    providerProfileId: 'default_coding',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'security-reviewer'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    requiredConnectors: ['github'],
    tags: ['dependencies', 'security', 'maintenance'],
  },
  {
    id: 'dependency-security-watch',
    title: 'Dependency security watch',
    description:
      'Monitor dependency advisories, vulnerable packages, and urgent patch candidates without opening PRs automatically.',
    routineType: 'monitor',
    schedule: {
      type: 'cron',
      value: '0 9 * * 1-5',
      label: 'Weekdays at 09:00',
    },
    prompt:
      'Review dependency advisories, lockfile changes, package manager audit output, and repository security alerts. Prioritize urgent fixes, identify likely breaking updates, and suggest which items should become coding jobs. Do not open PRs or change files without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'dependency-security-watch',
    providerProfileId: 'default_coding',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'security-reviewer'],
    contextTaskIds: ['dependency-update-check'],
    maxActiveRuns: 1,
    maxRuntimeMs: 180000,
    requiredConnectors: ['github'],
    tags: ['dependencies', 'security', 'alerts'],
  },
  {
    id: 'flaky-test-tracker',
    title: 'Flaky test tracker',
    description:
      'Find intermittently failing tests across recent CI runs and suggest isolation or quarantine follow-up.',
    routineType: 'monitor',
    schedule: {
      type: 'cron',
      value: '0 18 * * 1',
      label: 'Mondays at 18:00',
    },
    prompt:
      'Review recent CI runs, failure logs, reruns, and test history. Identify tests that pass and fail intermittently, group by suite, summarize suspected causes, and recommend next debugging actions. Do not disable tests without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'flaky-test-tracker',
    providerProfileId: 'default_coding',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'code-reviewer'],
    contextTaskIds: ['pr-review-digest'],
    maxActiveRuns: 1,
    maxRuntimeMs: 180000,
    requiredConnectors: ['github'],
    tags: ['ci', 'tests', 'flaky'],
  },
  {
    id: 'release-notes-drafter',
    title: 'Release notes drafter',
    description:
      'Draft user-facing release notes whenever merged changes are ready to summarize.',
    routineType: 'release',
    schedule: {
      type: 'cron',
      value: '0 9 * * 5',
      label: 'Fridays at 09:00',
    },
    prompt:
      'Review recently merged pull requests and notable commits. Draft concise user-facing release notes with highlights, fixes, upgrade notes, and rollback considerations.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'file',
    deliveryTarget: 'release-notes/latest.md',
    sessionKey: 'release-notes-drafter',
    providerProfileId: 'default_reports',
    toolPolicy: 'dry-run',
    skills: ['github-connector', 'release-manager', 'report-writer'],
    contextTaskIds: ['pr-review-digest'],
    maxActiveRuns: 1,
    requiredConnectors: ['github'],
    tags: ['release', 'notes', 'github'],
  },
  {
    id: 'release-webhook-approval',
    title: 'Release webhook approval',
    description:
      'Prepare release notes for an external webhook, then require explicit approval before delivery.',
    routineType: 'release',
    schedule: {
      type: 'cron',
      value: '30 9 * * 5',
      label: 'Fridays at 09:30',
    },
    prompt:
      'Review recently merged PRs and notable commits. Produce a compact release payload suitable for a webhook subscriber, including highlights, fixes, risks, and rollback notes.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'webhook',
    deliveryTarget: 'https://example.com/hooks/releases',
    sessionKey: 'release-webhook-approval',
    providerProfileId: 'default_reports',
    toolPolicy: 'approval-required',
    skills: ['github-connector', 'release-manager', 'report-writer'],
    contextTaskIds: ['release-notes-drafter'],
    maxActiveRuns: 1,
    maxRuntimeMs: 180000,
    requiredConnectors: ['github'],
    tags: ['release', 'webhook', 'approval'],
  },
  {
    id: 'inbox-sla-monitor',
    title: 'Inbox SLA monitor',
    description:
      'Track urgent unanswered email and message threads before they become stale.',
    routineType: 'email',
    schedule: {
      type: 'cron',
      value: '0 11,16 * * 1-5',
      label: 'Weekdays at 11:00 and 16:00',
    },
    prompt:
      'Review inbox and message threads for urgent unanswered items, approaching deadlines, and stalled commitments. Draft suggested replies or next actions, but do not send messages without approval.',
    scriptMode: 'none',
    contextMode: 'isolated',
    deliveryMode: 'dashboard',
    sessionKey: 'inbox-sla-monitor',
    providerProfileId: 'default_automation',
    toolPolicy: 'approval-required',
    skills: ['email-assistant', 'inbox-triage'],
    contextTaskIds: ['email-triage'],
    maxActiveRuns: 1,
    maxRuntimeMs: 180000,
    requiredConnectors: ['email'],
    tags: ['email', 'sla', 'inbox'],
  },
  {
    id: 'operation-reminder',
    title: 'Operation reminder',
    description:
      'Repeat active operation orders and ask for missing confirmations on a safe preview-first schedule.',
    routineType: 'operation',
    schedule: {
      type: 'interval',
      value: '1800000',
      label: 'Every 30 minutes',
    },
    prompt:
      'Repeat active operation orders, ask for missing confirmations, and keep the message concise and limited to the selected group.',
    scriptMode: 'none',
    contextMode: 'group',
    deliveryMode: 'chat',
    sessionKey: 'operation-reminder',
    providerProfileId: 'default_automation',
    toolPolicy: 'dry-run',
    skills: ['ops-commander'],
    contextTaskIds: [],
    maxActiveRuns: 1,
    requiredConnectors: [],
    tags: ['operations', 'reminder'],
  },
];

function cloneBlueprint(blueprint: RoutineBlueprint): RoutineBlueprint {
  return {
    ...blueprint,
    schedule: { ...blueprint.schedule },
    heartbeatPolicy: blueprint.heartbeatPolicy
      ? {
          ...blueprint.heartbeatPolicy,
          quietHours: blueprint.heartbeatPolicy.quietHours
            ? { ...blueprint.heartbeatPolicy.quietHours }
            : undefined,
          activeHours: blueprint.heartbeatPolicy.activeHours
            ? { ...blueprint.heartbeatPolicy.activeHours }
            : undefined,
        }
      : undefined,
    requiredConnectors: [...blueprint.requiredConnectors],
    contextTaskIds: [...blueprint.contextTaskIds],
    skills: [...blueprint.skills],
    tags: [...blueprint.tags],
  };
}

function isRoutineBlueprint(value: unknown): value is RoutineBlueprint {
  const candidate = value as Partial<RoutineBlueprint>;
  return Boolean(
    candidate &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.description === 'string' &&
    candidate.schedule &&
    typeof candidate.schedule.value === 'string' &&
    typeof candidate.prompt === 'string',
  );
}

function readSkillRoutineBlueprints(): RoutineBlueprint[] {
  try {
    return fs
      .readdirSync(CONTAINER_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const filePath = path.join(
          CONTAINER_SKILLS_DIR,
          entry.name,
          'ROUTINES.json',
        );
        if (!fs.existsSync(filePath)) return [];
        try {
          const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const routines = Array.isArray(parsed) ? parsed : parsed.routines;
          if (!Array.isArray(routines)) return [];
          return routines.filter(isRoutineBlueprint).map(cloneBlueprint);
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function listRoutineBlueprints(): RoutineBlueprint[] {
  return [...BLUEPRINTS.map(cloneBlueprint), ...readSkillRoutineBlueprints()];
}
