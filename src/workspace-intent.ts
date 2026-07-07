export type WorkspaceIntentKind =
  | 'copilot'
  | 'cowork'
  | 'code'
  | 'clarification';
export type WorkspaceIntentConfidence = 'low' | 'medium' | 'high';

export interface WorkspaceIntentProject {
  id: string;
  name: string;
  slug?: string | null;
}

export interface WorkspaceIntentThread {
  id: string;
  title: string;
  projectId?: string | null;
}

export interface WorkspaceIntentInput {
  prompt: string;
  channel?: string;
  projects?: WorkspaceIntentProject[];
  threads?: WorkspaceIntentThread[];
}

export interface WorkspaceIntentCandidate {
  kind: Exclude<WorkspaceIntentKind, 'clarification'>;
  label: string;
  reason: string;
  target?: Record<string, unknown>;
}

export interface WorkspaceIntentResult {
  kind: WorkspaceIntentKind;
  confidence: WorkspaceIntentConfidence;
  approvalRequired: boolean;
  reason: string;
  target: Record<string, unknown> | null;
  candidates: WorkspaceIntentCandidate[];
  clarificationPrompt: string | null;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9#/_:.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesPhrase(haystack: string, needle: string): boolean {
  return haystack.includes(normalizeText(needle));
}

function matchProject(
  promptText: string,
  projects: WorkspaceIntentProject[],
): WorkspaceIntentProject | null {
  return (
    projects.find((project) => {
      const names = [project.name, project.slug || ''].filter(Boolean);
      return names.some((name) => includesPhrase(promptText, String(name)));
    }) || null
  );
}

function matchPlainThread(
  promptText: string,
  threads: WorkspaceIntentThread[],
): WorkspaceIntentThread | null {
  return (
    threads.find((thread) => {
      if (thread.projectId) return false;
      return includesPhrase(promptText, thread.title);
    }) || null
  );
}

function parseIssueNumber(prompt: string): number | null {
  const match = prompt.match(/(?:issue|#)\s*#?(\d{1,7})/i);
  return match ? Number(match[1]) : null;
}

function parseRepo(promptText: string): string | null {
  const inRepo = promptText.match(/\bin\s+([a-z0-9_.-]+)(?:\s|$)/);
  const candidate = inRepo?.[1]?.replace(/[.:-]+$/g, '') || '';
  if (candidate && !['the', 'this', 'that'].includes(candidate)) {
    return candidate;
  }
  const repoMention = promptText.match(/\brepo(?:sitory)?\s+([a-z0-9_.-]+)/);
  return repoMention?.[1]?.replace(/[.:-]+$/g, '') || null;
}

function parseFilePath(prompt: string): string | null {
  const match = prompt.match(/\b([a-z0-9_.-]+\/[a-z0-9_./-]+\.[a-z0-9]+)\b/i);
  return match?.[1] || null;
}

function hasAny(promptText: string, terms: string[]): boolean {
  return terms.some((term) => promptText.includes(term));
}

function clarification(
  candidates: WorkspaceIntentCandidate[],
): WorkspaceIntentResult {
  const labels = candidates.map((candidate) => candidate.label);
  return {
    kind: 'clarification',
    confidence: 'low',
    approvalRequired: candidates.some((candidate) => candidate.kind === 'code'),
    reason: 'The channel prompt does not identify one clear workspace.',
    target: null,
    candidates,
    clarificationPrompt:
      'Which workspace should handle this? ' + labels.join(' / ') + '.',
  };
}

export function resolveWorkspaceIntent(
  input: WorkspaceIntentInput,
): WorkspaceIntentResult {
  const prompt = input.prompt || '';
  const promptText = normalizeText(prompt);
  const projects = input.projects || [];
  const threads = input.threads || [];
  const candidates: WorkspaceIntentCandidate[] = [];

  const issueNumber = parseIssueNumber(prompt);
  const repo = parseRepo(promptText);
  const codeTerms = [
    'github',
    'repo',
    'repository',
    'issue',
    'pr',
    'pull request',
    'diff',
    'bug',
    'fix',
  ];
  if (issueNumber || hasAny(promptText, codeTerms)) {
    candidates.push({
      kind: 'code',
      label: issueNumber
        ? `Code issue #${issueNumber}`
        : 'Code repo or implementation task',
      reason: 'Repository, issue, PR, diff, bug, or fix language was detected.',
      target: {
        ...(repo ? { repo } : {}),
        ...(issueNumber ? { issueNumber } : {}),
      },
    });
  }

  const project = matchProject(promptText, projects);
  const filePath = parseFilePath(prompt);
  const coworkTerms = [
    'cowork',
    'project',
    'artifact',
    'document',
    'brief',
    'summary',
    'email',
    'mail',
    'source',
    'mcp',
    'file',
  ];
  if (project || hasAny(promptText, coworkTerms)) {
    candidates.push({
      kind: 'cowork',
      label: project ? `Cowork project ${project.name}` : 'Cowork project',
      reason:
        'Project, file, source, document, artifact, email, or MCP language was detected.',
      target: {
        ...(project
          ? {
              projectId: project.id,
              projectName: project.name,
              projectSlug: project.slug || null,
            }
          : {}),
        ...(filePath ? { filePath } : {}),
      },
    });
  }

  const thread = matchPlainThread(promptText, threads);
  const chatTerms = ['chat', 'conversation', 'copilot', 'plain chat'];
  if (thread || hasAny(promptText, chatTerms)) {
    candidates.push({
      kind: 'copilot',
      label: thread ? `Copilot chat ${thread.title}` : 'Copilot chat',
      reason: 'Plain chat or conversation language was detected.',
      target: {
        ...(thread ? { threadId: thread.id, threadTitle: thread.title } : {}),
      },
    });
  }

  if (!candidates.length) {
    return clarification([
      {
        kind: 'copilot',
        label: 'Copilot chat',
        reason: 'Use for lightweight conversation or writing.',
      },
      {
        kind: 'cowork',
        label: 'Cowork project',
        reason:
          'Use for project files, source context, documents, and artifacts.',
      },
      {
        kind: 'code',
        label: 'Code repo',
        reason: 'Use for repositories, issues, diffs, and PR work.',
      },
    ]);
  }

  if (candidates.length > 1) {
    return clarification(candidates);
  }

  const [candidate] = candidates;
  return {
    kind: candidate.kind,
    confidence:
      candidate.target && Object.keys(candidate.target).length
        ? 'high'
        : 'medium',
    approvalRequired: candidate.kind === 'code',
    reason: candidate.reason,
    target: candidate.target || null,
    candidates,
    clarificationPrompt: null,
  };
}
