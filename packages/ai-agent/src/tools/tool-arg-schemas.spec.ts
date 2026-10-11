import {
  MUTATING_TOOL_ARG_SCHEMAS,
  isMutatingToolName,
  mutatingToolParametersJsonSchema,
  validateMutatingToolArgs,
} from './tool-arg-schemas';

describe('tool-arg-schemas', () => {
  it('registers schemas for all mutating tools', () => {
    expect(Object.keys(MUTATING_TOOL_ARG_SCHEMAS)).toHaveLength(17);
  });

  it('generates OpenAI-compatible JSON Schema without $schema', () => {
    const parameters = mutatingToolParametersJsonSchema('set_theme');
    expect(parameters).toMatchObject({
      type: 'object',
      properties: {
        value: {
          type: 'string',
          enum: ['system', 'light', 'dark'],
        },
      },
      required: ['value'],
    });
    expect(parameters).not.toHaveProperty('$schema');
  });

  it('accepts valid set_theme args', () => {
    const result = validateMutatingToolArgs('set_theme', { value: 'dark' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ value: 'dark' });
    }
  });

  it('rejects invalid create_transaction types and amounts', () => {
    const accountId = '550e8400-e29b-41d4-a716-446655440000';
    const badType = validateMutatingToolArgs('create_transaction', {
      type: 'WITHDRAWAL',
      amount: 10,
      transactionDate: '2024-01-15',
      accountId,
    });
    expect(badType.ok).toBe(false);

    const nanAmount = validateMutatingToolArgs('create_transaction', {
      type: 'DEBIT',
      amount: Number.NaN,
      transactionDate: '2024-01-15',
      accountId,
    });
    expect(nanAmount.ok).toBe(false);

    const missingTarget = validateMutatingToolArgs('create_transaction', {
      type: 'DEBIT',
      amount: 42.5,
      transactionDate: '2024-01-15',
      currency: 'DOP',
    });
    expect(missingTarget.ok).toBe(false);

    const bothTargets = validateMutatingToolArgs('create_transaction', {
      type: 'DEBIT',
      amount: 42.5,
      transactionDate: '2024-01-15',
      accountId,
      cardId: '660e8400-e29b-41d4-a716-446655440000',
    });
    expect(bothTargets.ok).toBe(false);

    const valid = validateMutatingToolArgs('create_transaction', {
      type: 'DEBIT',
      amount: 42.5,
      transactionDate: '2024-01-15',
      currency: 'dop',
      accountId,
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.currency).toBe('DOP');
    }
  });

  it('requires fields for budget create and at least one for update', () => {
    const missingCreate = validateMutatingToolArgs('create_or_update_budget', {
      categoryId: 'food',
    });
    expect(missingCreate.ok).toBe(false);

    const updateEmpty = validateMutatingToolArgs('create_or_update_budget', {
      budgetId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(updateEmpty.ok).toBe(false);

    const updateOk = validateMutatingToolArgs('create_or_update_budget', {
      budgetId: '550e8400-e29b-41d4-a716-446655440000',
      amountLimit: 500,
    });
    expect(updateOk.ok).toBe(true);
  });

  it('rejects oversize preferences payloads', () => {
    const prefs: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) {
      prefs[`k${i}`] = 'x'.repeat(40);
    }
    const result = validateMutatingToolArgs('update_preferences', {
      preferences: prefs,
    });
    expect(result.ok).toBe(false);
  });

  it('isMutatingToolName narrows correctly', () => {
    expect(isMutatingToolName('create_transaction')).toBe(true);
    expect(isMutatingToolName('get_user_context')).toBe(false);
  });

  it('rejects unknown keys on mutating tools via strict objects', () => {
    const result = validateMutatingToolArgs('set_theme', {
      value: 'dark',
      extra: true,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects parse-error payloads for mutating tools', () => {
    const result = validateMutatingToolArgs('set_theme', {
      __parseError: 'Tool arguments are not valid JSON',
    });
    expect(result.ok).toBe(false);
  });
});
