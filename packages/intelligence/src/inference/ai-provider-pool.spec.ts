import { createAiProviderPool } from './ai-provider-pool';

describe('createAiProviderPool', () => {
  it('builds only the providers with a configured key', () => {
    const pool = createAiProviderPool({
      groqApiKey: 'groq-test-key',
      openRouterApiKey: 'openrouter-test-key',
    });

    expect(pool.map((provider) => provider.name)).toEqual([
      'Groq',
      'OpenRouter',
    ]);
  });

  it('skips a provider when its key is empty', () => {
    const pool = createAiProviderPool({
      groqApiKey: '',
      openRouterApiKey: 'openrouter-test-key',
    });

    expect(pool.map((provider) => provider.name)).toEqual(['OpenRouter']);
  });

  it('returns an empty pool when no key is configured', () => {
    expect(createAiProviderPool({})).toEqual([]);
  });
});
