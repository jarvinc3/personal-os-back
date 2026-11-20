import {
  extractMaskedAccountLast4,
  groundAccountLast4FromText,
} from './email-account-last4-grounding';
import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';

type Transaction = NonNullable<EmailClassification['transaction']>;

function transferClassification(
  transaction: Partial<Transaction> = {},
): EmailClassification {
  return validateEmailClassification({
    relevance: true,
    semanticType: 'FIN_TRANSACTION',
    routes: ['FINANCE'],
    transaction: {
      kind: 'TRANSACTION',
      amount: 1_000,
      currency: 'DOP',
      direction: 'DEBIT',
      movementClass: 'TRANSFER_OUT',
      ...transaction,
    },
    confidence: 0.9,
  });
}

function ground({
  body,
  transaction,
}: {
  body: string;
  transaction?: Partial<Transaction>;
}): EmailClassification {
  return groundAccountLast4FromText({
    classification: transferClassification(transaction),
    subject: 'Notificación de transferencia',
    body,
  });
}

describe('extractMaskedAccountLast4', () => {
  it('reads a unique account mask', () => {
    expect(
      extractMaskedAccountLast4(
        'Detalle de la transacción Cuenta: ******0024 Monto: RD$ 1,000.00',
      ),
    ).toBe('0024');
  });

  it('reads a mask with an underscore separator', () => {
    expect(extractMaskedAccountLast4('Cuenta o Producto: ******_0011')).toBe(
      '0011',
    );
  });

  it('reads a short mask and a mask at the start of the text', () => {
    expect(
      extractMaskedAccountLast4(
        'Has recibido RD$ 2,500.00 en tu Cuenta en pesos *2581.',
      ),
    ).toBe('2581');
    expect(extractMaskedAccountLast4('****1234')).toBe('1234');
  });

  it('rejects the beneficiary mask', () => {
    expect(
      extractMaskedAccountLast4(
        'Beneficiario: ANA. Cuenta o Producto: ******_0011',
      ),
    ).toBeNull();
    expect(
      extractMaskedAccountLast4('Ordenante: ANA. Cuenta: ******_0011'),
    ).toBeNull();
  });

  it('rejects card, identity, phone and reference masks', () => {
    expect(
      extractMaskedAccountLast4('Tarjeta Visa Débito Clásica. ****5089'),
    ).toBeNull();
    expect(
      extractMaskedAccountLast4('No. de identificación XXXXXXX3695'),
    ).toBeNull();
    expect(extractMaskedAccountLast4('Teléfono ****1234')).toBeNull();
    expect(extractMaskedAccountLast4('Referencia ****1234')).toBeNull();
    expect(extractMaskedAccountLast4('Confirmación ****1234')).toBeNull();
  });

  it('does not choose between two distinct accounts', () => {
    expect(
      extractMaskedAccountLast4('Cuenta: ****1111. Cuenta: ****2222.'),
    ).toBeNull();
  });

  it('accepts the same account repeated', () => {
    expect(extractMaskedAccountLast4('Cuenta: *2581. Cuenta Qik: *2581.')).toBe(
      '2581',
    );
  });

  it('ignores a mask followed by more digits', () => {
    expect(extractMaskedAccountLast4('Cuenta: ****12345')).toBeNull();
  });

  it('returns null when there is no mask', () => {
    expect(
      extractMaskedAccountLast4(
        'Su depósito fue aplicado de manera satisfactoria.',
      ),
    ).toBeNull();
  });
});

describe('groundAccountLast4FromText', () => {
  it('fills the missing account last4 from the text', () => {
    const grounded = ground({
      body: 'Detalle de la transacción Cuenta: ******0024 Monto: RD$ 1,000.00',
    });

    expect(grounded.transaction?.accountNumberLast4).toBe('0024');
  });

  it('replaces the model value with the text value', () => {
    const grounded = ground({
      body: 'Has recibido RD$ 2,500.00 en tu Cuenta en pesos *2581.',
      transaction: { accountNumberLast4: '9999' },
    });

    expect(grounded.transaction?.accountNumberLast4).toBe('2581');
  });

  it('keeps the model value when there is no account mask', () => {
    const grounded = ground({
      body: 'Su depósito fue aplicado de manera satisfactoria.',
      transaction: { accountNumberLast4: '9999' },
    });

    expect(grounded.transaction?.accountNumberLast4).toBe('9999');
  });

  it('keeps the model value when there are two distinct accounts', () => {
    const grounded = ground({
      body: 'Cuenta: ****1111. Cuenta: ****2222.',
      transaction: { accountNumberLast4: '9999' },
    });

    expect(grounded.transaction?.accountNumberLast4).toBe('9999');
  });

  it('keeps the model value when the only mask is the beneficiary', () => {
    const grounded = ground({
      body: 'Beneficiario: ANA. Cuenta o Producto: ******_0011',
      transaction: { accountNumberLast4: '9999' },
    });

    expect(grounded.transaction?.accountNumberLast4).toBe('9999');
  });

  it('does not touch the card last4', () => {
    const grounded = ground({
      body: 'Cuenta: ****0024',
      transaction: { accountNumberLast4: '9999', last4: '5089' },
    });

    expect(grounded.transaction).toMatchObject({
      accountNumberLast4: '0024',
      last4: '5089',
    });
  });

  it('returns the classification untouched when it has no transaction', () => {
    const original = validateEmailClassification({
      relevance: true,
      semanticType: 'MARKETING',
      routes: [],
      confidence: 0.9,
    });

    expect(
      groundAccountLast4FromText({
        classification: original,
        subject: 'Novedades',
        body: 'Cuenta: *2581',
      }),
    ).toBe(original);
  });
});
