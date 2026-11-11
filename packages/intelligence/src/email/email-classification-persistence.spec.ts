import {
  buildFinanceSignal,
  publishesFinanceSignal,
  type ClassificationProvenance,
} from './email-classification-persistence';
import { validateEmailClassification } from './email-classification.util';

const provenance: ClassificationProvenance = {
  method: 'MODEL',
  provider: 'test-provider',
  model: 'test-model',
  auditSample: false,
  matches: [],
};

const receivedAt = new Date('2026-11-10T12:00:00.000Z');

describe('Finance signal from email labels', () => {
  it('does not publish a movement for a payment reminder', () => {
    const reminder = validateEmailClassification({
      relevance: true,
      semanticType: 'FIN_ACCOUNT_NOTICE',
      routes: ['FINANCE'],
      confidence: 0.95,
    });
    expect(publishesFinanceSignal(reminder)).toBe(false);
    expect(
      buildFinanceSignal({
        userId: 'user-1',
        messageId: 'message-1',
        receivedAt,
        classification: reminder,
        provenance,
      }),
    ).toBeNull();
  });

  it('sends the card payment hints to Finance', () => {
    const payment = validateEmailClassification({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: {
        kind: 'TRANSACTION',
        amount: 5_200,
        currency: 'DOP',
        transactionDate: '2026-11-10T12:00:00.000Z',
        direction: 'DEBIT',
        movementClass: 'CARD_PAYMENT',
        last4: '4821',
        accountNumberLast4: '9012',
        bankStatusNormalized: 'POSTED',
        bankReference: 'BHD-7788',
      },
      confidence: 0.92,
    });
    const records = buildFinanceSignal({
      userId: 'user-1',
      messageId: 'message-1',
      receivedAt,
      classification: payment,
      provenance,
    });
    expect(records?.signal.payload).toMatchObject({
      transaction: {
        movementClass: 'CARD_PAYMENT',
        last4: '4821',
        accountNumberLast4: '9012',
        bankStatusNormalized: 'POSTED',
      },
    });
    expect(records?.evidence.excerpt).toMatchObject({
      transaction: {
        movementClass: 'CARD_PAYMENT',
        accountNumberLast4: '9012',
      },
    });
  });

  it('sends the suggested date and the original email reference to Finance', () => {
    const missingDate = validateEmailClassification({
      relevance: true,
      semanticType: 'FIN_TRANSACTION',
      routes: ['FINANCE'],
      transaction: {
        kind: 'TRANSACTION',
        amount: 1_500,
        currency: 'DOP',
        direction: 'CREDIT',
        movementClass: 'REFUND',
        bankStatusNormalized: 'REVERSED',
        reverseOfEmailMessageId: '18f0c2a9b7d34e56',
        suggestedTransactionDate: '2026-11-08T00:00:00.000Z',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
      },
      confidence: 0.9,
    });
    const records = buildFinanceSignal({
      userId: 'user-1',
      messageId: 'message-1',
      receivedAt,
      classification: missingDate,
      provenance,
    });
    expect(records?.signal.payload).toMatchObject({
      transaction: {
        suggestedTransactionDate: '2026-11-08T00:00:00.000Z',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
        reverseOfEmailMessageId: '18f0c2a9b7d34e56',
      },
    });
  });
});
