// src/providers/model-capabilities.ts

export interface ModelCapability {
  providerId: string;
  model: string;
  capabilities: {
    toolCalls: boolean;
    structuredOutput: boolean;
    streaming: boolean;
    vision: boolean;
    codeStrength: 'low' | 'medium' | 'high';
    contextWindow: number;
    costTier: 'low' | 'medium' | 'high';
    privacyTier: 'low' | 'medium' | 'high';
    supportsMcpStrategy: boolean;
  };
  lastProbeAt?: Date;
  probeStatus: 'success' | 'failed' | 'pending';
}