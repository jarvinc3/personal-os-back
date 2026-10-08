import {
  budgetThresholdCopy,
  formatNotificationAmount,
  transactionPendingCopy,
  transactionRecordedCopy,
  transactionUpdatedCopy,
} from './notification-copy';

describe('notification-copy', () => {
  it('formats an amount with currency code, symbol and two decimals', () => {
    expect(formatNotificationAmount(1200, 'DOP')).toBe('DOP $1,200.00');
  });

  it('keeps a negative sign before the amount', () => {
    expect(formatNotificationAmount(-45.5, 'USD')).toBe('USD -$45.50');
  });

  it('falls back to the plain number without a currency', () => {
    expect(formatNotificationAmount(1200, '')).toBe('1,200.00');
  });

  it('builds a distinct title and body per transaction type', () => {
    const debit = transactionRecordedCopy({
      type: 'DEBIT',
      amountLabel: 'DOP $1,200.00',
      merchant: 'Supermercado Nacional',
      categoryName: 'Comida',
      accountName: 'Cuenta principal',
      cardName: null,
    });
    const credit = transactionRecordedCopy({
      type: 'CREDIT',
      amountLabel: 'DOP $2,000.00',
      merchant: null,
      categoryName: null,
      accountName: 'Cuenta principal',
      cardName: null,
    });

    expect(debit).toEqual({
      title: 'Gasto registrado',
      body: 'DOP $1,200.00 · Supermercado Nacional · Comida · Cuenta principal',
    });
    expect(credit.title).toBe('Ingreso registrado');
  });

  it('describes a pending imported movement', () => {
    expect(
      transactionPendingCopy({
        type: 'DEBIT',
        amountLabel: 'DOP $500.00',
        merchant: 'Farmacia',
        categoryName: null,
        accountName: null,
        cardName: null,
      }),
    ).toEqual({
      title: 'Movimiento por confirmar',
      body: 'Detectamos DOP $500.00 · Farmacia en un correo. Revísalo para confirmarlo.',
    });
  });

  it('describes an updated movement', () => {
    expect(
      transactionUpdatedCopy({
        type: 'DEBIT',
        amountLabel: 'DOP $500.00',
        merchant: null,
        categoryName: 'Salud',
        accountName: null,
        cardName: null,
      }),
    ).toEqual({
      title: 'Movimiento actualizado',
      body: 'Se actualizó DOP $500.00 · Salud.',
    });
  });

  it('rounds the budget percentage into the copy', () => {
    expect(budgetThresholdCopy(89.6)).toEqual({
      title: 'Presupuesto al 90%',
      body: 'Un presupuesto alcanzó el 90% de su límite.',
    });
  });
});
