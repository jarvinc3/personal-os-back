import { resolveReceivablePayment } from './resolve-receivable-payment';

describe('resolveReceivablePayment', () => {
  it('derives PAID when paidAmount equals amount', () => {
    expect(
      resolveReceivablePayment({ amount: 100, paidAmount: 100 }),
    ).toEqual({ paidAmount: 100, status: 'PAID' });
  });

  it('derives PARTIAL when paidAmount is between 0 and amount', () => {
    expect(
      resolveReceivablePayment({ amount: 100, paidAmount: 40 }),
    ).toEqual({ paidAmount: 40, status: 'PARTIAL' });
  });

  it('allows CANCELLED without paidAmount matching amount', () => {
    expect(
      resolveReceivablePayment({
        amount: 100,
        paidAmount: 10,
        status: 'CANCELLED',
      }),
    ).toEqual({ paidAmount: 10, status: 'CANCELLED' });
  });

  it('rejects paidAmount greater than amount', () => {
    expect(() =>
      resolveReceivablePayment({ amount: 50, paidAmount: 51 }),
    ).toThrow(/cannot exceed amount/i);
  });

  it('rejects PAID when paidAmount does not match amount', () => {
    expect(() =>
      resolveReceivablePayment({
        amount: 50,
        paidAmount: 10,
        status: 'PAID',
      }),
    ).toThrow(/equal to amount/i);
  });
});
