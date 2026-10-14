import type { AiChatCompletionPort } from '@personal-os/core';
import { AiQuickEntryExtractor } from './ai-quick-entry.extractor';
import type { QuickEntryExtractionInput } from '../application/ports/quick-entry-extractor.port';

const input: QuickEntryExtractionInput = {
  text: 'café 250 popular',
  todayIso: '2026-10-14',
  baseCurrency: 'DOP',
  categories: [],
  accounts: [],
  cards: [],
};

const validPayload = {
  type: 'DEBIT',
  amount: '250',
  currency: 'DOP',
  categoryNameHint: 'Café',
  accountHint: 'popular',
  cardHint: null,
  date: '2026-10-13',
  merchant: 'Café',
  description: null,
  confidence: 0.8,
};

function completion(payload: unknown) {
  return { content: JSON.stringify(payload), provider: 'test', model: 'test' };
}

describe('AiQuickEntryExtractor', () => {
  const chatComplete = jest.fn();
  const aiService = { chatComplete } as unknown as AiChatCompletionPort;
  const extractor = new AiQuickEntryExtractor(aiService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the parsed draft for a valid payload', async () => {
    chatComplete.mockResolvedValue(completion(validPayload));

    await expect(extractor.extract(input)).resolves.toMatchObject({
      type: 'DEBIT',
      amount: '250.00',
      currency: 'DOP',
      categoryNameHint: 'Café',
      accountHint: 'popular',
      date: '2026-10-13',
      merchant: 'Café',
      confidence: 0.8,
    });
  });

  it('keeps a null date when the sentence states none', async () => {
    chatComplete.mockResolvedValue(completion({ ...validPayload, date: null }));

    await expect(extractor.extract(input)).resolves.toMatchObject({
      date: null,
    });
  });

  it('rejects an impossible calendar date', async () => {
    chatComplete.mockResolvedValue(
      completion({ ...validPayload, date: '2026-02-31' }),
    );

    await expect(extractor.extract(input)).rejects.toThrow(
      'Quick entry payload failed validation',
    );
  });

  it('rejects a response that is not JSON', async () => {
    chatComplete.mockResolvedValue({
      content: 'no json here',
      provider: 'test',
      model: 'test',
    });

    await expect(extractor.extract(input)).rejects.toThrow(
      'Quick entry model did not return JSON',
    );
  });
});
