import { describe, expect, it } from 'vitest';

import { resolveWorkspaceIntent } from './workspace-intent.js';

const projects = [
  { id: 'project-auroradocs', name: 'AuroraDocs', slug: 'auroradocs' },
  { id: 'project-ops', name: 'Ops Briefs', slug: 'ops-briefs' },
];

const threads = [
  {
    id: 'web:deploy-plan',
    title: 'Deploy plan review',
    projectId: null,
  },
  {
    id: 'web:auroradocs-brief',
    title: 'AuroraDocs source brief',
    projectId: 'project-auroradocs',
  },
];

describe('workspace intent resolver', () => {
  it('routes source-backed project file requests to Cowork', () => {
    const result = resolveWorkspaceIntent({
      prompt:
        'Continue the AuroraDocs email brief using docs/brief.md and save a local summary.',
      channel: 'signal',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'cowork',
      confidence: 'high',
      target: {
        projectId: 'project-auroradocs',
        projectName: 'AuroraDocs',
        filePath: 'docs/brief.md',
      },
      clarificationPrompt: null,
    });
  });

  it('does not treat project wording as a PR code target', () => {
    const result = resolveWorkspaceIntent({
      prompt: 'Check Cowork for project AuroraDocs and send me the brief.',
      channel: 'signal',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'cowork',
      confidence: 'high',
      target: {
        projectId: 'project-auroradocs',
        projectName: 'AuroraDocs',
      },
      clarificationPrompt: null,
    });
  });

  it('routes repository issue prompts to Code with approval risk noted', () => {
    const result = resolveWorkspaceIntent({
      prompt: 'Fix GitHub issue #104 in nanocrab and prepare the PR plan.',
      channel: 'telegram',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'code',
      confidence: 'high',
      approvalRequired: true,
      target: {
        repo: 'nanocrab',
        issueNumber: 104,
      },
      clarificationPrompt: null,
    });
  });

  it('routes known plain chat thread references to Copilot chat', () => {
    const result = resolveWorkspaceIntent({
      prompt: 'Continue the deploy plan review conversation.',
      channel: 'whatsapp',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'copilot',
      confidence: 'high',
      target: {
        threadId: 'web:deploy-plan',
        threadTitle: 'Deploy plan review',
      },
      clarificationPrompt: null,
    });
  });

  it('asks for clarification when Code and Cowork both match', () => {
    const result = resolveWorkspaceIntent({
      prompt: 'Fix issue #104 for AuroraDocs and use the project files.',
      channel: 'signal',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'clarification',
      confidence: 'low',
    });
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      'code',
      'cowork',
    ]);
    expect(result.clarificationPrompt).toContain('Code issue #104');
    expect(result.clarificationPrompt).toContain('Cowork project AuroraDocs');
  });

  it('asks which workspace to use for vague channel prompts', () => {
    const result = resolveWorkspaceIntent({
      prompt: 'Can you continue this?',
      channel: 'telegram',
      projects,
      threads,
    });

    expect(result).toMatchObject({
      kind: 'clarification',
      confidence: 'low',
    });
    expect(result.candidates.map((candidate) => candidate.kind)).toEqual([
      'copilot',
      'cowork',
      'code',
    ]);
    expect(result.clarificationPrompt).toContain('Copilot chat');
    expect(result.clarificationPrompt).toContain('Cowork project');
    expect(result.clarificationPrompt).toContain('Code repo');
  });
});
