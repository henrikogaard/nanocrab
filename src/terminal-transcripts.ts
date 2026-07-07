import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';

export type TerminalTranscriptEventType =
  | 'spawn'
  | 'input'
  | 'output'
  | 'close';

export interface TerminalTranscriptEvent {
  sessionId: string;
  owner: string;
  type: TerminalTranscriptEventType;
  data: string;
  timestamp: string;
}

export interface TerminalTranscriptSummary {
  sessionId: string;
  owner: string;
  startedAt: string;
  lastActivity: string;
  eventCount: number;
  transcriptBytes: number;
}

export interface TerminalTranscriptSearchHit {
  sessionId: string;
  owner: string;
  timestamp: string;
  type: TerminalTranscriptEventType;
  snippet: string;
}

const TERMINAL_TRANSCRIPTS_DIR = path.join(DATA_DIR, 'terminal-sessions');

function safeSessionId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('invalid terminal session id');
  }
  return cleaned;
}

function transcriptPath(sessionId: string): string {
  return path.join(
    TERMINAL_TRANSCRIPTS_DIR,
    `${safeSessionId(sessionId)}.jsonl`,
  );
}

export function appendTerminalTranscript(
  event: Omit<TerminalTranscriptEvent, 'timestamp'> & { timestamp?: string },
): void {
  fs.mkdirSync(TERMINAL_TRANSCRIPTS_DIR, { recursive: true });
  const record: TerminalTranscriptEvent = {
    ...event,
    data: event.data.slice(0, 200000),
    timestamp: event.timestamp || new Date().toISOString(),
  };
  fs.appendFileSync(
    transcriptPath(record.sessionId),
    `${JSON.stringify(record)}\n`,
  );
}

function readEvents(filePath: string): TerminalTranscriptEvent[] {
  try {
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TerminalTranscriptEvent);
  } catch {
    return [];
  }
}

export function listTerminalTranscriptSummaries(): TerminalTranscriptSummary[] {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(TERMINAL_TRANSCRIPTS_DIR)
      .filter((file) => file.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files
    .map((file) => {
      const events = readEvents(path.join(TERMINAL_TRANSCRIPTS_DIR, file));
      const first = events[0];
      const last = events[events.length - 1];
      if (!first || !last) return null;
      return {
        sessionId: first.sessionId,
        owner: first.owner,
        startedAt: first.timestamp,
        lastActivity: last.timestamp,
        eventCount: events.length,
        transcriptBytes: events.reduce(
          (sum, event) => sum + Buffer.byteLength(event.data),
          0,
        ),
      };
    })
    .filter((item): item is TerminalTranscriptSummary => item !== null)
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export function searchTerminalTranscripts(input: {
  query: string;
  owner?: string;
  limit?: number;
}): TerminalTranscriptSearchHit[] {
  const query = input.query.trim().toLowerCase();
  if (!query) throw new Error('terminal transcript query is required');
  const limit = Math.min(Math.max(input.limit || 50, 1), 200);
  const hits: TerminalTranscriptSearchHit[] = [];
  for (const summary of listTerminalTranscriptSummaries()) {
    if (input.owner && summary.owner !== input.owner) continue;
    for (const event of readEvents(transcriptPath(summary.sessionId))) {
      const idx = event.data.toLowerCase().indexOf(query);
      if (idx < 0) continue;
      hits.push({
        sessionId: event.sessionId,
        owner: event.owner,
        timestamp: event.timestamp,
        type: event.type,
        snippet: event.data.slice(
          Math.max(0, idx - 80),
          idx + query.length + 160,
        ),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
