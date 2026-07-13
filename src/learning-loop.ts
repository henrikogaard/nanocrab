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
    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(fs.readFileSync(LEARNING_CONFIG_PATH, 'utf-8')),
    };
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

function isEligibleRun(job: CodingJob, config: LearningLoopConfig): boolean {
  if (job.status !== 'completed') return false;
  if (config.excludeFailed && job.failureReason) return false;
  if (config.excludePrivate && job.prompt.toLowerCase().includes('private'))
    return false;
  if (
    config.excludeSecretBearing &&
    /\b(api[_ -]?key|token|password|secret|private key|oauth)\b/i.test(
      job.output,
    )
  ) {
    return false;
  }
  return true;
}

function extractLessonFromRun(job: CodingJob): string | null {
  const diffSummary = job.diffSummary || '';
  const testSummary = job.testSummary || '';

  const sections = [
    job.prompt ? `Task: ${job.prompt.slice(0, 500)}` : null,
    diffSummary ? `Changes: ${diffSummary}` : null,
    testSummary &&
    testSummary !== 'See job output for tests run by the coding agent.'
      ? `Tests: ${testSummary}`
      : null,
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

const DEFAULT_TEST_SUMMARY =
  'See job output for tests run by the coding agent.';

function hasMeaningfulTestSummary(
  testSummary: string | null | undefined,
): boolean {
  return !!(
    testSummary &&
    testSummary.trim().length > 0 &&
    testSummary !== DEFAULT_TEST_SUMMARY
  );
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
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

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
  writeConfig(next);
  return next;
}

export function getLearningConfig(): LearningLoopConfig {
  return readConfig();
}
