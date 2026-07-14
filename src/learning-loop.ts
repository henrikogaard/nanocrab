import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { proposeMemory } from './memory-store.js';
import { proposeSkillDraft } from './skill-factory.js';
import { loadCodingJobs, type CodingJob } from './coding-jobs.js';
import { logAuditEvent } from './audit-log.js';

export type LearningProposalType = 'memory' | 'skill-draft';
export type LearningProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface LearningProposal {
  id: string;
  type: LearningProposalType;
  sourceRunId: string;
  sourceRunSummary: string;
  extractedLesson: string;
  proposedScope: string;
  sensitivity: 'normal' | 'sensitive' | 'secret-note';
  confidence: number;
  validationResult: string | null;
  diff: string | null;
  status: LearningProposalStatus;
  createdBy: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  decisionNote: string | null;
  memoryId: string | null;
  skillDraftId: string | null;
}

export interface LearningLoopConfig {
  enabled: boolean;
  minConfidence: number;
  excludeFailed: boolean;
  excludeCancelled: boolean;
  excludePrivate: boolean;
  excludeSecretBearing: boolean;
}

const LEARNING_PROPOSALS_PATH = path.join(STORE_DIR, 'learning-proposals.json');
const LEARNING_CONFIG_PATH = path.join(STORE_DIR, 'learning-config.json');

const DEFAULT_CONFIG: LearningLoopConfig = {
  enabled: true,
  minConfidence: 0.6,
  excludeFailed: true,
  excludeCancelled: true,
  excludePrivate: true,
  excludeSecretBearing: true,
};

function readProposals(): LearningProposal[] {
  try {
    const records = JSON.parse(
      fs.readFileSync(LEARNING_PROPOSALS_PATH, 'utf-8'),
    );
    if (!Array.isArray(records)) return [];
    return records;
  } catch {
    return [];
  }
}

function writeProposals(proposals: LearningProposal[]): void {
  fs.mkdirSync(path.dirname(LEARNING_PROPOSALS_PATH), { recursive: true });
  fs.writeFileSync(
    LEARNING_PROPOSALS_PATH,
    `${JSON.stringify(proposals, null, 2)}\n`,
  );
}

function readConfig(): LearningLoopConfig {
  try {
    const config = {
      ...DEFAULT_CONFIG,
      ...JSON.parse(fs.readFileSync(LEARNING_CONFIG_PATH, 'utf-8')),
    };
    validateLearningConfig(config);
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function writeConfig(config: LearningLoopConfig): void {
  fs.mkdirSync(path.dirname(LEARNING_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(
    LEARNING_CONFIG_PATH,
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

const BOOLEAN_CONFIG_KEYS: (keyof LearningLoopConfig)[] = [
  'enabled',
  'excludeFailed',
  'excludeCancelled',
  'excludePrivate',
  'excludeSecretBearing',
];

function validateLearningConfig(config: LearningLoopConfig): void {
  for (const key of BOOLEAN_CONFIG_KEYS) {
    if (typeof config[key] !== 'boolean') {
      throw new Error(`Learning config ${key} must be a boolean`);
    }
  }

  if (
    typeof config.minConfidence !== 'number' ||
    !Number.isFinite(config.minConfidence) ||
    config.minConfidence < 0 ||
    config.minConfidence > 1
  ) {
    throw new Error(
      'Learning config minConfidence must be a finite number between 0 and 1',
    );
  }
}

function isEligibleRun(job: CodingJob, config: LearningLoopConfig): boolean {
  if (job.status !== 'completed') return false;
  if (config.excludeFailed && job.failureReason) return false;
  if (config.excludePrivate && job.prompt.toLowerCase().includes('private'))
    return false;
  return true;
}

const SECRET_SENTINEL = '[REDACTED]';
const PRIVATE_KEY_RE =
  /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi;
const LABELED_SECRET_RE =
  /\b(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|client[_ -]?secret|secret|authorization)\b\s*(?:=|:)\s*(?:Bearer\s+)?[^\s,;]+/gi;
const KNOWN_CREDENTIAL_RE =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const HIGH_ENTROPY_CANDIDATE_RE = /\b[A-Za-z0-9+/_=-]{32,}\b/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isPlausibleHighEntropySecret(value: string): boolean {
  const categoryCount = [/[a-z]/, /[A-Z]/, /\d/, /[+/_=-]/].filter((pattern) =>
    pattern.test(value),
  ).length;
  return (
    categoryCount >= 2 &&
    new Set(value).size >= 12 &&
    shannonEntropy(value) >= 3.5
  );
}

function isGeneratedPathOrBranch(
  candidate: string,
  source: string,
  offset: number,
  fieldContext: 'text' | 'path',
): boolean {
  if (fieldContext === 'path') return true;
  const context = source.slice(Math.max(0, offset - 32), offset).toLowerCase();
  if (
    /^(?:nanocrab-code|code)-[a-z0-9-]+$/.test(candidate) &&
    /\b(?:branch|ref|container|session|job)\s*(?:=|:)?\s*$/.test(context)
  ) {
    return true;
  }
  const normalized = candidate.replace(/^\/+/, '');
  return (
    /^(?:tmp|var|home|users|workspace|data|src)\//i.test(normalized) &&
    /(?:\b(?:path|workspace|cwd|file|directory|dir)\s*(?:=|:)?\s*\/?|\bin\s+\/?)$/.test(
      context,
    )
  );
}

function redactSecretText(
  value: string | null | undefined,
  fieldContext: 'text' | 'path' = 'text',
): {
  value: string;
  secretFound: boolean;
} {
  if (!value) return { value: '', secretFound: false };
  let secretFound = false;
  const replaceSecret = () => {
    secretFound = true;
    return SECRET_SENTINEL;
  };
  let redacted = value.replace(PRIVATE_KEY_RE, replaceSecret);
  redacted = redacted.replace(LABELED_SECRET_RE, replaceSecret);
  redacted = redacted.replace(KNOWN_CREDENTIAL_RE, replaceSecret);
  redacted = redacted.replace(
    HIGH_ENTROPY_CANDIDATE_RE,
    (candidate, offset: number, source: string) =>
      !isGeneratedPathOrBranch(candidate, source, offset, fieldContext) &&
      isPlausibleHighEntropySecret(candidate)
        ? replaceSecret()
        : candidate,
  );
  return { value: redacted, secretFound };
}

function sanitizeLearningJob(job: CodingJob): {
  job: CodingJob;
  secretFound: boolean;
} {
  let secretFound = false;
  const sanitize = (
    value: string | null | undefined,
    fieldContext: 'text' | 'path' = 'text',
  ): string => {
    const result = redactSecretText(value, fieldContext);
    secretFound ||= result.secretFound;
    return result.value;
  };
  const sanitized: CodingJob = {
    ...job,
    prompt: sanitize(job.prompt),
    issueTitle: job.issueTitle ? sanitize(job.issueTitle) : null,
    diffSummary: job.diffSummary ? sanitize(job.diffSummary) : null,
    testSummary: job.testSummary ? sanitize(job.testSummary) : null,
    output: sanitize(job.output),
    changedFiles: job.changedFiles.map((file) => sanitize(file, 'path')),
  };
  return { job: sanitized, secretFound };
}

function normalizeTestEvidence(
  testSummary: string | null | undefined,
): string | null {
  const trimmed = testSummary?.trim();
  if (!trimmed) return null;
  if (
    /^(?:see|review) (?:job )?output for tests run by the coding agent\.?$/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed;
}

function extractLessonFromRun(job: CodingJob): string | null {
  const diffSummary = job.diffSummary || '';
  const testSummary = normalizeTestEvidence(job.testSummary);

  const sections = [
    job.prompt ? `Task: ${job.prompt.slice(0, 500)}` : null,
    diffSummary ? `Changes: ${diffSummary}` : null,
    testSummary ? `Tests: ${testSummary}` : null,
  ].filter(Boolean);

  if (sections.length === 0) return null;
  return sections.join('\n\n');
}

function looksLikeSkillDraft(job: CodingJob): boolean {
  const prompt = job.prompt.toLowerCase();
  const hasSkillPrefix =
    prompt.startsWith('skill:') ||
    prompt.startsWith('create skill:') ||
    prompt.startsWith('add skill:') ||
    prompt.startsWith('make skill:');
  const hasChanges =
    (job.diffSummary && job.diffSummary.trim().length > 0) ||
    (job.changedFiles && job.changedFiles.length > 0);
  return hasSkillPrefix && hasChanges;
}

function kebabSkillName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const name = base || 'auto-skill';
  const tail = `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  const combined = `${name.slice(0, 30)}-${tail}`;
  return combined.replace(/-+/g, '-').slice(0, 63);
}

function buildSkillMd(job: CodingJob, lesson: string): string {
  const name = kebabSkillName(job.prompt);
  const description = (job.issueTitle || job.prompt)
    .replace(/\r?\n/g, ' ')
    .trim()
    .slice(0, 500);
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${lesson}`;
}

function decideProposalType(job: CodingJob): LearningProposalType {
  if (looksLikeSkillDraft(job)) {
    return 'skill-draft';
  }
  return 'memory';
}

function detectSensitivity(
  content: string,
): 'normal' | 'sensitive' | 'secret-note' {
  if (
    /\b(api[_ -]?key|token|password|secret|private key|oauth)\b/i.test(content)
  ) {
    return 'secret-note';
  }
  if (/\b(address|phone|email|health|salary|personal)\b/i.test(content)) {
    return 'sensitive';
  }
  return 'normal';
}

function hasMeaningfulTestSummary(
  testSummary: string | null | undefined,
): boolean {
  return normalizeTestEvidence(testSummary) !== null;
}

function looksLikeFailure(text: string | undefined): boolean {
  if (!text) return false;
  const lowered = text.toLowerCase();
  return (
    lowered.includes('error') ||
    lowered.includes('fail') ||
    lowered.includes('exception') ||
    lowered.includes('timeout') ||
    lowered.includes('abort')
  );
}

function computeLessonConfidence(
  job: CodingJob,
  sensitivity: LearningProposal['sensitivity'],
  type: LearningProposalType,
): { confidence: number; validationResult: string } {
  let score = 0.5;
  const signals: string[] = [];

  if (job.diffSummary && job.diffSummary.trim().length > 0) {
    score += 0.1;
    signals.push('diff present');
  }
  if (job.changedFiles && job.changedFiles.length > 0) {
    score += 0.05;
    signals.push(`${job.changedFiles.length} changed files`);
  }
  if (hasMeaningfulTestSummary(job.testSummary)) {
    score += 0.1;
    signals.push('tests meaningful');
  }
  if (job.output && job.output.length > 100) {
    if (looksLikeFailure(job.output)) {
      score -= 0.15;
      signals.push('output has failure markers');
    } else {
      score += 0.1;
      signals.push('output clean');
    }
  }
  if (sensitivity === 'normal') {
    score += 0.05;
    signals.push('normal sensitivity');
  } else if (sensitivity === 'sensitive') {
    score -= 0.05;
    signals.push('sensitive content');
  }
  if (type === 'skill-draft') {
    score += 0.05;
    signals.push('skill-draft intent');
  }

  const confidence = normalizeConfidence(score);
  const validationResult = signals.join('; ') || 'no signals';
  return { confidence, validationResult };
}

function normalizeConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  return Math.min(Math.max(value, 0), 1);
}

export function deriveLearningFromRun(
  jobId: string,
  requestedBy: string,
): LearningProposal | null {
  const config = readConfig();
  if (!config.enabled) return null;

  const jobs = loadCodingJobs();
  const sourceJob = jobs.find((j) => j.id === jobId);
  if (!sourceJob) return null;

  const sanitized = sanitizeLearningJob(sourceJob);
  const job = sanitized.job;
  if (sanitized.secretFound) {
    logAuditEvent({
      actor: requestedBy,
      actionType: 'learning.derive',
      resource: jobId,
      decision: 'skipped',
      correlationId: jobId,
      context: { reason: 'secret-bearing content' },
    });
    return null;
  }

  if (!isEligibleRun(job, config)) {
    logAuditEvent({
      actor: requestedBy,
      actionType: 'learning.derive',
      resource: jobId,
      decision: 'skipped',
      correlationId: jobId,
      context: { reason: 'run not eligible' },
    });
    return null;
  }

  const lesson = extractLessonFromRun(job);
  if (!lesson) return null;

  const sensitivity = detectSensitivity(lesson);
  if (sensitivity === 'secret-note' && config.excludeSecretBearing) {
    logAuditEvent({
      actor: requestedBy,
      actionType: 'learning.derive',
      resource: jobId,
      decision: 'skipped',
      correlationId: jobId,
      context: { reason: 'secret-bearing content' },
    });
    return null;
  }

  const type = decideProposalType(job);
  const extractedLesson =
    type === 'skill-draft' ? buildSkillMd(job, lesson) : lesson;

  const { confidence, validationResult } = computeLessonConfidence(
    job,
    sensitivity,
    type,
  );
  if (confidence < config.minConfidence) {
    logAuditEvent({
      actor: requestedBy,
      actionType: 'learning.derive',
      resource: jobId,
      decision: 'skipped',
      correlationId: jobId,
      context: {
        reason: 'confidence below threshold',
        confidence,
        minConfidence: config.minConfidence,
      },
    });
    return null;
  }

  const proposal: LearningProposal = {
    id: `learn-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    type,
    sourceRunId: jobId,
    sourceRunSummary: job.issueTitle || job.prompt.slice(0, 200),
    extractedLesson,
    proposedScope: 'group',
    sensitivity,
    confidence,
    validationResult,
    diff: job.diffSummary,
    status: 'pending',
    createdBy: requestedBy,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    decisionNote: null,
    memoryId: null,
    skillDraftId: null,
  };

  const proposals = readProposals();
  proposals.push(proposal);
  writeProposals(proposals);

  logAuditEvent({
    actor: requestedBy,
    actionType: 'learning.proposal.created',
    resource: proposal.id,
    decision: 'pending_review',
    correlationId: jobId,
    context: {
      proposalId: proposal.id,
      sourceRunId: jobId,
      type: proposal.type,
      sensitivity: proposal.sensitivity,
      confidence: proposal.confidence,
    },
  });

  return proposal;
}

export function approveLearningProposal(
  id: string,
  reviewedBy: string,
): LearningProposal {
  const proposals = readProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Learning proposal not found: ${id}`);
  if (proposal.status !== 'pending') {
    throw new Error(`Learning proposal is already ${proposal.status}`);
  }

  proposal.status = 'approved';
  proposal.reviewedAt = new Date().toISOString();
  proposal.reviewedBy = reviewedBy;

  if (proposal.type === 'memory') {
    const memory = proposeMemory({
      scope: proposal.proposedScope,
      type: 'fact',
      content: proposal.extractedLesson,
      source: `coding-job:${proposal.sourceRunId}`,
      confidence: proposal.confidence,
      sensitivity: proposal.sensitivity,
      createdBy: reviewedBy,
    });
    proposal.memoryId = memory.id;
  } else if (proposal.type === 'skill-draft') {
    const skillDraft = proposeSkillDraft({
      skillMd: proposal.extractedLesson,
      createdBy: reviewedBy,
      provenance: [`coding-job:${proposal.sourceRunId}`],
    });
    proposal.skillDraftId = skillDraft.id;
  }

  writeProposals(proposals);

  logAuditEvent({
    actor: reviewedBy,
    actionType: 'learning.proposal.approved',
    resource: id,
    decision: 'approved',
    correlationId: proposal.sourceRunId,
    context: {
      proposalId: id,
      memoryId: proposal.memoryId,
      skillDraftId: proposal.skillDraftId,
    },
  });

  return proposal;
}

export function rejectLearningProposal(
  id: string,
  reviewedBy: string,
  note?: string,
): LearningProposal {
  const proposals = readProposals();
  const proposal = proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`Learning proposal not found: ${id}`);
  if (proposal.status !== 'pending') {
    throw new Error(`Learning proposal is already ${proposal.status}`);
  }

  proposal.status = 'rejected';
  proposal.reviewedAt = new Date().toISOString();
  proposal.reviewedBy = reviewedBy;
  proposal.decisionNote = note || null;

  writeProposals(proposals);

  logAuditEvent({
    actor: reviewedBy,
    actionType: 'learning.proposal.rejected',
    resource: id,
    decision: 'rejected',
    correlationId: proposal.sourceRunId,
    context: { proposalId: id, note: proposal.decisionNote },
  });

  return proposal;
}

export function listLearningProposals(filters?: {
  status?: LearningProposalStatus;
  sourceRunId?: string;
  type?: LearningProposalType;
  limit?: number;
}): LearningProposal[] {
  let proposals = readProposals();

  if (filters?.status) {
    proposals = proposals.filter((p) => p.status === filters.status);
  }
  if (filters?.sourceRunId) {
    proposals = proposals.filter((p) => p.sourceRunId === filters.sourceRunId);
  }
  if (filters?.type) {
    proposals = proposals.filter((p) => p.type === filters.type);
  }

  proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const limit = filters?.limit || 100;
  return proposals.slice(0, Math.min(limit, 500));
}

export function getLearningProposal(id: string): LearningProposal | undefined {
  return readProposals().find((p) => p.id === id);
}

export function updateLearningConfig(
  config: Partial<LearningLoopConfig>,
): LearningLoopConfig {
  const current = readConfig();
  const next = { ...current, ...config };
  validateLearningConfig(next);
  writeConfig(next);
  return next;
}

export function getLearningConfig(): LearningLoopConfig {
  return readConfig();
}
