import {
  CARD_PAYMENT_MANUAL_DUPLICATE_WINDOW_MS,
  findManualCardPaymentDuplicate,
  type ManualCardPayment,
} from './find-manual-card-payment-duplicate';
import type { CardPaymentOperation } from './reconcile-card-payment-import';

const MINUTE_MS = 60 * 1000;

const manualPayment: ManualCardPayment = {
  accountId: 'account-1',
  cardId: 'card-1',
  amount: 2500,
  currency: 'DOP',
  transactionDate: new Date('2026-11-01T12:00:00.000Z'),
  bankReference: null,
};

function importedOperation(
  overrides: Partial<CardPaymentOperation> = {},
): CardPaymentOperation {
  return {
    transferGroupId: 'group-1',
    sourceTransactionId: 'transaction-1',
    accountId: 'account-1',
    cardId: 'card-1',
    externalReference: null,
    amount: 2500,
    currency: 'DOP',
    transactionDate: new Date('2026-11-01T12:00:00.000Z'),
    imported: true,
    description: 'Pago de tarjeta',
    ...overrides,
  };
}

describe('findManualCardPaymentDuplicate', () => {
  it('lets the payment through when there is no candidate', () => {
    expect(
      findManualCardPaymentDuplicate({
        incoming: manualPayment,
        existing: [],
      }),
    ).toEqual({ kind: 'none' });
  });

  it('asks for confirmation when an imported payment is inside ten minutes', () => {
    expect(
      findManualCardPaymentDuplicate({
        incoming: manualPayment,
        existing: [
          importedOperation({
            transactionDate: new Date(
              manualPayment.transactionDate.getTime() - 8 * MINUTE_MS,
            ),
          }),
        ],
      }),
    ).toEqual({
      kind: 'possible_duplicate',
      matchedBy: 'SIMILAR',
      candidate: {
        transactionId: 'transaction-1',
        transferGroupId: 'group-1',
        accountId: 'account-1',
        cardId: 'card-1',
        amount: 2500,
        currency: 'DOP',
        transactionDate: new Date('2026-11-01T11:52:00.000Z'),
        description: 'Pago de tarjeta',
      },
    });
  });

  it('lets the payment through just outside the window', () => {
    const decision = findManualCardPaymentDuplicate({
      incoming: manualPayment,
      existing: [
        importedOperation({
          transactionDate: new Date(
            manualPayment.transactionDate.getTime() -
              CARD_PAYMENT_MANUAL_DUPLICATE_WINDOW_MS -
              MINUTE_MS,
          ),
        }),
      ],
    });

    expect(decision).toEqual({ kind: 'none' });
  });

  it('asks for confirmation on the same reference even if the amount differs', () => {
    const decision = findManualCardPaymentDuplicate({
      incoming: { ...manualPayment, bankReference: 'PAY-9' },
      existing: [
        importedOperation({
          externalReference: 'PAY-9',
          amount: 900,
          transactionDate: new Date('2026-11-01T18:00:00.000Z'),
        }),
      ],
    });

    expect(decision).toMatchObject({
      kind: 'possible_duplicate',
      matchedBy: 'REFERENCE',
      candidate: { transactionId: 'transaction-1', amount: 900 },
    });
  });

  it('ignores another manual payment with the same data', () => {
    const decision = findManualCardPaymentDuplicate({
      incoming: manualPayment,
      existing: [importedOperation({ imported: false })],
    });

    expect(decision).toEqual({ kind: 'none' });
  });

  it('picks the closest candidate when several imported payments match', () => {
    const decision = findManualCardPaymentDuplicate({
      incoming: manualPayment,
      existing: [
        importedOperation({
          sourceTransactionId: 'transaction-far',
          transactionDate: new Date(
            manualPayment.transactionDate.getTime() - 9 * MINUTE_MS,
          ),
        }),
        importedOperation({
          sourceTransactionId: 'transaction-close',
          transactionDate: new Date(
            manualPayment.transactionDate.getTime() + MINUTE_MS,
          ),
        }),
      ],
    });

    expect(decision).toMatchObject({
      kind: 'possible_duplicate',
      matchedBy: 'SIMILAR',
      candidate: { transactionId: 'transaction-close' },
    });
  });
});
