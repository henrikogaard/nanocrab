import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const STORE_DIR = path.join(
  os.tmpdir(),
  `nanocrab-design-systems-test-${Date.now()}`,
);

vi.mock('./config.js', () => ({
  STORE_DIR,
}));

const {
  buildDesignSystemPromptContext,
  createDesignSystem,
  deleteDesignSystem,
  listDesignSystems,
  resolveDesignSystemForRequest,
  setDefaultDesignSystem,
  setProjectDefaultDesignSystem,
} = await import('./design-systems.js');

describe('design systems', () => {
  beforeEach(() => {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
  });

  it('stores uploaded design systems and resolves global and project defaults', () => {
    const system = createDesignSystem({
      name: 'Investor Deck',
      description: 'Board-ready presentation style.',
      content:
        '# Investor Deck\n\nUse sparse slides, restrained color, and source-backed claims.',
      sourceFileName: 'investor-deck.md',
    });

    expect(system.id).toMatch(/^design-system-/);
    expect(listDesignSystems().systems).toEqual([
      expect.objectContaining({
        id: system.id,
        name: 'Investor Deck',
        sourceFileName: 'investor-deck.md',
      }),
    ]);

    setDefaultDesignSystem(system.id);
    setProjectDefaultDesignSystem('project-aurora', system.id);

    expect(resolveDesignSystemForRequest({})?.id).toBe(system.id);
    expect(
      resolveDesignSystemForRequest({ projectId: 'project-aurora' })?.id,
    ).toBe(system.id);
    expect(listDesignSystems().defaultDesignSystemId).toBe(system.id);
    expect(listDesignSystems().projectDefaults.project_aurora).toBe(system.id);
  });

  it('lets an explicit id or name override defaults for a single generation', () => {
    const brand = createDesignSystem({
      name: 'Brand System',
      content: 'Use official brand typography and tone.',
    });
    const memo = createDesignSystem({
      name: 'Executive Memo',
      content: 'Use a crisp memo structure with decisions first.',
    });
    setProjectDefaultDesignSystem('project-aurora', brand.id);

    expect(
      resolveDesignSystemForRequest({
        projectId: 'project-aurora',
        requestedDesignSystem: memo.id,
      })?.id,
    ).toBe(memo.id);
    expect(
      resolveDesignSystemForRequest({
        projectId: 'project-aurora',
        requestedDesignSystem: 'executive memo',
      })?.id,
    ).toBe(memo.id);
  });

  it('renders agent prompt context without leaking unrelated systems', () => {
    const system = createDesignSystem({
      name: 'Document Standard',
      description: 'Default document generation style.',
      content: '<h1>Use clean headings</h1>\nKeep citations visible.',
    });
    createDesignSystem({
      name: 'Other System',
      content: 'This should not be injected.',
    });

    const context = buildDesignSystemPromptContext(system, {
      source: 'project-default',
    });

    expect(context).toContain('<design_system source="project-default"');
    expect(context).toContain('Document Standard');
    expect(context).toContain('&lt;h1&gt;Use clean headings&lt;/h1&gt;');
    expect(context).not.toContain('Other System');
  });

  it('removes deleted systems from defaults', () => {
    const system = createDesignSystem({
      name: 'Temporary System',
      content: 'Temporary design rules.',
    });
    setDefaultDesignSystem(system.id);
    setProjectDefaultDesignSystem('project-aurora', system.id);

    deleteDesignSystem(system.id);

    expect(resolveDesignSystemForRequest({ projectId: 'project-aurora' })).toBe(
      null,
    );
    expect(listDesignSystems().defaultDesignSystemId).toBeNull();
    expect(listDesignSystems().projectDefaults).toEqual({});
  });
});
