import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { assertHumanVerificationLabels } from '../human-verification.validation';
import { CreateHumanVerificationDto } from './create-human-verification.dto';

const baseVerification = {
  verdict: 'CORRECTED',
  relevance: true,
  semanticType: 'FIN_TRANSACTION',
  routes: ['FINANCE'],
};

async function validateVerification(body: Record<string, unknown>) {
  const request = plainToInstance(CreateHumanVerificationDto, body);
  await validateOrReject(request, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return request;
}

describe('Human verification transaction hints', () => {
  it('accepts the account, card payment, suggested date and reversal hints', async () => {
    const request = await validateVerification({
      ...baseVerification,
      transaction: {
        kind: 'TRANSACTION',
        amount: 5_200,
        currency: 'DOP',
        transactionDate: '2026-11-10T12:00:00.000Z',
        direction: 'DEBIT',
        movementClass: 'CARD_PAYMENT',
        last4: '4821',
        accountNumberLast4: '9012',
        bankReference: 'BHD-7788',
        reverseOfBankReference: 'BHD-7700',
        reverseOfEmailMessageId: '18f0c2a9b7d34e56',
        suggestedTransactionDate: '2026-11-10T00:00:00.000Z',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
      },
    });
    expect(request.transaction).toMatchObject({
      movementClass: 'CARD_PAYMENT',
      accountNumberLast4: '9012',
      reverseOfBankReference: 'BHD-7700',
      reverseOfEmailMessageId: '18f0c2a9b7d34e56',
    });
    expect(() => assertHumanVerificationLabels(request)).not.toThrow();
  });

  it.each([
    { accountNumberLast4: '123' },
    { accountNumberLast4: '12a4' },
    { movementClass: 'CARD_PAYMENT_V2' },
    { suggestedTransactionDateSource: 'EMAIL_BODY' },
    { reverseOfEmailMessageId: '' },
  ])('rejects the invalid transaction hint %#', async (transaction) => {
    await expect(
      validateVerification({
        ...baseVerification,
        transaction: { kind: 'TRANSACTION', ...transaction },
      }),
    ).rejects.toBeDefined();
  });

  it('requires the suggested date and its source together', async () => {
    const onlyDate = await validateVerification({
      ...baseVerification,
      transaction: {
        kind: 'TRANSACTION',
        suggestedTransactionDate: '2026-11-10T00:00:00.000Z',
      },
    });
    expect(() => assertHumanVerificationLabels(onlyDate)).toThrow();

    const onlySource = await validateVerification({
      ...baseVerification,
      transaction: {
        kind: 'TRANSACTION',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
      },
    });
    expect(() => assertHumanVerificationLabels(onlySource)).toThrow();

    const both = await validateVerification({
      ...baseVerification,
      transaction: {
        kind: 'TRANSACTION',
        suggestedTransactionDate: '2026-11-10T00:00:00.000Z',
        suggestedTransactionDateSource: 'EMAIL_HEADER',
      },
    });
    expect(() => assertHumanVerificationLabels(both)).not.toThrow();
  });
});
