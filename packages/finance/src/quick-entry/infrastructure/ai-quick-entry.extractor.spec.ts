import type {
  InferenceCompletionPort,
  StructuredInferenceRequest,
} from '@personal-os/contracts';
import { StructuredInferenceOutputError } from '@personal-os/contracts';
import { AiQuickEntryExtractor } from './ai-quick-entry.extractor';
import type {
  QuickEntryExtraction,
  QuickEntryExtractionInput,
} from '../application/ports/quick-entry-extractor.port';

const input: QuickEntryExtractionInput = {
  userId: 'user-1',
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

describe('AiQuickEntryExtractor', () => {
  const infer = jest.fn();
  const aiService = { infer } as unknown as InferenceCompletionPort;
  const extractor = new AiQuickEntryExtractor(aiService);
  let payload: unknown = validPayload;

  beforeEach(() => {
    jest.clearAllMocks();
    payload = validPayload;
    infer.mockImplementation(
      (request: StructuredInferenceRequest<QuickEntryExtraction>) => ({
        value: request.validate(payload),
        provider: 'test',
        model: 'test',
        latencyMs: 1,
        fallbackCount: 0,
        inputTokens: null,
        outputTokens: null,
      }),
    );
  });

  it('returns the validated draft and associates telemetry with the user', async () => {
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
    expect(infer).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'finance.quick-entry',
        userId: 'user-1',
        sourceType: 'quick_entry',
        promptVersion: 'quick-entry-v1',
      }),
    );
  });

  it('keeps a null date when the sentence states none', async () => {
    payload = { ...validPayload, date: null };
    await expect(extractor.extract(input)).resolves.toMatchObject({
      date: null,
    });
  });

  it('rejects an impossible calendar date after gateway validation', async () => {
    payload = { ...validPayload, date: '2026-02-31' };
    await expect(extractor.extract(input)).rejects.toThrow();
  });

  it('surfaces a final structured-output failure', async () => {
    infer.mockRejectedValue(new StructuredInferenceOutputError());
    await expect(extractor.extract(input)).rejects.toBeInstanceOf(
      StructuredInferenceOutputError,
    );
  });
});
