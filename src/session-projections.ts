import type { JournalEntryRecord } from './types.js';
import type { LearningProposal } from './learning-loop.js';

export type SessionProjectionReason =
  | 'recorded'
  | 'not_recorded'
  | 'redacted'
  | 'unsupported';
export type SessionProjectionProvenance =
  | 'transcript'
  | 'conversation'
  | 'plan'
  | 'memory'
  | 'skill'
  | 'journal';
export type SessionProjectionSensitivity =
  | 'normal'
  | 'sensitive'
  | 'secret-note';

export interface SessionProjection<T> {
  available: boolean;
  reason: SessionProjectionReason;
  items: T[];
}

export interface SessionConversationMessage {
  id: string;
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provenance: 'transcript';
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionPlanTask {
  id: string;
  timestamp: string;
  title: string;
  detail: string;
  status: string;
  provenance: 'transcript';
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionMemoryProposal {
  id: string;
  type: 'memory';
  status: string;
  summary: string;
  scope: string;
  confidence: number;
  createdAt: string;
  provenance: 'memory';
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionSkillProposal {
  id: string;
  type: 'skill-draft';
  status: string;
  summary: string;
  scope: string;
  confidence: number;
  createdAt: string;
  provenance: 'skill';
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionJournalEvent {
  id: string;
  timestamp: string;
  title: string;
  summary: string;
  tags: string[];
  provenance: 'journal';
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionTimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  detail: string;
  provenance: SessionProjectionProvenance;
  sensitivity: SessionProjectionSensitivity;
}

export interface SessionProjections {
  conversation: SessionProjection<SessionConversationMessage>;
  plan: SessionProjection<SessionPlanTask>;
  memoryProposals: SessionProjection<SessionMemoryProposal>;
  skillProposals: SessionProjection<SessionSkillProposal>;
  journalEvents: SessionProjection<SessionJournalEvent>;
  timeline: SessionTimelineEvent[];
}

export interface SessionProjectionInput {
  sessionId: string;
  events: unknown[];
  learningProposals: LearningProposal[];
  journalEntries: JournalEntryRecord[];
}

const MAX_ITEMS = 24;
const MAX_TIMELINE = 120;
const MAX_TEXT = 4000;
const SECRET_SENTINEL = '[REDACTED]';
const PRIVATE_KEY_RE =
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi;
const LABELED_SECRET_RE =
  /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|client[_ -]?secret|secret|authorization)\b\s*(?:=|:)\s*(?:Bearer\s+)?[^\s,;]+/gi;
const KNOWN_CREDENTIAL_RE =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

function timestamp(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sensitivity(value: unknown): SessionProjectionSensitivity {
  return value === 'sensitive' || value === 'secret-note' ? value : 'normal';
}

function redact(value: string): string {
  return value
    .replace(PRIVATE_KEY_RE, SECRET_SENTINEL)
    .replace(LABELED_SECRET_RE, SECRET_SENTINEL)
    .replace(KNOWN_CREDENTIAL_RE, SECRET_SENTINEL)
    .slice(0, MAX_TEXT);
}

function safeSummary(
  value: unknown,
  level: SessionProjectionSensitivity,
): string {
  if (level === 'secret-note') return SECRET_SENTINEL;
  return redact(text(value));
}

function contentBlocks(record: Record<string, any>): Record<string, any>[] {
  if (Array.isArray(record.message?.content)) return record.message.content;
  if (Array.isArray(record.content)) return record.content;
  return [];
}

function extractText(record: Record<string, any>): string {
  if (typeof record.content === 'string') return redact(record.content);
  if (typeof record.message === 'string') return redact(record.message);
  return redact(
    contentBlocks(record)
      .filter(
        (block) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block) => block.text)
      .join('\n'),
  );
}

function projection<T>(items: T[]): SessionProjection<T> {
  return items.length
    ? { available: true, reason: 'recorded', items: items.slice(0, MAX_ITEMS) }
    : { available: false, reason: 'not_recorded', items: [] };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 12)
    : [];
}

function taskRecord(
  value: unknown,
  fallbackTimestamp: string,
  index: number,
): SessionPlanTask | null {
  const record = asRecord(value);
  const title = text(
    record.title || record.name || record.task || record.label,
  );
  if (!title) return null;
  const level = sensitivity(record.sensitivity);
  return {
    id: text(record.id) || `task-${index + 1}`,
    timestamp: timestamp(record.timestamp) || fallbackTimestamp,
    title: safeSummary(title, level),
    detail: safeSummary(
      record.detail || record.description || record.output,
      level,
    ),
    status: text(record.status) || 'pending',
    provenance: 'transcript',
    sensitivity: level,
  };
}

function transcriptTasks(events: unknown[]): SessionPlanTask[] {
  const tasks: SessionPlanTask[] = [];
  events.forEach((event, eventIndex) => {
    const record = asRecord(event);
    const eventTimestamp = timestamp(record.timestamp);
    const type = text(record.type).toLowerCase();
    const values: unknown[] = [];
    if (Array.isArray(record.tasks)) values.push(...record.tasks);
    if (Array.isArray(record.plan)) values.push(...record.plan);
    if (['task', 'todo', 'plan_task', 'plan_step'].includes(type))
      values.push(record);
    values.forEach((value, index) => {
      const task = taskRecord(value, eventTimestamp, eventIndex + index);
      if (task) tasks.push(task);
    });
  });
  return tasks.slice(0, MAX_ITEMS);
}

function proposalSensitivity(
  proposal: LearningProposal,
): SessionProjectionSensitivity {
  return sensitivity(proposal.sensitivity);
}

function proposalSummary(proposal: LearningProposal): string {
  return safeSummary(
    proposal.extractedLesson || proposal.sourceRunSummary,
    proposalSensitivity(proposal),
  );
}

function journalFromEntry(
  entry: JournalEntryRecord,
  sessionId: string,
): SessionJournalEvent | null {
  let sourceIds: unknown;
  try {
    sourceIds = JSON.parse(entry.source_message_ids_json || '[]');
  } catch {
    sourceIds = [];
  }
  if (!Array.isArray(sourceIds) || !sourceIds.includes(sessionId)) return null;
  const level: SessionProjectionSensitivity = 'normal';
  return {
    id: entry.id,
    timestamp: entry.created_at,
    title: 'Journal entry',
    summary: safeSummary(entry.summary, level),
    tags: [],
    provenance: 'journal',
    sensitivity: level,
  };
}

function transcriptJournalEvents(events: unknown[]): SessionJournalEvent[] {
  return events.flatMap((event, index) => {
    const record = asRecord(event);
    const type = text(record.type).toLowerCase();
    if (!type.startsWith('journal')) return [];
    const level = sensitivity(record.sensitivity);
    const title = safeSummary(record.title || record.name || type, level);
    const summary = safeSummary(
      record.summary || record.detail || record.content,
      level,
    );
    if (!title && !summary) return [];
    return [
      {
        id: text(record.id) || `journal-${index + 1}`,
        timestamp: timestamp(record.timestamp),
        title,
        summary,
        tags: arrayOfStrings(record.tags),
        provenance: 'journal' as const,
        sensitivity: level,
      },
    ];
  });
}

function conversation(events: unknown[]): SessionConversationMessage[] {
  return events.flatMap((event, index) => {
    const record = asRecord(event);
    const type = text(record.type).toLowerCase();
    const role =
      type === 'human' || type === 'user'
        ? 'user'
        : type === 'assistant'
          ? 'assistant'
          : type === 'system'
            ? 'system'
            : null;
    if (!role) return [];
    const content = extractText(record);
    if (!content) return [];
    const level = sensitivity(record.sensitivity);
    return [
      {
        id: text(record.id) || `message-${index + 1}`,
        timestamp: timestamp(record.timestamp),
        role,
        content: safeSummary(content, level),
        provenance: 'transcript' as const,
        sensitivity: level,
      },
    ];
  });
}

export function buildSessionProjections(
  input: SessionProjectionInput,
): SessionProjections {
  const messages = conversation(input.events).slice(-MAX_ITEMS);
  const tasks = transcriptTasks(input.events);
  const memoryProposals = input.learningProposals
    .filter(
      (proposal) =>
        proposal.type === 'memory' && proposal.sourceRunId === input.sessionId,
    )
    .map((proposal) => ({
      id: proposal.id,
      type: 'memory' as const,
      status: proposal.status,
      summary: proposalSummary(proposal),
      scope: text(proposal.proposedScope),
      confidence: proposal.confidence,
      createdAt: proposal.createdAt,
      provenance: 'memory' as const,
      sensitivity: proposalSensitivity(proposal),
    }));
  const skillProposals = input.learningProposals
    .filter(
      (proposal) =>
        proposal.type === 'skill-draft' &&
        proposal.sourceRunId === input.sessionId,
    )
    .map((proposal) => ({
      id: proposal.id,
      type: 'skill-draft' as const,
      status: proposal.status,
      summary: proposalSummary(proposal),
      scope: text(proposal.proposedScope),
      confidence: proposal.confidence,
      createdAt: proposal.createdAt,
      provenance: 'skill' as const,
      sensitivity: proposalSensitivity(proposal),
    }));
  const journalEvents = [
    ...transcriptJournalEvents(input.events),
    ...input.journalEntries.flatMap((entry) => {
      const item = journalFromEntry(entry, input.sessionId);
      return item ? [item] : [];
    }),
  ].slice(0, MAX_ITEMS);

  const timeline: SessionTimelineEvent[] = [
    ...messages.map((message) => ({
      id: `conversation:${message.id}`,
      timestamp: message.timestamp,
      type: `conversation.${message.role}`,
      title: message.role,
      detail: message.content,
      provenance: 'conversation' as const,
      sensitivity: message.sensitivity,
    })),
    ...tasks.map((task) => ({
      id: `plan:${task.id}`,
      timestamp: task.timestamp,
      type: 'plan.task',
      title: task.title,
      detail: task.detail,
      provenance: 'plan' as const,
      sensitivity: task.sensitivity,
    })),
    ...memoryProposals.map((proposal) => ({
      id: `memory:${proposal.id}`,
      timestamp: proposal.createdAt,
      type: 'memory.proposal',
      title: 'Memory proposal',
      detail: proposal.summary,
      provenance: 'memory' as const,
      sensitivity: proposal.sensitivity,
    })),
    ...skillProposals.map((proposal) => ({
      id: `skill:${proposal.id}`,
      timestamp: proposal.createdAt,
      type: 'skill.proposal',
      title: 'Skill proposal',
      detail: proposal.summary,
      provenance: 'skill' as const,
      sensitivity: proposal.sensitivity,
    })),
    ...journalEvents.map((event) => ({
      id: `journal:${event.id}`,
      timestamp: event.timestamp,
      type: 'journal.event',
      title: event.title,
      detail: event.summary,
      provenance: 'journal' as const,
      sensitivity: event.sensitivity,
    })),
  ]
    .filter((event) => event.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(0, MAX_TIMELINE);

  return {
    conversation: projection(messages),
    plan: projection(tasks),
    memoryProposals: projection(memoryProposals),
    skillProposals: projection(skillProposals),
    journalEvents: projection(journalEvents),
    timeline,
  };
}
