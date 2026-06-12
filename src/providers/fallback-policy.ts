// src/providers/fallback-policy.ts

export type FallbackAction =
  | 'read'
  | 'write'
  | 'publish'
  | 'external-message'
  | 'upload'
  | 'shell'
  | 'pr'
  | 'coding-implementation'
  | 'pr-creation'
  | 'automation-execution'
  | 'skill-installation'
  | 'provider-fallback';

export interface FallbackDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

interface ProfileLike {
  providerId: string;
  model: string;
  toolPolicy: string;
  privacyTier?: string;
}

interface TargetProfileLike {
  providerId: string;
  model: string;
  privacyTier?: string;
}

interface CapabilitiesLike {
  toolCalls: boolean;
  structuredOutput: boolean;
  codeStrength: string;
}

const READ_ACTIONS: Set<FallbackAction> = new Set(['read']);
const WRITE_ACTIONS: Set<FallbackAction> = new Set(['write']);
const DANGEROUS_ACTIONS: Set<FallbackAction> = new Set([
  'publish',
  'external-message',
  'upload',
  'shell',
  'pr',
  'coding-implementation',
  'pr-creation',
  'automation-execution',
  'skill-installation',
]);

export class FallbackPolicyManager {
  private approvalCache: Map<string, { approved: boolean; expiresAt: number }>;

  constructor() {
    this.approvalCache = new Map();
  }

  evaluateFallback(
    action: FallbackAction,
    sourceProfile: ProfileLike,
    targetProfile: TargetProfileLike,
    capabilities: CapabilitiesLike,
    hasFallbackConfigured: boolean = false,
  ): FallbackDecision {
    if (!hasFallbackConfigured) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: `no fallback provider configured for ${sourceProfile.providerId}/${sourceProfile.model}`,
      };
    }

    const capabilityCheck = this.checkCapabilities(action, capabilities);
    if (!capabilityCheck.allowed) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: capabilityCheck.reason,
      };
    }

    const cacheKey = this.cacheKey(sourceProfile, targetProfile, action);
    const cached = this.approvalCache.get(cacheKey);
    if (cached && cached.approved && cached.expiresAt > Date.now()) {
      return {
        allowed: true,
        requiresApproval: false,
        reason: `approved fallback from ${sourceProfile.providerId}/${sourceProfile.model} to ${targetProfile.providerId}/${targetProfile.model} for ${action} (cached)`,
      };
    }

    if (
      action === 'provider-fallback' &&
      this.crossesLocalPrivateBoundary(sourceProfile, targetProfile)
    ) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `provider fallback from local/private ${sourceProfile.providerId}/${sourceProfile.model} to hosted/third-party ${targetProfile.providerId}/${targetProfile.model} requires approval`,
      };
    }

    if (READ_ACTIONS.has(action)) {
      if (sourceProfile.toolPolicy === 'deny') {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `read fallback blocked by tool policy 'deny'`,
        };
      }
      return {
        allowed: true,
        requiresApproval: false,
        reason: `read fallback from ${sourceProfile.providerId}/${sourceProfile.model} to ${targetProfile.providerId}/${targetProfile.model}`,
      };
    }

    if (action === 'provider-fallback') {
      return {
        allowed: true,
        requiresApproval: false,
        reason: `provider fallback from ${sourceProfile.providerId}/${sourceProfile.model} to ${targetProfile.providerId}/${targetProfile.model}`,
      };
    }

    if (WRITE_ACTIONS.has(action)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `write action '${action}' requires approval to fall back from ${sourceProfile.providerId}/${sourceProfile.model} to ${targetProfile.providerId}/${targetProfile.model}`,
      };
    }

    if (DANGEROUS_ACTIONS.has(action)) {
      return {
        allowed: false,
        requiresApproval: true,
        reason: `dangerous action '${action}' requires approval to fall back from ${sourceProfile.providerId}/${sourceProfile.model} to ${targetProfile.providerId}/${targetProfile.model}`,
      };
    }

    return {
      allowed: false,
      requiresApproval: false,
      reason: `unknown action '${action}'`,
    };
  }

  approveFallback(
    sourceProviderId: string,
    targetProviderId: string,
    action: FallbackAction,
  ): void {
    const key = `${sourceProviderId}->${targetProviderId}:${action}`;
    this.approvalCache.set(key, {
      approved: true,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  }

  clearApprovalCache(): void {
    this.approvalCache.clear();
  }

  private cacheKey(
    sourceProfile: ProfileLike,
    targetProfile: TargetProfileLike,
    action: FallbackAction,
  ): string {
    return `${sourceProfile.providerId}->${targetProfile.providerId}:${action}`;
  }

  private checkCapabilities(
    action: FallbackAction,
    capabilities: CapabilitiesLike,
  ): { allowed: boolean; reason: string } {
    if (READ_ACTIONS.has(action)) {
      if (!capabilities.structuredOutput && !capabilities.toolCalls) {
        return {
          allowed: false,
          reason: `target provider lacks sufficient capabilities for ${action} (no tool calls or structured output)`,
        };
      }
      return { allowed: true, reason: '' };
    }

    if (action === 'provider-fallback') {
      return { allowed: true, reason: '' };
    }

    if (WRITE_ACTIONS.has(action) || DANGEROUS_ACTIONS.has(action)) {
      if (!capabilities.toolCalls) {
        return {
          allowed: false,
          reason: `target provider lacks tool call support required for '${action}'`,
        };
      }
      if (
        capabilities.codeStrength === 'none' ||
        capabilities.codeStrength === 'low'
      ) {
        return {
          allowed: false,
          reason: `target provider code strength '${capabilities.codeStrength}' insufficient for '${action}'`,
        };
      }
      return { allowed: true, reason: '' };
    }

    return { allowed: false, reason: `unknown action '${action}'` };
  }

  private crossesLocalPrivateBoundary(
    sourceProfile: ProfileLike,
    targetProfile: TargetProfileLike,
  ): boolean {
    const sourcePrivacy = sourceProfile.privacyTier || 'hosted';
    const targetPrivacy = targetProfile.privacyTier || 'hosted';
    return (
      (sourcePrivacy === 'local' || sourcePrivacy === 'private') &&
      (targetPrivacy === 'hosted' || targetPrivacy === 'third-party')
    );
  }
}
