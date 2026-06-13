import { describe, expect, it } from 'vitest';

import {
  canUseChannelScope,
  canUseProviderProfile,
  canUseSkill,
  deriveRuntimeCapabilities,
  resolveAgentBoundary,
  type AgentBoundary,
} from './agent-boundaries.js';
import { PROVIDER_PURPOSES } from './provider-router.js';

const channelBoundary: AgentBoundary = {
  agentId: 'operations',
  groupFolder: 'operations',
  isMain: false,
  channelScopes: ['own'],
  filesystemScopes: [
    { containerPath: '/workspace/group', access: 'read-write' },
    { containerPath: '/workspace/global', access: 'read-only' },
  ],
  skillScopes: {
    allowedScopes: ['all', 'channels'],
    allowedVisibility: ['shared'],
  },
  providerProfiles: ['default_chat', 'default_automation'],
  connectorIds: ['nanocrab', 'github'],
  externalWrites: {
    allowed: false,
    requiresApproval: true,
  },
};

describe('agent boundaries', () => {
  it('builds elevated boundaries for main agents', () => {
    const boundary = resolveAgentBoundary({
      group: {
        name: 'Main',
        folder: 'main',
        trigger: '@NanoCrab',
        added_at: '2026-06-13T10:00:00.000Z',
        isMain: true,
      },
      isMain: true,
      availableConnectorIds: ['nanocrab', 'github', 'infomaniak'],
    });

    expect(boundary.channelScopes).toContain('all');
    expect(boundary.skillScopes.allowedVisibility).toContain('private');
    expect(boundary.providerProfiles).toContain('default_coding');
    expect(boundary.connectorIds).toEqual(['nanocrab', 'github', 'infomaniak']);
  });

  it('denies private skills to unauthorized channel agents', () => {
    expect(
      canUseSkill(channelBoundary, {
        enabled: true,
        scope: 'all',
        visibility: 'private',
      }),
    ).toBe(false);
  });

  it('denies disallowed channel scopes', () => {
    expect(canUseChannelScope(channelBoundary, 'own')).toBe(true);
    expect(canUseChannelScope(channelBoundary, 'all')).toBe(false);
  });

  it('denies provider profiles outside the agent boundary', () => {
    expect(canUseProviderProfile(channelBoundary, 'default_chat')).toBe(true);
    expect(canUseProviderProfile(channelBoundary, 'default_coding')).toBe(
      false,
    );
  });

  it('uses only canonical provider purpose names in default boundaries', () => {
    const providerPurposeSet = new Set<string>(PROVIDER_PURPOSES);
    const mainBoundary = resolveAgentBoundary({
      group: {
        name: 'Main',
        folder: 'main',
        trigger: '@NanoCrab',
        added_at: '2026-06-13T10:00:00.000Z',
        isMain: true,
      },
      isMain: true,
    });
    const resolvedChannelBoundary = resolveAgentBoundary({
      group: {
        name: 'Operations',
        folder: 'operations',
        trigger: '@NanoCrab',
        added_at: '2026-06-13T10:00:00.000Z',
      },
      isMain: false,
    });

    expect(mainBoundary.providerProfiles).toEqual(
      expect.arrayContaining(['default_docs']),
    );
    expect(resolvedChannelBoundary.providerProfiles).toEqual(
      expect.arrayContaining(['default_docs']),
    );
    expect(canUseProviderProfile(mainBoundary, 'default_docs')).toBe(true);
    expect(canUseProviderProfile(resolvedChannelBoundary, 'default_docs')).toBe(
      true,
    );
    expect(
      [
        ...mainBoundary.providerProfiles,
        ...resolvedChannelBoundary.providerProfiles,
      ].filter((profile) => !providerPurposeSet.has(profile)),
    ).toEqual([]);
  });

  it('derives runtime capabilities without out-of-scope connectors or write tools', () => {
    const capabilities = deriveRuntimeCapabilities(channelBoundary, {
      connectorIds: ['nanocrab', 'github', 'infomaniak'],
      requestedConnectorIds: ['github', 'infomaniak'],
    });

    expect(capabilities.allowedConnectorIds).toEqual(['github']);
    expect(capabilities.allowExternalWrites).toBe(false);
    expect(capabilities.allowedToolActions).not.toContain('external.write');
  });

  it('keeps explicit group MCP restrictions inside the broader boundary', () => {
    const boundary = resolveAgentBoundary({
      group: {
        name: 'Operations',
        folder: 'operations',
        trigger: '@NanoCrab',
        added_at: '2026-06-13T10:00:00.000Z',
        containerConfig: { allowedMcpServers: ['github'] },
      },
      isMain: false,
      availableConnectorIds: ['nanocrab', 'github', 'infomaniak'],
    });

    expect(boundary.connectorIds).toEqual(['nanocrab', 'github']);
  });
});
