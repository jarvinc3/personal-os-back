import {
  assertHumanVerificationLabels,
  humanVerificationPayload,
  type HumanVerificationLabelInput,
} from './human-verification.validation';

describe('assertHumanVerificationLabels', () => {
  it.each([
    [{ verdict: 'REJECTED' }, 'rechaza'],
    [{ verdict: 'CORRECTED' }, 'etiqueta corregida'],
    [{ verdict: 'CORRECTED', semanticType: 'OTHER' }, 'nota'],
    [
      { verdict: 'CORRECTED', semanticType: 'FIN_TRANSACTION' },
      'tipo de transacción',
    ],
    [
      {
        verdict: 'CORRECTED',
        semanticType: 'PURCHASE_RECEIPT',
        transaction: { kind: 'TRANSACTION' },
      },
      'kind',
    ],
    [
      { verdict: 'CORRECTED', semanticType: 'MARKETING', transaction: {} },
      'transacción',
    ],
    [
      {
        verdict: 'CORRECTED',
        semanticType: 'SECURITY_ALERT',
        relevance: false,
      },
      'Relevancia',
    ],
    [
      { verdict: 'CORRECTED', semanticType: 'SECURITY_OTP', relevance: true },
      'Relevancia',
    ],
  ] as const)('rejects inconsistent labels %#', (labels, error) => {
    const input = {
      fromAddress: 'alerts@bank.com',
      templateFingerprint: 'template-1',
      ...labels,
    } as HumanVerificationLabelInput;

    expect(() => assertHumanVerificationLabels(input)).toThrow(error);
  });

  it('accepts a confirmed batch with labels and a corrected financial transaction', () => {
    expect(() =>
      assertHumanVerificationLabels({
        verdict: 'CONFIRMED',
        relevance: true,
        semanticType: 'MARKETING',
      }),
    ).not.toThrow();
    expect(() =>
      assertHumanVerificationLabels({
        verdict: 'CORRECTED',
        semanticType: 'FIN_TRANSACTION',
        transaction: { kind: 'TRANSACTION' },
      }),
    ).not.toThrow();
  });
});

describe('humanVerificationPayload', () => {
  it('keeps only the labels and never the verdict, notes or group identity', () => {
    const input = {
      verdict: 'CORRECTED',
      relevance: true,
      semanticType: 'MARKETING',
      routes: [],
      notes: 'nota privada',
      fromAddress: 'alerts@bank.com',
      templateFingerprint: 'template-1',
    } as HumanVerificationLabelInput;

    expect(humanVerificationPayload(input)).toEqual({
      relevance: true,
      semanticType: 'MARKETING',
      routes: [],
    });
  });

  it('returns undefined when no label is present', () => {
    expect(humanVerificationPayload({ notes: 'solo nota' })).toBeUndefined();
  });
});
