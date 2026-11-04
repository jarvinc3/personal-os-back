import { createGroqProvider } from '../providers/groq.provider';
import { createOpenRouterProvider } from '../providers/openrouter.provider';
import type { AIService } from '../shared/ai.types';

export type AiProviderKeys = {
  groqApiKey?: string;
  openRouterApiKey?: string;
};

/**
 * Builds the provider pool from the configured keys. A missing key disables
 * that provider instead of failing the boot.
 */
export function createAiProviderPool({
  groqApiKey,
  openRouterApiKey,
}: AiProviderKeys): AIService[] {
  const providers: AIService[] = [];

  if (groqApiKey) {
    providers.push(createGroqProvider(groqApiKey));
  }
  if (openRouterApiKey) {
    providers.push(createOpenRouterProvider(openRouterApiKey));
  }

  return providers;
}
