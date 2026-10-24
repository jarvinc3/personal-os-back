import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiStatementExtractor } from './ai-statement.extractor';

describe('AiStatementExtractor through the neutral inference port', () => {
  const complete = jest.fn();
  const inference: InferenceCompletionPort = { complete };
  const extractor = new AiStatementExtractor(inference);

  beforeEach(() => jest.resetAllMocks());

  it('preserves amounts, currency and provider attribution in the extracted statement', async () => {
    complete.mockResolvedValue({
      content: JSON.stringify({
        currency: 'DOP',
        closingBalance: 3250.25,
        lines: [{ date: '2026-10-14', description: 'Compra', amount: 250.25 }],
      }),
      provider: 'fallback',
      model: 'model-two',
    });
    await expect(
      extractor.extract({ text: 'Compra 250.25' }),
    ).resolves.toMatchObject({
      ok: true,
      statement: {
        header: { currency: 'DOP', closingBalance: 3250.25 },
        lines: [{ amount: 250.25, currency: 'DOP', type: 'DEBIT' }],
      },
      provider: 'fallback',
      model: 'model-two',
    });
  });

  it('rejects invalid model amounts without admitting an unsafe statement', async () => {
    complete.mockResolvedValue({
      content: JSON.stringify({
        lines: [{ date: '2026-10-14', description: 'Compra', amount: -250 }],
      }),
      provider: 'test',
      model: 'test',
    });
    await expect(extractor.extract({ text: 'Compra' })).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it('keeps provider failures retryable for the import worker', async () => {
    complete.mockRejectedValue(new Error('providers unavailable'));
    await expect(extractor.extract({ text: 'Compra' })).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'providers unavailable',
    });
  });
});
