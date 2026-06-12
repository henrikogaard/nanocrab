// src/providers/capability-probe.ts

export interface ProviderCapability {
  toolCalls: boolean;
  structuredOutput: boolean;
  streaming: boolean;
  vision: boolean;
  codeStrength: 'low' | 'medium' | 'high';
  contextWindow: number;
  costTier: 'low' | 'medium' | 'high';
  privacyTier: 'low' | 'medium' | 'high';
  supportsMcpStrategy: boolean;
}

export interface ModelProbeResult {
  model: string;
  capabilities: ProviderCapability;
  probeStatus: 'success' | 'failed' | 'timeout';
  errorMessage?: string;
  timestamp: Date;
}

export interface CapabilityProbe {
  providerId: string;
  model: string;
  capabilities: ProviderCapability;
  lastProbeAt?: Date;
  probeStatus: 'success' | 'failed' | 'pending';
}