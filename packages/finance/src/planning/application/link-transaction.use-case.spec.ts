import { ConflictException, NotFoundException } from '@nestjs/common';
import type { LedgerRepositoryPort } from '../../ledger/application/ports/ledger.repository.port';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import type { AllocateToGoalUseCase } from './allocate-to-goal.use-case';
import { LinkTransactionUseCase } from './link-transaction.use-case';
import type { RecordReceivablePaymentUseCase } from './record-receivable-payment.use-case';
import { UnlinkTransactionUseCase } from './unlink-transaction.use-case';

const now = new Date(Date.UTC(2026, 2, 10));

function movement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    type: 'DEBIT',
    status: 'CONFIRMED',
    accountId: 'acc-1',
    cardId: null,
    transferGroupId: null,
    currency: 'DOP',
    ledgerCurrency: 'DOP',
    amount: 1500,
    ledgerAmount: 1500,
    transactionDate: now,
    ...overrides,
  };
}

function installment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-2',
    loanId: 'loan-1',
    installmentNo: 2,
    amount: 1500,
    principal: 1500,
    interest: 0,
    insurance: 0,
    fees: 0,
    lateFee: 0,
    paidAmount: 0,
    paidAt: null,
    transactionId: null,
    loan: {
      id: 'loan-1',
      lenderName: 'BHD',
      currency: 'DOP',
      currentBalance: 5000,
      installmentFreq: 'MONTHLY' as const,
      nextDueDate: new Date(Date.UTC(2026, 4, 5)),
      paidInstallments: 1,
    },
    ...overrides,
  };
}

function setup() {
  const ledger = {
    findTransactionById: jest.fn(),
    findPlanningLinkKind: jest.fn().mockResolvedValue(null),
  };
  const planning = {
    findInstallmentForUser: jest.fn(),
    findInstallmentByTransactionId: jest.fn(),
    findReceivable: jest.fn(),
    findReceivablePaymentByTransactionId: jest.fn(),
    deleteReceivablePayment: jest.fn().mockResolvedValue(undefined),
    findSavingsGoal: jest.fn(),
    findSavingsGoalContributionByTransactionId: jest.fn(),
    removeSavingsGoalContribution: jest.fn().mockResolvedValue(undefined),
    applyInstallmentPayment: jest.fn().mockResolvedValue(undefined),
    updateLoan: jest.fn().mockResolvedValue(undefined),
  };
  const ownership = { assertAccountOwned: jest.fn().mockResolvedValue(null) };
  const recordPayment = {
    execute: jest.fn().mockResolvedValue({ id: 'payment-1' }),
  };
  const allocateToGoal = {
    execute: jest.fn().mockResolvedValue({ id: 'contribution-1' }),
  };
  const link = new LinkTransactionUseCase(
    ledger as unknown as LedgerRepositoryPort,
    planning as unknown as PlanningRepository,
    ownership as unknown as FinanceOwnershipService,
    recordPayment as unknown as RecordReceivablePaymentUseCase,
    allocateToGoal as unknown as AllocateToGoalUseCase,
  );
  const unlink = new UnlinkTransactionUseCase(
    ledger as unknown as LedgerRepositoryPort,
    planning as unknown as PlanningRepository,
  );
  return {
    ledger,
    planning,
    ownership,
    recordPayment,
    allocateToGoal,
    link,
    unlink,
  };
}

describe('LinkTransactionUseCase', () => {
  it('marks the instalment paid with the existing movement', async () => {
    const { ledger, planning, recordPayment, link } = setup();
    ledger.findTransactionById.mockResolvedValue(movement());
    planning.findInstallmentForUser.mockResolvedValue(installment());

    const linkDescriptor = await link.execute(
      'user-1',
      'tx-1',
      { kind: 'LOAN_INSTALLMENT', loanId: 'loan-1', installmentId: 'inst-2' },
      now,
    );

    expect(recordPayment.execute).not.toHaveBeenCalled();
    expect(planning.applyInstallmentPayment).toHaveBeenCalledWith('inst-2', {
      paidAmount: 1500,
      status: 'PAID',
      paidAt: now,
      transactionId: 'tx-1',
    });
    expect(planning.updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      currentBalance: 3500,
      paidInstallments: 2,
      nextDueDate: new Date(Date.UTC(2026, 5, 5)),
    });
    expect(linkDescriptor).toMatchObject({ kind: 'LOAN_INSTALLMENT' });
  });

  it('rejects an amount above the instalment', async () => {
    const { ledger, planning, link } = setup();
    ledger.findTransactionById.mockResolvedValue(
      movement({ amount: 2000, ledgerAmount: 2000 }),
    );
    planning.findInstallmentForUser.mockResolvedValue(installment());

    await expect(
      link.execute(
        'user-1',
        'tx-1',
        { kind: 'LOAN_INSTALLMENT', loanId: 'loan-1', installmentId: 'inst-2' },
        now,
      ),
    ).rejects.toMatchObject({
      response: { code: 'TRANSACTION_LINK_AMOUNT_INVALID' },
    });
  });

  it('refuses a movement that is already linked', async () => {
    const { ledger, link } = setup();
    ledger.findTransactionById.mockResolvedValue(movement({ type: 'CREDIT' }));
    ledger.findPlanningLinkKind.mockResolvedValue('SAVINGS_CONTRIBUTION');

    await expect(
      link.execute(
        'user-1',
        'tx-1',
        { kind: 'RECEIVABLE_PAYMENT', receivableId: 'rec-1' },
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a collection with the existing movement', async () => {
    const { ledger, planning, recordPayment, link } = setup();
    ledger.findTransactionById.mockResolvedValue(movement({ type: 'CREDIT' }));
    planning.findReceivable.mockResolvedValue({
      id: 'rec-1',
      debtorName: 'Ana',
      amount: 5000,
      paidAmount: 1000,
      currency: 'DOP',
    });

    await link.execute(
      'user-1',
      'tx-1',
      { kind: 'RECEIVABLE_PAYMENT', receivableId: 'rec-1' },
      now,
    );

    expect(recordPayment.execute).toHaveBeenCalledWith(
      'user-1',
      'rec-1',
      {
        amount: 1500,
        accountId: 'acc-1',
        paidAt: now.toISOString(),
        transactionId: 'tx-1',
      },
      now,
    );
  });

  it('sets money aside when linking a goal', async () => {
    const { ledger, planning, allocateToGoal, link } = setup();
    ledger.findTransactionById.mockResolvedValue(movement({ type: 'CREDIT' }));
    planning.findSavingsGoal.mockResolvedValue({
      id: 'goal-1',
      name: 'Viaje',
      accountId: 'acc-1',
    });

    await link.execute(
      'user-1',
      'tx-1',
      { kind: 'SAVINGS_CONTRIBUTION', goalId: 'goal-1' },
      now,
    );

    expect(allocateToGoal.execute).toHaveBeenCalledWith(
      'user-1',
      'goal-1',
      {
        amount: 1500,
        kind: 'CONTRIBUTION',
        date: now.toISOString(),
        transactionId: 'tx-1',
      },
      now,
    );
  });
});

describe('UnlinkTransactionUseCase', () => {
  it('returns the instalment and the loan balance to their previous state', async () => {
    const { ledger, planning, unlink } = setup();
    ledger.findPlanningLinkKind.mockResolvedValue('LOAN_INSTALLMENT');
    planning.findInstallmentByTransactionId.mockResolvedValue(
      installment({
        paidAmount: 1500,
        paidAt: now,
        transactionId: 'tx-1',
        loan: {
          id: 'loan-1',
          lenderName: 'BHD',
          currency: 'DOP',
          currentBalance: 3500,
          installmentFreq: 'MONTHLY' as const,
          nextDueDate: new Date(Date.UTC(2026, 5, 5)),
          paidInstallments: 2,
        },
      }),
    );

    await unlink.execute('user-1', 'tx-1', now);

    expect(planning.applyInstallmentPayment).toHaveBeenCalledWith('inst-2', {
      paidAmount: 0,
      status: 'PENDING',
      paidAt: null,
      transactionId: null,
    });
    expect(planning.updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      currentBalance: 5000,
      paidInstallments: 1,
      nextDueDate: new Date(Date.UTC(2026, 4, 5)),
    });
  });

  it('fails when the movement has no link', async () => {
    const { ledger, unlink } = setup();
    ledger.findPlanningLinkKind.mockResolvedValue(null);

    await expect(unlink.execute('user-1', 'tx-1', now)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
