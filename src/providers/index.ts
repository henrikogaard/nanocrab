import {
  openaiResponsesProvider,
  type Provider,
  type ProviderCapabilitiesResult,
  type ProviderTask,
  type ProviderOutput,
} from './openai-responses/provider.js';
import { anthropicMessagesProvider } from './anthropic-messages/provider.js';
import { geminiProvider } from './gemini/provider.js';
import { mistralProvider } from './mistral/provider.js';
import { openaiCompatibleProvider } from './openai-compatible/provider.js';

export type {
  Provider,
  ProviderCapabilitiesResult,
  ProviderTask,
  ProviderOutput,
};

const registeredProviders: Provider[] = [
  openaiResponsesProvider,
  anthropicMessagesProvider,
  geminiProvider,
  mistralProvider,
  openaiCompatibleProvider,
];

export function getProviderById(id: string): Provider | undefined {
  return registeredProviders.find((p) => p.id === id);
}

export function getAllProviders(): Provider[] {
  return [...registeredProviders];
}

export { openaiResponsesProvider, anthropicMessagesProvider, geminiProvider, mistralProvider, openaiCompatibleProvider };
