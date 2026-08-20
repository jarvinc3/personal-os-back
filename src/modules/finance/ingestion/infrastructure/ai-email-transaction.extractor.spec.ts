import { AiService } from '../../../ai-agent';
import { FinanceModule } from '../../index';
import { AiEmailTransactionExtractor } from './ai-email-transaction.extractor';

describe('AiEmailTransactionExtractor circular barrels', () => {
  it('keeps AiService defined after FinanceModule loads ai-agent', () => {
    expect(FinanceModule).toBeDefined();
    expect(AiEmailTransactionExtractor).toBeDefined();
    expect(AiService).toBeDefined();
    expect(typeof AiService).toBe('function');
  });
});

describe('AiEmailTransactionExtractor', () => {
  const chatComplete = jest.fn();
  const aiService = { chatComplete } as unknown as AiService;
  const extractor = new AiEmailTransactionExtractor(aiService);

  const input = {
    from: 'alerts@bank.example',
    subject: 'Purchase',
    body: 'You spent 12.50 DOP at Coffee Shop',
    bankDomain: 'bank.example',
  };

  const validPayload = {
    kind: 'transaction' as const,
    amount: 12.5,
    currency: 'DOP',
    type: 'DEBIT',
    transactionDate: '2026-08-01',
    merchant: 'Coffee Shop',
    description: 'Purchase at Coffee Shop',
    categoryNameHint: null,
    bankStatusRaw: 'APPROVED',
    bankStatusNormalized: 'APPROVED',
    statusEvidence: 'APPROVED',
    statusConfidence: 0.95,
    reverseOfEmailMessageId: null,
    reverseOriginalRef: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ok false when model does not return JSON', async () => {
    chatComplete.mockResolvedValue({
      content: 'no json here',
      provider: 'groq',
      model: 'test',
    });

    await expect(extractor.extract(input)).resolves.toEqual({
      ok: false,
      reason: 'Model did not return JSON',
      retryable: true,
    });
  });

  it('returns ok false when model returns invalid JSON', async () => {
    chatComplete.mockResolvedValue({
      content: '{not-json}',
      provider: 'groq',
      model: 'test',
    });

    await expect(extractor.extract(input)).resolves.toEqual({
      ok: false,
      reason: 'Model returned invalid JSON',
      retryable: true,
    });
  });

  it('returns ok false when transaction payload fails schema validation', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify({ ...validPayload, amount: -1 }),
      provider: 'groq',
      model: 'test',
    });

    await expect(extractor.extract(input)).resolves.toEqual({
      ok: false,
      reason: 'Extracted payload failed schema validation',
      retryable: false,
    });
  });

  it('returns kind transaction with validated data on happy path', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify(validPayload),
      provider: 'groq',
      model: 'test-model',
    });

    const { kind: _kind, ...data } = validPayload;
    await expect(extractor.extract(input)).resolves.toEqual({
      ok: true,
      kind: 'transaction',
      data,
      provider: 'groq',
      model: 'test-model',
    });
  });

  it('returns kind not_transaction for promo / newsletter payloads', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify({
        kind: 'not_transaction',
        reason: 'Promotional newsletter, no account movement',
      }),
      provider: 'groq',
      model: 'test-model',
    });

    await expect(
      extractor.extract({
        ...input,
        subject: 'Win $50 this week!',
        body: 'Open an account and win $50. No charge applied.',
      }),
    ).resolves.toEqual({
      ok: true,
      kind: 'not_transaction',
      reason: 'Promotional newsletter, no account movement',
      provider: 'groq',
      model: 'test-model',
    });
  });
});
