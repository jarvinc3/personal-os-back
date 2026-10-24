import type { InferenceCompletionPort } from '@personal-os/contracts';
import { AiEmailTransactionExtractor } from './ai-email-transaction.extractor';

describe('AiEmailTransactionExtractor', () => {
  const chatComplete = jest.fn();
  const aiService = {
    complete: chatComplete,
  } as unknown as InferenceCompletionPort;
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
    notes: null as string | null,
    movementClass: 'OTHER' as const,
    categoryNameHint: null,
    bankStatusRaw: 'APPROVED',
    bankStatusNormalized: 'APPROVED',
    statusEvidence: 'APPROVED',
    statusConfidence: 0.95,
    bankReference: null,
    reverseOfEmailMessageId: null,
    reverseOriginalRef: null,
    instrumentHint: null,
    lastFourHint: null,
    accountNumberHint: null,
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

    const { kind, ...data } = validPayload;
    void kind;
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

  it('accepts a masked accountNumberHint and keeps digits', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify({
        ...validPayload,
        instrumentHint: 'ACCOUNT',
        accountNumberHint: '****5678',
      }),
      provider: 'groq',
      model: 'test-model',
    });

    await expect(extractor.extract(input)).resolves.toMatchObject({
      ok: true,
      kind: 'transaction',
      data: {
        instrumentHint: 'ACCOUNT',
        accountNumberHint: '5678',
      },
    });
  });

  it('instructs the model to extract payroll and deposit account numbers', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify(validPayload),
      provider: 'groq',
      model: 'test-model',
    });

    await extractor.extract(input);

    const system = chatComplete.mock.calls[0]?.[0]?.[0]?.content as string;
    expect(system).toMatch(/accountNumberHint/);
    expect(system).toMatch(/payroll|deposit|transfer/i);
  });

  it('includes available categories and category/description/notes rules in the prompt', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify({
        ...validPayload,
        categoryNameHint: 'Alimentación',
        description: 'Café',
        notes: 'Revisa categoría si no es alimentos.',
      }),
      provider: 'groq',
      model: 'test-model',
    });

    await extractor.extract({
      ...input,
      categories: [
        { name: 'Alimentación', type: 'EXPENSE' },
        { name: 'Salario', type: 'INCOME' },
      ],
    });

    const system = chatComplete.mock.calls[0]?.[0]?.[0]?.content as string;
    const user = chatComplete.mock.calls[0]?.[0]?.[1]?.content as string;
    expect(system).toMatch(/categoryNameHint/);
    expect(system).toMatch(/Compra en/);
    expect(system).toMatch(/\bnotes\b/);
    expect(user).toMatch(/Available categories/);
    expect(user).toMatch(/Alimentación/);
    expect(user).toMatch(/EXPENSE/);
  });

  it('normalizes the local RDS / RD$ currency to DOP', async () => {
    chatComplete.mockResolvedValue({
      content: JSON.stringify({ ...validPayload, currency: 'RDS' }),
      provider: 'groq',
      model: 'test-model',
    });

    await expect(extractor.extract(input)).resolves.toMatchObject({
      ok: true,
      kind: 'transaction',
      data: { currency: 'DOP' },
    });
  });

  it('defaults missing notes to null', async () => {
    const { notes: _notes, ...withoutNotes } = validPayload;
    void _notes;
    chatComplete.mockResolvedValue({
      content: JSON.stringify(withoutNotes),
      provider: 'groq',
      model: 'test-model',
    });

    await expect(extractor.extract(input)).resolves.toMatchObject({
      ok: true,
      kind: 'transaction',
      data: { notes: null },
    });
  });
});
