import { describe, expect, it } from 'vitest';

import { estimateCoworkRun } from './cowork-run-estimator.js';

describe('cowork run estimator', () => {
  it('classifies connector-heavy write tasks with approval warnings', () => {
    const estimate = estimateCoworkRun({
      title: 'Send project brief',
      prompt:
        'Use Gmail and calendar connector context, create the document, then send it externally.',
      provider: 'openrouter',
      model: 'openrouter/auto',
      connectorIds: ['gmail', 'google-calendar'],
      actionType: 'external-write',
    });

    expect(estimate).toMatchObject({
      complexity: 'connector-heavy',
      approvalRisk: 'high',
      provider: 'openrouter',
      model: 'openrouter/auto',
      toolClasses: expect.arrayContaining(['connectors', 'external-write']),
    });
    expect(estimate.warnings).toEqual(
      expect.arrayContaining([
        'Write-capable or external delivery language requires approval before mutation.',
      ]),
    );
  });

  it('warns when included project context is large', () => {
    const estimate = estimateCoworkRun({
      title: 'Build a project brief',
      prompt: 'Use the pinned project context and summarize it.',
      contextItemCount: 14,
      contextSizeBytes: 2_200_000,
    });

    expect(estimate.complexity).toBe('long');
    expect(estimate.warnings).toContain(
      'Large project context may increase runtime and model fallback risk.',
    );
  });
});
