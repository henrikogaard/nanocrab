import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';

const DESIGN_SYSTEMS_PATH = path.join(STORE_DIR, 'design-systems.json');
const DESIGN_SYSTEM_CONTENT_LIMIT = 512 * 1024;

export interface DesignSystem {
  id: string;
  name: string;
  description: string | null;
  content: string;
  sourceFileName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignSystemStore {
  version: 1;
  defaultDesignSystemId: string | null;
  projectDefaults: Record<string, string>;
  systems: DesignSystem[];
}

export interface CreateDesignSystemInput {
  name: string;
  description?: string | null;
  content: string;
  sourceFileName?: string | null;
}

export interface UpdateDesignSystemInput {
  name?: string;
  description?: string | null;
  content?: string;
  sourceFileName?: string | null;
}

export interface ResolveDesignSystemInput {
  projectId?: string | null;
  requestedDesignSystem?: string | null;
}

function emptyStore(): DesignSystemStore {
  return {
    version: 1,
    defaultDesignSystemId: null,
    projectDefaults: {},
    systems: [],
  };
}

function readStore(): DesignSystemStore {
  try {
    const raw = JSON.parse(fs.readFileSync(DESIGN_SYSTEMS_PATH, 'utf-8')) as
      | Partial<DesignSystemStore>
      | undefined;
    const systems = Array.isArray(raw?.systems)
      ? raw.systems.filter(isDesignSystem)
      : [];
    const ids = new Set(systems.map((system) => system.id));
    const projectDefaults: Record<string, string> = {};
    if (raw?.projectDefaults && typeof raw.projectDefaults === 'object') {
      for (const [key, value] of Object.entries(raw.projectDefaults)) {
        if (typeof value === 'string' && ids.has(value)) {
          projectDefaults[projectKey(key)] = value;
        }
      }
    }
    const defaultDesignSystemId =
      typeof raw?.defaultDesignSystemId === 'string' &&
      ids.has(raw.defaultDesignSystemId)
        ? raw.defaultDesignSystemId
        : null;
    return {
      version: 1,
      defaultDesignSystemId,
      projectDefaults,
      systems,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: DesignSystemStore): void {
  fs.mkdirSync(path.dirname(DESIGN_SYSTEMS_PATH), { recursive: true });
  fs.writeFileSync(DESIGN_SYSTEMS_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function isDesignSystem(value: unknown): value is DesignSystem {
  if (!value || typeof value !== 'object') return false;
  const system = value as Record<string, unknown>;
  return (
    typeof system.id === 'string' &&
    typeof system.name === 'string' &&
    typeof system.content === 'string' &&
    typeof system.createdAt === 'string' &&
    typeof system.updatedAt === 'string'
  );
}

function requiredText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function designSystemContent(value: unknown): string {
  const content = requiredText(value, 'Design system content');
  if (Buffer.byteLength(content, 'utf-8') > DESIGN_SYSTEM_CONTENT_LIMIT) {
    throw new Error('Design system content is too large');
  }
  return content;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeSourceFileName(value: unknown): string | null {
  const text = optionalText(value);
  if (!text) return null;
  return path.basename(text).replace(/[\0]/g, '') || null;
}

function projectKey(projectId: string | null | undefined): string {
  return String(projectId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

function findSystem(
  store: DesignSystemStore,
  value: string,
): DesignSystem | null {
  const lookup = normalizeLookup(value);
  return (
    store.systems.find(
      (system) =>
        normalizeLookup(system.id) === lookup ||
        normalizeLookup(system.name) === lookup,
    ) || null
  );
}

function assertExistingSystem(
  store: DesignSystemStore,
  designSystemId: string,
): DesignSystem {
  const system = store.systems.find((item) => item.id === designSystemId);
  if (!system) throw new Error(`Design system not found: ${designSystemId}`);
  return system;
}

function xmlText(value: unknown): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function listDesignSystems(): DesignSystemStore {
  const store = readStore();
  return {
    ...store,
    systems: [...store.systems].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  };
}

export function createDesignSystem(
  input: CreateDesignSystemInput,
): DesignSystem {
  const store = readStore();
  const now = new Date().toISOString();
  const system: DesignSystem = {
    id: `design-system-${randomUUID()}`,
    name: requiredText(input.name, 'Design system name'),
    description: optionalText(input.description),
    content: designSystemContent(input.content),
    sourceFileName: safeSourceFileName(input.sourceFileName),
    createdAt: now,
    updatedAt: now,
  };
  store.systems.push(system);
  writeStore(store);
  return system;
}

export function updateDesignSystem(
  id: string,
  input: UpdateDesignSystemInput,
): DesignSystem {
  const store = readStore();
  const index = store.systems.findIndex((system) => system.id === id);
  if (index < 0) throw new Error(`Design system not found: ${id}`);
  const current = store.systems[index];
  const updated: DesignSystem = {
    ...current,
    name:
      input.name === undefined
        ? current.name
        : requiredText(input.name, 'Design system name'),
    description:
      input.description === undefined
        ? current.description
        : optionalText(input.description),
    content:
      input.content === undefined
        ? current.content
        : designSystemContent(input.content),
    sourceFileName:
      input.sourceFileName === undefined
        ? current.sourceFileName
        : safeSourceFileName(input.sourceFileName),
    updatedAt: new Date().toISOString(),
  };
  store.systems[index] = updated;
  writeStore(store);
  return updated;
}

export function deleteDesignSystem(id: string): boolean {
  const store = readStore();
  const nextSystems = store.systems.filter((system) => system.id !== id);
  if (nextSystems.length === store.systems.length) return false;
  store.systems = nextSystems;
  if (store.defaultDesignSystemId === id) {
    store.defaultDesignSystemId = null;
  }
  for (const [key, value] of Object.entries(store.projectDefaults)) {
    if (value === id) delete store.projectDefaults[key];
  }
  writeStore(store);
  return true;
}

export function setDefaultDesignSystem(id: string | null): string | null {
  const store = readStore();
  if (id) assertExistingSystem(store, id);
  store.defaultDesignSystemId = id;
  writeStore(store);
  return id;
}

export function setProjectDefaultDesignSystem(
  projectId: string,
  id: string | null,
): string | null {
  const key = projectKey(projectId);
  if (!key) throw new Error('Project id is required');
  const store = readStore();
  if (id) {
    assertExistingSystem(store, id);
    store.projectDefaults[key] = id;
  } else {
    delete store.projectDefaults[key];
  }
  writeStore(store);
  return id;
}

export function getProjectDefaultDesignSystemId(
  projectId: string | null | undefined,
): string | null {
  const key = projectKey(projectId);
  if (!key) return null;
  return readStore().projectDefaults[key] || null;
}

export function resolveDesignSystemForRequest(
  input: ResolveDesignSystemInput,
): DesignSystem | null {
  const store = readStore();
  if (input.requestedDesignSystem?.trim()) {
    return findSystem(store, input.requestedDesignSystem) || null;
  }
  const key = projectKey(input.projectId);
  const projectDefaultId = key ? store.projectDefaults[key] : null;
  if (projectDefaultId) {
    return assertExistingSystem(store, projectDefaultId);
  }
  if (store.defaultDesignSystemId) {
    return assertExistingSystem(store, store.defaultDesignSystemId);
  }
  return null;
}

export function buildDesignSystemPromptContext(
  system: DesignSystem | null | undefined,
  options: { source?: string } = {},
): string {
  if (!system) return '';
  const source = options.source || 'selected';
  return [
    `<design_system source="${xmlText(source)}" id="${xmlText(system.id)}">`,
    `  <name>${xmlText(system.name)}</name>`,
    system.description
      ? `  <description>${xmlText(system.description)}</description>`
      : '',
    system.sourceFileName
      ? `  <source_file>${xmlText(system.sourceFileName)}</source_file>`
      : '',
    '  <instructions>',
    xmlText(system.content),
    '  </instructions>',
    '</design_system>',
  ]
    .filter(Boolean)
    .join('\n');
}

export function designSystemSelectionSummary(input: {
  projectId?: string | null;
  requestedDesignSystem?: string | null;
}): {
  selected: DesignSystem | null;
  source: 'explicit' | 'project-default' | 'global-default' | 'none';
} {
  const store = readStore();
  if (input.requestedDesignSystem?.trim()) {
    return {
      selected: findSystem(store, input.requestedDesignSystem),
      source: 'explicit',
    };
  }
  const key = projectKey(input.projectId);
  const projectDefaultId = key ? store.projectDefaults[key] : null;
  if (projectDefaultId) {
    return {
      selected: assertExistingSystem(store, projectDefaultId),
      source: 'project-default',
    };
  }
  if (store.defaultDesignSystemId) {
    return {
      selected: assertExistingSystem(store, store.defaultDesignSystemId),
      source: 'global-default',
    };
  }
  return { selected: null, source: 'none' };
}
