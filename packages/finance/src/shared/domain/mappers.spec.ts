import { FinanceEvents } from '../../contracts';
import { transactionCreatedEventName } from './mappers';

describe('transactionCreatedEventName', () => {
  it('maps the statuses that still own a Finance event', () => {
    expect(transactionCreatedEventName('CONFIRMED')).toBe(
      FinanceEvents.TRANSACTION_CONFIRMED,
    );
    expect(transactionCreatedEventName('DECLINED')).toBe(
      FinanceEvents.TRANSACTION_DECLINED,
    );
    expect(transactionCreatedEventName('CANCELLED')).toBe(
      FinanceEvents.TRANSACTION_CANCELLED,
    );
    expect(transactionCreatedEventName('REVERSED')).toBe(
      FinanceEvents.TRANSACTION_REVERSED,
    );
  });

  it('does not announce a pending import with a retired email event', () => {
    expect(transactionCreatedEventName('PENDING')).toBeNull();
    expect(FinanceEvents).not.toHaveProperty('TRANSACTION_IMPORTED');
  });
});
