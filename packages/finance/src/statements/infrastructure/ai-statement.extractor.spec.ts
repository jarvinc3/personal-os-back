import type {
  InferenceCompletionPort,
  StructuredInferenceRequest,
} from '@personal-os/contracts';
import {
  StructuredInferenceOutputError,
  StructuredInferenceProviderError,
} from '@personal-os/contracts';
import { AiStatementExtractor } from './ai-statement.extractor';
import type { StatementExtractionInput } from '../application/ports/statement-extractor.port';

describe('AiStatementExtractor through the neutral inference gateway', () => {
  const infer = jest.fn();
  const inference = { infer } as unknown as InferenceCompletionPort;
  const extractor = new AiStatementExtractor(inference);
  const input: StatementExtractionInput = {
    userId: 'user-1',
    sourceId: 'import-1',
    text: 'Compra 250.25',
  };

  beforeEach(() => jest.resetAllMocks());

  it('preserves amounts, currency and provider attribution', async () => {
    infer.mockImplementation(
      (request: StructuredInferenceRequest<unknown>) => ({
        value: request.validate({
          currency: 'DOP',
          closingBalance: 3250.25,
          lines: [
            { date: '2026-10-14', description: 'Compra', amount: 250.25 },
          ],
        }),
        provider: 'fallback',
        model: 'model-two',
        latencyMs: 20,
        fallbackCount: 1,
        inputTokens: 12,
        outputTokens: 23,
      }),
    );
    await expect(extractor.extract(input)).resolves.toMatchObject({
      ok: true,
      statement: {
        header: { currency: 'DOP', closingBalance: 3250.25 },
        lines: [{ amount: 250.25, currency: 'DOP', type: 'DEBIT' }],
      },
      provider: 'fallback',
      model: 'model-two',
    });
    expect(infer).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'finance.statement-extraction',
        userId: 'user-1',
        sourceType: 'statement_import',
        sourceId: 'import-1',
      }),
    );
  });

  it('rejects invalid model amounts without admitting an unsafe statement', async () => {
    infer.mockImplementation((request: StructuredInferenceRequest<unknown>) => {
      try {
        return request.validate({
          lines: [{ date: '2026-10-14', description: 'Compra', amount: -250 }],
        });
      } catch {
        throw new StructuredInferenceOutputError();
      }
    });
    await expect(extractor.extract(input)).resolves.toMatchObject({
      ok: false,
      retryable: false,
    });
  });

  it('keeps provider failures retryable for the import worker', async () => {
    infer.mockRejectedValue(new StructuredInferenceProviderError(true));
    await expect(extractor.extract(input)).resolves.toEqual({
      ok: false,
      retryable: true,
      reason: 'AI inference provider unavailable',
    });
  });

  it('classifies exhausted structured-output fallback as non-retryable', async () => {
    infer.mockRejectedValue(new StructuredInferenceOutputError());
    await expect(extractor.extract(input)).resolves.toEqual({
      ok: false,
      retryable: false,
      reason: 'Extracted statement failed schema validation',
    });
  });
});
