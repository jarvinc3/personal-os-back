import { parseExtractedPayload } from './parse-extracted-email';

describe('parseExtractedPayload', () => {
  it('accepts a payroll extract without amount', () => {
    const parsed = parseExtractedPayload({
      amount: null,
      currency: 'DOP',
      type: 'CREDIT',
      transactionDate: '2026-09-15',
      description: 'Depósito de nómina',
      merchant: null,
      movementClass: 'PAYROLL',
    });
    expect(parsed?.amount).toBeNull();
    expect(parsed?.movementClass).toBe('PAYROLL');
  });

  it('classifies a saved transfer description when movementClass is missing', () => {
    const parsed = parseExtractedPayload({
      amount: 500,
      currency: 'DOP',
      type: 'DEBIT',
      transactionDate: '2026-09-15',
      description: 'Enviaste una transferencia a Qik',
    });
    expect(parsed?.movementClass).toBe('TRANSFER_OUT');
  });

  it('keeps the bank reference from a saved payload', () => {
    const parsed = parseExtractedPayload({
      amount: 100,
      currency: 'DOP',
      type: 'DEBIT',
      transactionDate: '2026-09-15',
      description: 'Compra',
      bankReference: 'AUTH-123',
    });
    expect(parsed?.bankReference).toBe('AUTH-123');
  });
});
