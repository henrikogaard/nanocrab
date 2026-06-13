import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

import { DATA_DIR, SESSIONS_DIR } from '../../config.js';
import { requireRole } from '../middleware.js';
import {
  isSafeTerminalSessionId,
  listTerminalSessions,
  readSessionLog,
} from '../websocket.js';
import { getAgentProviderConfig } from '../../agent-provider.js';
import { listApprovals } from '../../approvals.js';
import { loadCodingJobs } from '../../coding-jobs.js';
import { getState } from '../state.js';

const router = Router();

interface SessionInfo {
  id: string;
  sessionId: string;
  source: 'transcript' | 'coding-job' | 'active-container';
  approvalTargetType: string;
  approvalTargetId: string;
  group: string;
  provider: string;
  model: string;
  status: CockpitSessionStatus;
  startedAt: string;
  updatedAt: string;
  lastEventAt: string;
  lastActivity: string;
  messageCount: number;
  approvalCount: number;
  artifactCount: number;
  changedFiles: string[];
  currentStep: string;
  filePath: string;
}

type CockpitSessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | 'idle';

interface CockpitTimelineEvent {
  id: string;
  timestamp: string;
  type: string;
  title: string;
  detail: string;
}

interface CockpitArtifact {
  id: string;
  name: string;
  path: string;
  kind: string;
  status?: string;
  sizeBytes?: number;
  createdAt?: string;
  summary?: string;
  downloadUrl?: string;
  externalUrl?: string;
}

interface CockpitDeliverable {
  id: string;
  title: string;
  format: string;
  path: string;
  sourceType: string;
  sourceId: string;
  status: string;
  createdAt: string;
  sizeBytes: number | null;
  summary: string;
  downloadUrl?: string;
  externalUrl?: string;
}

interface CockpitSessionDetail extends SessionInfo {
  timeline: CockpitTimelineEvent[];
  artifacts: CockpitArtifact[];
  deliverables: CockpitDeliverable[];
  approvals: Array<{
    id: string;
    title: string;
    status: string;
    risk: string;
    createdAt: string;
  }>;
}

const TRANSCRIPT_PROJECT_DIRS = [
  ['.agents', 'projects', '-workspace-group'],
  ['.claude', 'projects', '-workspace-group'],
];
const transcriptSummaryCache = new Map<
  string,
  { mtimeMs: number; size: number; summary: SessionInfo }
>();

function activeContainerId(group: string, taskId?: string | null): string {
  return taskId || `active-${group.replace(/[^A-Za-z0-9_.-]+/g, '-')}`;
}

function transcriptCockpitId(group: string, sessionId: string): string {
  return `transcript:${encodeURIComponent(group)}:${encodeURIComponent(sessionId)}`;
}

function activeContainerCockpitId(
  group: string,
  taskId?: string | null,
): string {
  return `container:${encodeURIComponent(activeContainerId(group, taskId))}`;
}

function readJsonLines(filePath: string): unknown[] {
  try {
    return fs
      .readFileSync(filePath, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {};
}

function contentBlocks(obj: Record<string, any>): Array<Record<string, any>> {
  if (Array.isArray(obj.message?.content)) return obj.message.content;
  if (Array.isArray(obj.content)) return obj.content;
  return [];
}

function extractText(obj: Record<string, any>): string {
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.message === 'string') return obj.message;
  return contentBlocks(obj)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .trim();
}

function compactStep(text: string, fallback: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return (oneLine || fallback).slice(0, 180);
}

function fileSizeBytes(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function artifactFormat(filePath: string, fallback = 'file'): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return ext || fallback;
}

function deliverableFromPath(input: {
  id: string;
  title: string;
  path: string;
  sourceType: string;
  sourceId: string;
  status: string;
  createdAt: string;
  summary: string;
  format?: string;
  downloadUrl?: string;
  externalUrl?: string;
}): CockpitDeliverable {
  return {
    id: input.id,
    title: input.title,
    format: input.format || artifactFormat(input.path),
    path: input.path,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: input.status,
    createdAt: input.createdAt,
    sizeBytes: fileSizeBytes(input.path),
    summary: input.summary,
    downloadUrl: input.downloadUrl,
    externalUrl: input.externalUrl,
  };
}

function inferStatus(summary: {
  isActive: boolean;
  failed: boolean;
  approvalCount: number;
}): CockpitSessionStatus {
  if (summary.failed) return 'failed';
  if (summary.approvalCount > 0) return 'waiting_approval';
  if (summary.isActive) return 'running';
  return 'completed';
}

function transcriptSummary(input: {
  group: string;
  sessionId: string;
  filePath: string;
  stat: fs.Stats;
  isActive?: boolean;
}): SessionInfo {
  const providerConfig = getAgentProviderConfig();
  const events = readJsonLines(input.filePath).map(asRecord);
  const first = events[0] || {};
  const last = events[events.length - 1] || {};
  const startedAt = first.timestamp || '';
  const lastEventAt = last.timestamp || '';
  let provider: string = providerConfig.provider;
  let model: string = providerConfig.model;
  let toolCount = 0;
  let approvalCount = 0;
  let artifactCount = 0;
  let failed = false;
  let currentStep = '';
  const changedFiles = new Set<string>();

  for (const obj of events) {
    if (typeof obj.provider === 'string') provider = obj.provider;
    if (typeof obj.model === 'string') model = obj.model;
    if (typeof obj.message?.model === 'string') model = obj.message.model;
    if (
      obj.type === 'error' ||
      typeof obj.error === 'string' ||
      obj.status === 'failed' ||
      obj.status === 'error'
    ) {
      failed = true;
    }
    if (
      obj.type === 'approval_request' ||
      obj.status === 'waiting_approval' ||
      obj.status === 'pending_approval'
    ) {
      approvalCount++;
    }

    const text = extractText(obj);
    if (text)
      currentStep = compactStep(text, currentStep || 'Transcript event');

    for (const block of contentBlocks(obj)) {
      if (block.type !== 'tool_use') continue;
      toolCount++;
      const name = String(block.name || '');
      const inputRecord = asRecord(block.input);
      const maybePath =
        inputRecord.file_path || inputRecord.path || inputRecord.filename;
      if (typeof maybePath === 'string' && maybePath.trim()) {
        changedFiles.add(maybePath.trim());
      }
      if (/write|edit|patch|artifact|create/i.test(name)) artifactCount++;
      if (/approval/i.test(name)) approvalCount++;
    }
  }

  if (!currentStep) {
    currentStep =
      toolCount > 0
        ? `${toolCount} tool events captured`
        : 'Transcript captured';
  }

  const status = inferStatus({
    isActive: Boolean(input.isActive),
    failed,
    approvalCount,
  });

  return {
    id: transcriptCockpitId(input.group, input.sessionId),
    sessionId: input.sessionId,
    source: 'transcript',
    approvalTargetType: 'transcript-session',
    approvalTargetId: transcriptCockpitId(input.group, input.sessionId),
    group: input.group,
    provider,
    model,
    status,
    startedAt,
    updatedAt: lastEventAt,
    lastEventAt,
    lastActivity: lastEventAt,
    messageCount: events.length,
    approvalCount,
    artifactCount,
    changedFiles: [...changedFiles].slice(0, 24),
    currentStep,
    filePath: path.basename(input.filePath),
  };
}

function cachedTranscriptSummary(input: {
  group: string;
  sessionId: string;
  filePath: string;
  stat: fs.Stats;
}): SessionInfo {
  const cached = transcriptSummaryCache.get(input.filePath);
  if (
    cached &&
    cached.mtimeMs === input.stat.mtimeMs &&
    cached.size === input.stat.size
  ) {
    return {
      ...cached.summary,
      changedFiles: [...cached.summary.changedFiles],
    };
  }
  const summary = transcriptSummary(input);
  transcriptSummaryCache.set(input.filePath, {
    mtimeMs: input.stat.mtimeMs,
    size: input.stat.size,
    summary,
  });
  return { ...summary, changedFiles: [...summary.changedFiles] };
}

function transcriptPath(group: string, sessionId: string): string | null {
  for (const parts of TRANSCRIPT_PROJECT_DIRS) {
    const filePath = path.join(
      DATA_DIR,
      'sessions',
      group,
      ...parts,
      `${sessionId}.jsonl`,
    );
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

export function listCockpitSessions(): SessionInfo[] {
  const sessionsDir = path.join(DATA_DIR, 'sessions');
  const sessions: SessionInfo[] = [];
  const seen = new Set<string>();

  if (fs.existsSync(sessionsDir)) {
    const groupDirs = fs.readdirSync(sessionsDir).filter((d) => {
      try {
        return fs.statSync(path.join(sessionsDir, d)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const group of groupDirs) {
      for (const parts of TRANSCRIPT_PROJECT_DIRS) {
        const transcriptDir = path.join(sessionsDir, group, ...parts);
        if (!fs.existsSync(transcriptDir)) continue;
        for (const file of fs.readdirSync(transcriptDir)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(transcriptDir, file);
          const stat = fs.statSync(filePath);
          if (stat.size === 0) continue;
          const sessionId = file.replace('.jsonl', '');
          const key = `${group}:${sessionId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          sessions.push(
            cachedTranscriptSummary({ group, sessionId, filePath, stat }),
          );
        }
      }
    }
  }

  for (const job of loadCodingJobs()) {
    const statusMap: Record<string, CockpitSessionStatus> = {
      queued: 'queued',
      await_approval: 'waiting_approval',
      await_pr_approval: 'waiting_approval',
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
    };
    const approvalCount =
      (job.approvalHistory?.length || 0) +
      listApprovals({ targetType: 'coding-job', targetId: job.id }).length;
    const artifactCount =
      (job.changedFiles?.length || 0) +
      [job.prUrl, job.commitSha, job.testSummary].filter(Boolean).length;
    sessions.push({
      id: job.id,
      sessionId: job.id,
      source: 'coding-job',
      approvalTargetType: 'coding-job',
      approvalTargetId: job.id,
      group: job.repo,
      provider: job.provider,
      model: job.model,
      status: statusMap[job.status] || 'running',
      startedAt: job.createdAt,
      updatedAt: job.completedAt || job.createdAt,
      lastEventAt: job.completedAt || job.createdAt,
      lastActivity: job.completedAt || job.createdAt,
      messageCount: job.output
        ? job.output.split('\n').filter(Boolean).length
        : 1,
      approvalCount,
      artifactCount,
      changedFiles: job.changedFiles || [],
      currentStep:
        job.testSummary ||
        job.issueTitle ||
        compactStep(job.prompt || '', `Coding job ${job.status}`),
      filePath: '',
    });
  }

  try {
    const providerConfig = getAgentProviderConfig();
    for (const container of getState().queue.getActiveContainers()) {
      const group = container.groupFolder || container.groupJid;
      const id = activeContainerCockpitId(group, container.taskId);
      if (sessions.some((session) => session.id === id)) continue;
      sessions.push({
        id,
        sessionId: activeContainerId(group, container.taskId),
        source: 'active-container',
        approvalTargetType: 'container-session',
        approvalTargetId: id,
        group,
        provider: providerConfig.provider,
        model: providerConfig.model,
        status: container.idleWaiting ? 'idle' : 'running',
        startedAt: '',
        updatedAt: '',
        lastEventAt: '',
        lastActivity: '',
        messageCount: 0,
        approvalCount: 0,
        artifactCount: 0,
        changedFiles: [],
        currentStep: container.isTask
          ? 'Running scheduled task'
          : 'Agent container active',
        filePath: '',
      });
    }
  } catch {
    // State is not initialized in some tests and scripts.
  }

  sessions.sort((a, b) =>
    (b.lastEventAt || b.updatedAt || '').localeCompare(
      a.lastEventAt || a.updatedAt || '',
    ),
  );
  return sessions;
}

export function buildCockpitDetail(id: string): CockpitSessionDetail | null {
  const summary = listCockpitSessions().find((session) => session.id === id);
  if (!summary) return null;

  const persistedApprovals = listApprovals({
    targetType: summary.approvalTargetType,
    targetId: summary.approvalTargetId,
  }).map((approval) => ({
    id: approval.id,
    title: approval.title,
    status: approval.status,
    risk: approval.risk,
    createdAt: approval.createdAt,
  }));
  const codingJob = loadCodingJobs().find((job) => job.id === summary.id);
  const jobApprovals =
    codingJob?.approvalHistory?.map((approval, index) => ({
      id: `${codingJob.id}-approval-history-${index + 1}`,
      title: approval.action || 'Coding job approval',
      status: approval.action.includes('den')
        ? 'denied'
        : approval.action.includes('approve')
          ? 'approved'
          : 'pending',
      risk: 'medium',
      createdAt: approval.at,
    })) || [];
  const approvals = [...jobApprovals, ...persistedApprovals];

  const timeline: CockpitTimelineEvent[] = [];
  const artifacts: CockpitSessionDetail['artifacts'] = [];
  const deliverables: CockpitSessionDetail['deliverables'] = [];
  const filePath = transcriptPath(summary.group, summary.sessionId);
  if (filePath) {
    readJsonLines(filePath)
      .map(asRecord)
      .slice(-80)
      .forEach((obj, index) => {
        const ts = obj.timestamp || summary.lastEventAt;
        const text = extractText(obj);
        const toolBlocks = contentBlocks(obj).filter(
          (block) => block.type === 'tool_use',
        );
        timeline.push({
          id: `${summary.id}-${index}`,
          timestamp: ts,
          type: String(obj.type || 'event'),
          title:
            toolBlocks.length > 0
              ? `${toolBlocks.length} tool call${toolBlocks.length === 1 ? '' : 's'}`
              : String(obj.type || 'event'),
          detail: compactStep(
            text,
            toolBlocks.map((block) => block.name).join(', '),
          ),
        });
        for (const block of toolBlocks) {
          const inputRecord = asRecord(block.input);
          const maybePath =
            inputRecord.file_path || inputRecord.path || inputRecord.filename;
          if (typeof maybePath === 'string' && maybePath.trim()) {
            const artifactPath = maybePath.trim();
            artifacts.push({
              id: `${summary.id}-artifact-${artifacts.length}`,
              name: path.basename(artifactPath),
              path: artifactPath,
              kind: String(block.name || 'file'),
              status: 'ready',
              sizeBytes: fileSizeBytes(artifactPath) || undefined,
              createdAt: ts,
            });
            if (/write|edit|patch|artifact|create/i.test(String(block.name))) {
              deliverables.push(
                deliverableFromPath({
                  id: `${summary.id}-deliverable-${deliverables.length}`,
                  title: path.basename(artifactPath),
                  path: artifactPath,
                  sourceType: 'transcript',
                  sourceId: summary.id,
                  status: 'ready',
                  createdAt: ts,
                  summary: `Produced by ${String(block.name || 'tool')} during the agent run.`,
                }),
              );
            }
          }
        }
      });
  }

  if (codingJob) {
    for (const file of codingJob.changedFiles || []) {
      artifacts.push({
        id: `${codingJob.id}-changed-file-${artifacts.length}`,
        name: path.basename(file),
        path: file,
        kind: 'changed-file',
        status: 'ready',
      });
    }
    if (codingJob.prUrl) {
      artifacts.push({
        id: `${codingJob.id}-pull-request`,
        name: 'Pull request',
        path: codingJob.prUrl,
        kind: 'pull-request',
        status: codingJob.status === 'completed' ? 'ready' : 'pending',
        externalUrl: codingJob.prUrl,
      });
      deliverables.push({
        id: `${codingJob.id}-deliverable-pr`,
        title: 'Pull request',
        format: 'github-pr',
        path: codingJob.prUrl,
        sourceType: 'coding-job',
        sourceId: codingJob.id,
        status: codingJob.status === 'completed' ? 'ready' : 'pending',
        createdAt: codingJob.completedAt || codingJob.createdAt,
        sizeBytes: null,
        summary: 'Reviewable implementation branch prepared by the coding job.',
        externalUrl: codingJob.prUrl,
      });
    }
    if (codingJob.commitSha) {
      artifacts.push({
        id: `${codingJob.id}-commit`,
        name: codingJob.commitSha.slice(0, 12),
        path: codingJob.commitSha,
        kind: 'commit',
        status: 'ready',
      });
      deliverables.push({
        id: `${codingJob.id}-deliverable-commit`,
        title: `Commit ${codingJob.commitSha.slice(0, 12)}`,
        format: 'commit',
        path: codingJob.commitSha,
        sourceType: 'coding-job',
        sourceId: codingJob.id,
        status: 'ready',
        createdAt: codingJob.completedAt || codingJob.createdAt,
        sizeBytes: null,
        summary: 'Implementation commit recorded for audit and handoff.',
      });
    }
    if (codingJob.testSummary) {
      artifacts.push({
        id: `${codingJob.id}-test-summary`,
        name: 'Test summary',
        path: codingJob.testSummary,
        kind: 'test-summary',
        status: codingJob.status === 'failed' ? 'failed' : 'ready',
      });
      deliverables.push({
        id: `${codingJob.id}-deliverable-test-summary`,
        title: 'Test summary',
        format: 'text',
        path: codingJob.testSummary,
        sourceType: 'coding-job',
        sourceId: codingJob.id,
        status: codingJob.status === 'failed' ? 'failed' : 'ready',
        createdAt: codingJob.completedAt || codingJob.createdAt,
        sizeBytes: Buffer.byteLength(codingJob.testSummary, 'utf8'),
        summary: 'Captured test output from the coding job run.',
      });
    }
  }

  if (timeline.length === 0) {
    timeline.push({
      id: `${summary.id}-summary`,
      timestamp: summary.lastEventAt || summary.startedAt,
      type: summary.status,
      title: summary.status.replace(/_/g, ' '),
      detail: summary.currentStep,
    });
  }

  return {
    ...summary,
    timeline,
    artifacts: artifacts.slice(0, 24),
    deliverables: deliverables.slice(0, 24),
    approvals,
  };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(listCockpitSessions());
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/cockpit', (_req: Request, res: Response) => {
  try {
    res.json(listCockpitSessions());
  } catch {
    res.status(500).json({ error: 'Failed to list cockpit sessions' });
  }
});

router.get('/cockpit/:id', (req: Request, res: Response) => {
  try {
    const detail = buildCockpitDetail(req.params.id as string);
    if (!detail) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(detail);
  } catch {
    res.status(500).json({ error: 'Failed to read cockpit session' });
  }
});

router.get(
  '/terminal/active',
  requireRole('owner'),
  (_req: Request, res: Response) => {
    res.json(listTerminalSessions());
  },
);

// GET /api/sessions/terminal/history — list all terminal sessions
router.get(
  '/terminal/history',
  requireRole('owner'),
  async (_req: Request, res: Response) => {
    try {
      const indexPath = path.join(SESSIONS_DIR, 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json([]);
        return;
      }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const activeSessions = listTerminalSessions();
      const activeIds = new Set(
        activeSessions.filter((s) => s.active).map((s) => s.id),
      );
      const history = index.map((entry: any) => ({
        ...entry,
        active: activeIds.has(entry.id),
      }));
      history.sort((a: any, b: any) =>
        (b.createdAt || '').localeCompare(a.createdAt || ''),
      );
      res.json(history);
    } catch (err) {
      res.status(500).json({ error: 'Failed to read session history' });
    }
  },
);

// GET /api/sessions/terminal/:id/transcript — full transcript
router.get(
  '/terminal/:id/transcript',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id as string;
      if (!isSafeTerminalSessionId(sessionId)) {
        res.status(400).json({ error: 'Invalid session id' });
        return;
      }
      const content = readSessionLog(sessionId);
      if (!content) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ id: sessionId, content });
    } catch (err) {
      res.status(500).json({ error: 'Failed to read session transcript' });
    }
  },
);

// POST /api/sessions/terminal/search — search across session logs
router.post(
  '/terminal/search',
  requireRole('owner'),
  async (req: Request, res: Response) => {
    try {
      const { query, sessionId, dateFrom, dateTo } = req.body as {
        query?: string;
        sessionId?: string;
        dateFrom?: string;
        dateTo?: string;
      };
      if (!query || !query.trim()) {
        res.status(400).json({ error: 'query is required' });
        return;
      }
      if (sessionId && !isSafeTerminalSessionId(sessionId)) {
        res.status(400).json({ error: 'Invalid session id' });
        return;
      }

      const indexPath = path.join(SESSIONS_DIR, 'index.json');
      if (!fs.existsSync(indexPath)) {
        res.json({ results: [] });
        return;
      }
      const index: any[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
      const lowerQuery = query.toLowerCase();
      const results: Array<{
        sessionId: string;
        line: number;
        text: string;
        context: string;
      }> = [];

      const sessionsToSearch = sessionId
        ? index.filter((e) => e.id === sessionId)
        : index;

      for (const entry of sessionsToSearch) {
        if (dateFrom && entry.createdAt && entry.createdAt < dateFrom) continue;
        if (
          dateTo &&
          entry.createdAt &&
          entry.createdAt > dateTo + 'T23:59:59Z'
        )
          continue;

        if (!isSafeTerminalSessionId(String(entry.id || ''))) continue;
        const logPath = path.join(SESSIONS_DIR, `${entry.id}.log`);
        if (!fs.existsSync(logPath)) continue;

        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            results.push({
              sessionId: entry.id,
              line: i + 1,
              text: lines[i],
              context: lines.slice(Math.max(0, i - 2), i + 3).join('\n'),
            });
          }
        }
      }

      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: 'Search failed' });
    }
  },
);

// GET /api/sessions/:group/:sessionId/detail — full session detail with stats + structured tool calls
router.get('/:group/:sessionId/detail', async (req: Request, res: Response) => {
  try {
    const group = req.params.group as string;
    const sessionId = req.params.sessionId as string;
    let filePath = path.join(
      DATA_DIR,
      'sessions',
      group,
      '.agents',
      'projects',
      '-workspace-group',
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(filePath)) {
      filePath = path.join(
        DATA_DIR,
        'sessions',
        group,
        '.claude',
        'projects',
        '-workspace-group',
        `${sessionId}.jsonl`,
      );
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages: Array<{
      role: string;
      content: string;
      timestamp: string;
      type: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        input: string;
        output: string;
        duration: string;
      }>;
    }> = [];

    const pendingToolCalls = new Map<string, { name: string; input: string }>();
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let toolCount = 0;
    let model = '';

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp || '';
        if (!firstTimestamp) firstTimestamp = ts;
        lastTimestamp = ts;

        if (obj.type === 'user' || obj.type === 'human') {
          messages.push({
            role: 'user',
            content: obj.content || obj.message || JSON.stringify(obj),
            timestamp: ts,
            type: obj.type,
          });
        } else if (obj.type === 'assistant') {
          if (!model && obj.message?.model) {
            model = obj.message.model;
          }

          let text = '';
          const tc: Array<{
            id: string;
            name: string;
            input: string;
            output: string;
            duration: string;
          }> = [];

          const contentBlocks = Array.isArray(obj.message?.content)
            ? obj.message.content
            : Array.isArray(obj.content)
              ? obj.content
              : [];

          for (const block of contentBlocks) {
            if (block.type === 'text') {
              text += block.text || '';
            } else if (block.type === 'tool_use') {
              toolCount++;
              const toolId = block.id || block.tool_use_id || `tc_${toolCount}`;
              pendingToolCalls.set(toolId, {
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
              });
              tc.push({
                id: toolId,
                name: block.name || '',
                input: JSON.stringify(block.input || {}),
                output: '',
                duration: '',
              });
            } else if (block.type === 'tool_result') {
              const toolId = block.tool_use_id || '';
              const pending = pendingToolCalls.get(toolId);
              if (pending) {
                pendingToolCalls.delete(toolId);
                tc.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output:
                    typeof block.content === 'string'
                      ? block.content
                      : JSON.stringify(block.content || ''),
                  duration: block.duration || '',
                });
              }
            }
          }

          const content = text || (tc.length > 0 ? '' : JSON.stringify(obj));

          if (content || tc.length > 0) {
            messages.push({
              role: 'assistant',
              content,
              timestamp: ts,
              type: obj.type,
              toolCalls: tc.length > 0 ? tc : undefined,
            });
          }
        } else if (obj.type === 'tool_result' && obj.message?.tool_use_id) {
          const toolId = obj.message.tool_use_id;
          const pending = pendingToolCalls.get(toolId);
          if (pending) {
            pendingToolCalls.delete(toolId);
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') {
                if (!messages[i].toolCalls) messages[i].toolCalls = [];
                messages[i].toolCalls!.push({
                  id: toolId,
                  name: pending.name,
                  input: pending.input,
                  output:
                    typeof obj.message.content === 'string'
                      ? obj.message.content
                      : JSON.stringify(obj.message.content || ''),
                  duration: obj.message.duration || '',
                });
                break;
              }
            }
          }
        } else if (obj.type === 'queue-operation' && obj.content) {
          messages.push({
            role: 'user',
            content: obj.content,
            timestamp: ts,
            type: 'queue',
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    const duration =
      firstTimestamp && lastTimestamp
        ? Math.round(
            (new Date(lastTimestamp).getTime() -
              new Date(firstTimestamp).getTime()) /
              1000,
          )
        : 0;

    res.json({
      id: sessionId,
      group,
      stats: {
        messageCount: messages.length,
        duration,
        toolCount,
        model: model || 'unknown',
        createdAt: firstTimestamp,
        endedAt: lastTimestamp,
      },
      messages,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session detail' });
  }
});

router.get('/:group/:sessionId', async (req: Request, res: Response) => {
  try {
    const group = req.params.group as string;
    const sessionId = req.params.sessionId as string;
    let filePath = path.join(
      DATA_DIR,
      'sessions',
      group,
      '.agents',
      'projects',
      '-workspace-group',
      `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(filePath)) {
      filePath = path.join(
        DATA_DIR,
        'sessions',
        group,
        '.claude',
        'projects',
        '-workspace-group',
        `${sessionId}.jsonl`,
      );
    }

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const messages: Array<{
      role: string;
      content: string;
      timestamp: string;
      type: string;
      toolUse?: boolean;
    }> = [];

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp || '';
        const type = obj.type || '';

        if (type === 'user' || type === 'human') {
          messages.push({
            role: 'user',
            content: obj.content || obj.message || JSON.stringify(obj),
            timestamp: ts,
            type,
          });
        } else if (type === 'assistant') {
          // Extract text from content blocks
          let text = '';
          if (typeof obj.message === 'string') {
            text = obj.message;
          } else if (Array.isArray(obj.message?.content)) {
            text = obj.message.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text: string }) => b.text)
              .join('\n');
          } else if (typeof obj.content === 'string') {
            text = obj.content;
          } else if (Array.isArray(obj.content)) {
            text = obj.content
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { text: string }) => b.text)
              .join('\n');
          }

          const hasToolUse = Array.isArray(obj.message?.content)
            ? obj.message.content.some(
                (b: { type: string }) => b.type === 'tool_use',
              )
            : Array.isArray(obj.content)
              ? obj.content.some((b: { type: string }) => b.type === 'tool_use')
              : false;

          if (text || hasToolUse) {
            messages.push({
              role: 'assistant',
              content: text || '[Tool use only]',
              timestamp: ts,
              type,
              toolUse: hasToolUse || undefined,
            });
          }
        } else if (type === 'queue-operation' && obj.content) {
          messages.push({
            role: 'user',
            content: obj.content,
            timestamp: ts,
            type: 'queue',
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read session' });
  }
});

export default router;
