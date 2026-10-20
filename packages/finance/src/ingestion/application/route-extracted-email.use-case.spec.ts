import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { ImportEmailTransactionUseCase } from '../../ledger/application/import-email-transaction.use-case';
import type { EmailSourceRepository } from '../infrastructure/email-source.repository';
import { RouteExtractedEmailUseCase } from './route-extracted-email.use-case';
import type { ExtractedEmailTransaction } from './ports/email-transaction-extractor.port';

const payrollWithoutAmount: ExtractedEmailTransaction = {
  amount: null,
  currency: 'DOP',
  type: 'CREDIT',
  transactionDate: '2026-10-13T12:00:00.000Z',
  merchant: null,
  description: 'Notificación Depósito de Nómina',
  notes: null,
  movementClass: 'PAYROLL',
  categoryNameHint: 'Salario',
  bankStatusRaw: null,
  bankStatusNormalized: 'COMPLETED',
  statusEvidence: 'Depósito de nómina sin monto',
  statusConfidence: 0.6,
  bankReference: null,
  reverseOfEmailMessageId: null,
  reverseOriginalRef: null,
  instrumentHint: 'ACCOUNT',
  lastFourHint: null,
  accountNumberHint: '3447',
};

const params = {
  userId: 'user-1',
  sourceId: 'src-1',
  gmailMessageId: 'gmail-1',
  extracted: payrollWithoutAmount,
  provider: 'groq',
  model: 'test',
  accounts: [
    { id: 'acc-1', accountNumberLast4: '3447', isDefaultForInstitution: false },
  ],
  cards: [],
  cashAccounts: [{ id: 'cash-1' }],
};

function setup() {
  const emailSources = {
    upsertEmailMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    listCategories: jest.fn().mockResolvedValue([]),
    findSuggestedPayrollAmount: jest.fn().mockResolvedValue(null),
    findFixedIncomeAmount: jest.fn().mockResolvedValue(null),
    findEmailSyncMode: jest.fn().mockResolvedValue('DIRECT'),
  };
  const importEmail = {
    execute: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    executeUnpairedTransfer: jest.fn().mockResolvedValue(null),
  };
  const ledger = {
    findDedupeCandidate: jest.fn().mockResolvedValue(null),
    findPossibleDuplicate: jest.fn().mockResolvedValue(null),
    findLatestCategoryIdByMerchant: jest.fn().mockResolvedValue(null),
  };
  const useCase = new RouteExtractedEmailUseCase(
    emailSources as unknown as EmailSourceRepository,
    importEmail as unknown as ImportEmailTransactionUseCase,
    ledger as unknown as LedgerQueryService,
  );
  return { emailSources, importEmail, ledger, useCase };
}

describe('RouteExtractedEmailUseCase payroll without amount', () => {
  it('imports a PENDING credit with the previous payroll as suggestion', async () => {
    const { emailSources, importEmail, useCase } = setup();
    emailSources.findSuggestedPayrollAmount.mockResolvedValue(22000);

    const routed = await useCase.execute(params);

    expect(emailSources.findSuggestedPayrollAmount).toHaveBeenCalledWith({
      userId: 'user-1',
      accountId: 'acc-1',
      currency: 'DOP',
    });
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        amount: 22000,
        status: 'PENDING',
        type: 'CREDIT',
        accountId: 'acc-1',
      }),
    );
    expect(routed).toMatchObject({ kind: 'imported', status: 'PENDING' });
  });

  it('keeps the email pending when no previous payroll exists', async () => {
    const { emailSources, importEmail, useCase } = setup();

    const routed = await useCase.execute(params);

    expect(importEmail.execute).not.toHaveBeenCalled();
    expect(emailSources.upsertEmailMessage).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'PENDING_AMOUNT' }),
    );
    expect(routed).toMatchObject({ kind: 'pending_amount' });
  });

  it('prefers the fixed income over the previous payroll', async () => {
    const { emailSources, importEmail, useCase } = setup();
    emailSources.findFixedIncomeAmount.mockResolvedValue(45000);
    emailSources.findSuggestedPayrollAmount.mockResolvedValue(22000);

    await useCase.execute(params);

    expect(emailSources.findSuggestedPayrollAmount).not.toHaveBeenCalled();
    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ amount: 45000, status: 'PENDING' }),
    );
  });

  it('leaves email movements pending when the module asks for review', async () => {
    const { emailSources, importEmail, useCase } = setup();
    emailSources.findEmailSyncMode.mockResolvedValue('PENDING');

    await useCase.execute({
      ...params,
      extracted: { ...payrollWithoutAmount, amount: 22000 },
    });

    expect(importEmail.execute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'PENDING' }),
    );
  });

  it('skips a notice whose confirmation number was already imported', async () => {
    const { ledger, useCase } = setup();
    ledger.findDedupeCandidate.mockResolvedValue({ id: 'tx-dup' });

    const routed = await useCase.execute({
      ...params,
      extracted: {
        ...payrollWithoutAmount,
        amount: 22000,
        bankReference: 'M04-4444-5555-6666-7',
      },
    });

    expect(routed).toMatchObject({
      kind: 'duplicate',
      transactionId: 'tx-dup',
    });
  });
});
