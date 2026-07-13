import { describe, expect, it } from 'vitest';

import {
  AGENT_PROVIDER_DEFINITIONS as _AGENT_PROVIDER_DEFINITIONS,
  CODING_PROVIDER_IDS,
  DEFAULT_AGENT_MODELS,
  AGENT_PROVIDER_MODELS,
  isCodingCapableProvider,
  isAgentProvider,
  getAgentProviderDefinition,
} from './agent-provider.js';
import {
  getAgentRuntimeDefinition,
  listAgentRuntimeDefinitions,
} from './agent-runtime-registry.js';

describe('coding-runner adapters', () => {
  describe('pi adapter', () => {
    it('is registered as an agent provider', () => {
      expect(isAgentProvider('pi')).toBe(true);
    });

    it('has a provider definition', () => {
      const def = getAgentProviderDefinition('pi');
      expect(def).toBeDefined();
      expect(def.id).toBe('pi');
      expect(def.requiresCli).toBe('pi');
      expect(def.selectable).toBe(true);
    });

    it('has default model and model list', () => {
      expect(DEFAULT_AGENT_MODELS.pi).toBeDefined();
      expect(AGENT_PROVIDER_MODELS.pi.length).toBeGreaterThan(0);
    });

    it('is coding-capable', () => {
      expect(isCodingCapableProvider('pi')).toBe(true);
    });

    it('is in CODING_PROVIDER_IDS', () => {
      expect(CODING_PROVIDER_IDS.has('pi')).toBe(true);
    });

    it('has codingRunnerSupported in runtime registry', () => {
      const def = getAgentRuntimeDefinition('pi');
      expect(def).toBeDefined();
      expect(def?.codingRunnerSupported).toBe(true);
      expect(def?.executable).toBe('pi');
    });
  });

  describe('devin adapter', () => {
    it('is registered as an agent provider', () => {
      expect(isAgentProvider('devin')).toBe(true);
    });

    it('has a provider definition', () => {
      const def = getAgentProviderDefinition('devin');
      expect(def).toBeDefined();
      expect(def.id).toBe('devin');
      expect(def.requiresCli).toBe('devin');
      expect(def.selectable).toBe(true);
    });

    it('has default model and model list', () => {
      expect(DEFAULT_AGENT_MODELS.devin).toBeDefined();
      expect(AGENT_PROVIDER_MODELS.devin.length).toBeGreaterThan(0);
    });

    it('is not coding-capable', () => {
      expect(isCodingCapableProvider('devin')).toBe(false);
    });

    it('is not in CODING_PROVIDER_IDS', () => {
      expect(CODING_PROVIDER_IDS.has('devin')).toBe(false);
    });

    it('is marked unsupported in the runtime registry', () => {
      const def = getAgentRuntimeDefinition('devin');
      expect(def).toBeDefined();
      expect(def?.codingRunnerSupported).toBe(false);
      expect(def?.executable).toBe('devin');
    });
  });

  describe('mistral vibe adapter', () => {
    it('is registered as an agent provider', () => {
      expect(isAgentProvider('mistral')).toBe(true);
    });

    it('is coding-capable', () => {
      expect(isCodingCapableProvider('mistral')).toBe(true);
    });

    it('is in CODING_PROVIDER_IDS', () => {
      expect(CODING_PROVIDER_IDS.has('mistral')).toBe(true);
    });

    it('has codingRunnerSupported in runtime registry', () => {
      const def = getAgentRuntimeDefinition('mistral');
      expect(def).toBeDefined();
      expect(def?.codingRunnerSupported).toBe(true);
      expect(def?.executable).toBe('vibe');
    });
  });

  describe('runtime registry completeness', () => {
    it('all coding providers have runtime definitions', () => {
      const runtimes = listAgentRuntimeDefinitions();
      const supported = runtimes.filter((r) => r.codingRunnerSupported);
      const supportedClis = supported.map((r) => r.cli);
      expect(supportedClis).toContain('claude');
      expect(supportedClis).toContain('codex');
      expect(supportedClis).toContain('opencode');
      expect(supportedClis).toContain('pi');
      expect(supportedClis).toContain('mistral');
      expect(supportedClis).not.toContain('devin');
    });
  });
});
