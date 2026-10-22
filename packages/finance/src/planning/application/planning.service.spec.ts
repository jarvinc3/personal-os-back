import { BadRequestException } from '@nestjs/common';
import { PlanningService } from './planning.service';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';
import type { LedgerQueryService } from '../../ledger/application/ledger-query.service';
import type { AdjustBalanceUseCase } from '../../ledger/application/adjust-balance.use-case';
import type { DeleteTransactionUseCase } from '../../ledger/application/delete-transaction.use-case';

describe('PlanningService archive and receivables', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const updateLoan = jest.fn();
  const createLoan = jest.fn();
  const listLoans = jest.fn();
  const findLoan = jest.fn();
  const findReceivable = jest.fn();
  const updateReceivable = jest.fn();
  const createReceivable = jest.fn();
  const listBudgetsPage = jest.fn();
  const findBudget = jest.fn();

  const repo = {
    updateLoan,
    createLoan,
    listLoans,
    findLoan,
    findReceivable,
    updateReceivable,
    createReceivable,
    listBudgetsPage,
    findBudget,
  } as unknown as PlanningRepository;

  const assertLoanAccountAlignment = jest.fn();
  const ownership = {
    assertInstitutionOwned: jest.fn(),
    assertAccountOwned: jest.fn(),
    assertLoanAccountAlignment,
    assertCategoryVisible: jest.fn(),
    assertExpenseCategory: jest.fn(),
  } as unknown as FinanceOwnershipService;

  const syncInstallments = {
    execute: jest.fn().mockResolvedValue(undefined),
  } as unknown as SyncLoanInstallmentsUseCase;

  const ledger = {
    listTransactions: jest.fn(),
  } as unknown as LedgerQueryService;
  const adjustBalanceExecute = jest.fn();
  const adjustBalance = {
    execute: adjustBalanceExecute,
  } as unknown as AdjustBalanceUseCase;
  const deleteTransaction = {
    execute: jest.fn(),
  } as unknown as DeleteTransactionUseCase;

  const service = new PlanningService(
    repo,
    ownership,
    syncInstallments,
    ledger,
    adjustBalance,
    deleteTransaction,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deactivates a loan via PATCH isActive and DELETE', async () => {
    findLoan.mockResolvedValue({
      id: 'loan-1',
      institutionId: null,
      accountId: null,
    });
    updateLoan.mockResolvedValue({ id: 'loan-1', isActive: false });

    await expect(
      service.updateLoan('user-1', 'loan-1', { isActive: false }, now),
    ).resolves.toMatchObject({ isActive: false });
    await expect(service.deactivateLoan('user-1', 'loan-1')).resolves.toEqual({
      success: true,
    });
    expect(updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      isActive: false,
    });
  });

  it('hard-deletes a loan', async () => {
    const deleteLoan = jest.fn().mockResolvedValue({ count: 1 });
    const local = new PlanningService(
      { ...repo, deleteLoan } as unknown as PlanningRepository,
      ownership,
      syncInstallments,
      ledger,
      adjustBalance,
      deleteTransaction,
    );
    await expect(local.deleteLoan('user-1', 'loan-1')).resolves.toEqual({
      success: true,
    });
    expect(deleteLoan).toHaveBeenCalledWith('user-1', 'loan-1');
  });

  it('returns 404 when hard-deleting a missing loan', async () => {
    const deleteLoan = jest.fn().mockResolvedValue({ count: 0 });
    const local = new PlanningService(
      { ...repo, deleteLoan } as unknown as PlanningRepository,
      ownership,
      syncInstallments,
      ledger,
      adjustBalance,
      deleteTransaction,
    );
    await expect(local.deleteLoan('user-1', 'missing')).rejects.toThrow(
      /no encontrad/i,
    );
  });

  it('hard-deletes a receivable', async () => {
    const deleteReceivable = jest.fn().mockResolvedValue({ count: 1 });
    const local = new PlanningService(
      { ...repo, deleteReceivable } as unknown as PlanningRepository,
      ownership,
      syncInstallments,
      ledger,
      adjustBalance,
      deleteTransaction,
    );
    await expect(local.deleteReceivable('user-1', 'rec-1')).resolves.toEqual({
      success: true,
    });
    expect(deleteReceivable).toHaveBeenCalledWith('user-1', 'rec-1');
  });

  it('returns 404 when hard-deleting a missing receivable', async () => {
    const deleteReceivable = jest.fn().mockResolvedValue({ count: 0 });
    const local = new PlanningService(
      { ...repo, deleteReceivable } as unknown as PlanningRepository,
      ownership,
      syncInstallments,
      ledger,
      adjustBalance,
      deleteTransaction,
    );
    await expect(local.deleteReceivable('user-1', 'missing')).rejects.toThrow(
      /no encontrad/i,
    );
  });

  it('patches loan accountId as the payment account', async () => {
    findLoan.mockResolvedValue({
      id: 'loan-1',
      institutionId: 'inst-1',
      accountId: null,
    });
    updateLoan.mockResolvedValue({
      id: 'loan-1',
      accountId: 'acc-1',
      originalAmount: 1000,
      currentBalance: 800,
      installmentAmount: 100,
      interestRate: null,
    });

    await expect(
      service.updateLoan('user-1', 'loan-1', { accountId: 'acc-1' }, now),
    ).resolves.toMatchObject({ accountId: 'acc-1' });
    expect(assertLoanAccountAlignment).toHaveBeenCalledWith({
      userId: 'user-1',
      accountId: 'acc-1',
      institutionId: 'inst-1',
    });
    expect(updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      accountId: 'acc-1',
    });
  });

  it('rejects a balance above the stored original amount on update', async () => {
    findLoan.mockResolvedValue({
      id: 'loan-1',
      institutionId: null,
      accountId: null,
      originalAmount: 1000,
      currentBalance: 800,
      totalInstallments: 10,
      paidInstallments: 2,
    });

    await expect(
      service.updateLoan('user-1', 'loan-1', { currentBalance: 5000 }, now),
    ).rejects.toThrow(BadRequestException);
    expect(updateLoan).not.toHaveBeenCalled();
  });

  it('rejects paid instalments above the total on update', async () => {
    findLoan.mockResolvedValue({
      id: 'loan-1',
      institutionId: null,
      accountId: null,
      originalAmount: 1000,
      currentBalance: 800,
      totalInstallments: 10,
      paidInstallments: 2,
    });

    await expect(
      service.updateLoan('user-1', 'loan-1', { paidInstallments: 12 }, now),
    ).rejects.toThrow(BadRequestException);
    expect(updateLoan).not.toHaveBeenCalled();
  });

  it('returns 404 when deactivating another user loan', async () => {
    findLoan.mockResolvedValue(null);
    updateLoan.mockResolvedValue(null);
    await expect(
      service.updateLoan('user-1', 'missing', { isActive: false }, now),
    ).rejects.toThrow(/no encontrad/i);
  });

  it('hands the requested status to the repository and returns the saved row', async () => {
    findReceivable.mockResolvedValue({
      id: 'rec-1',
      amount: 80,
      paidAmount: 80,
      status: 'PAID',
    });

    const saved = await service.updateReceivable('user-1', 'rec-1', {
      status: 'PAID',
    });

    expect(updateReceivable).toHaveBeenCalledWith(
      'user-1',
      'rec-1',
      {},
      'PAID',
    );
    expect(saved).toMatchObject({ status: 'PAID', paidAmount: '80' });
  });

  it('returns 404 when updating a receivable that is not there', async () => {
    findReceivable.mockResolvedValue(null);

    await expect(
      service.updateReceivable('user-1', 'missing', { debtorName: 'Ana' }),
    ).rejects.toThrow(/no encontrad/i);
    expect(updateReceivable).not.toHaveBeenCalled();
  });

  it('paginates budgets with a cursor', async () => {
    const page = Array.from({ length: 21 }, (_, i) => ({
      id: `b-${i}`,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
    }));
    listBudgetsPage.mockResolvedValue(page);

    const budgetsPage = await service.listBudgetsPage('user-1', { limit: 20 });

    expect(budgetsPage.items).toHaveLength(20);
    expect(budgetsPage.hasMore).toBe(true);
    expect(budgetsPage.nextCursor).toEqual(expect.any(String));
  });

  it('returns a mapped budget by id', async () => {
    findBudget.mockResolvedValue({
      id: 'budget-1',
      amountLimit: 1000,
      amountSpent: 10,
      alertThresholdPct: 80,
      category: { id: 'cat-1', name: 'Food' },
    });

    await expect(
      service.getBudget('user-1', 'budget-1'),
    ).resolves.toMatchObject({
      id: 'budget-1',
      amountLimit: '1000',
      amountSpent: '10',
      alertThresholdPct: 80,
    });
  });

  it('throws when the budget is missing', async () => {
    findBudget.mockResolvedValue(null);
    await expect(service.getBudget('user-1', 'missing')).rejects.toThrow(
      /Presupuesto no encontrado/,
    );
  });

  it('rejects budgets on income categories', async () => {
    (ownership.assertExpenseCategory as jest.Mock).mockRejectedValue(
      new BadRequestException(
        'Los presupuestos requieren una categoría de gasto',
      ),
    );

    await expect(
      service.createBudget('user-1', {
        categoryIds: ['cat-income'],
        periodType: 'MONTHLY',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        amountLimit: 1000,
      }),
    ).rejects.toThrow(/categoría de gasto/i);
  });

  it('rejects creating a loan on the cash institution', async () => {
    const local = new PlanningService(
      repo,
      {
        ...ownership,
        assertInstitutionAcceptsBankProducts: jest
          .fn()
          .mockRejectedValue(
            new BadRequestException(
              'Efectivo no admite tarjetas, préstamos ni sincronización por correo',
            ),
          ),
      } as unknown as FinanceOwnershipService,
      syncInstallments,
      ledger,
      adjustBalance,
      deleteTransaction,
    );

    await expect(
      local.createLoan(
        'user-1',
        {
          lenderName: 'Efectivo',
          institutionId: 'cash-inst',
          originalAmount: 1000,
          currentBalance: 1000,
          installmentAmount: 100,
          installmentFreq: 'MONTHLY',
          totalInstallments: 12,
          nextDueDate: '2026-09-01',
        },
        now,
      ),
    ).rejects.toThrow(/Efectivo no admite/i);
    expect(createLoan).not.toHaveBeenCalled();
  });

  it('credits the disbursement account and links the movement', async () => {
    (ownership.assertAccountOwned as jest.Mock).mockResolvedValue({
      id: 'acc-1',
      balance: 500,
      currency: 'DOP',
      isActive: true,
    });
    adjustBalanceExecute.mockResolvedValue({
      adjusted: true,
      transaction: { id: 'tx-1' },
    });
    createLoan.mockResolvedValue({
      id: 'loan-1',
      name: 'Carro',
      originalAmount: 1000,
      currentBalance: 1000,
      installmentAmount: 100,
      interestRate: null,
      currency: 'DOP',
    });

    await service.createLoan(
      'user-1',
      {
        name: 'Carro',
        lenderName: 'BHD',
        disbursementAccountId: 'acc-1',
        originalAmount: 1000,
        currentBalance: 1000,
        installmentAmount: 100,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
      },
      now,
    );

    expect(adjustBalanceExecute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId: 'acc-1',
        balance: 1500,
        description: expect.stringContaining('Carro'),
      }),
    );
    expect(createLoan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: 'Carro',
        disbursementAccountId: 'acc-1',
        disbursementTransactionId: 'tx-1',
      }),
    );
  });

  it('creates a loan without a movement when no account received the money', async () => {
    createLoan.mockResolvedValue({
      id: 'loan-1',
      originalAmount: 1000,
      currentBalance: 1000,
      installmentAmount: 100,
      interestRate: null,
      currency: 'DOP',
    });

    await service.createLoan(
      'user-1',
      {
        lenderName: 'BHD',
        originalAmount: 1000,
        currentBalance: 1000,
        installmentAmount: 100,
        installmentFreq: 'MONTHLY',
        totalInstallments: 12,
        nextDueDate: '2026-09-01',
      },
      now,
    );

    expect(adjustBalanceExecute).not.toHaveBeenCalled();
    expect(createLoan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        name: null,
        disbursementAccountId: undefined,
      }),
    );
  });

  it('rejects a disbursement account in another currency', async () => {
    (ownership.assertAccountOwned as jest.Mock).mockResolvedValue({
      id: 'acc-1',
      balance: 500,
      currency: 'USD',
      isActive: true,
    });

    await expect(
      service.createLoan(
        'user-1',
        {
          lenderName: 'BHD',
          disbursementAccountId: 'acc-1',
          originalAmount: 1000,
          currentBalance: 1000,
          installmentAmount: 100,
          installmentFreq: 'MONTHLY',
          totalInstallments: 12,
          nextDueDate: '2026-09-01',
        },
        now,
      ),
    ).rejects.toThrow(/moneda del préstamo/i);
    expect(adjustBalanceExecute).not.toHaveBeenCalled();
  });

  it('updates the loan alias without touching the disbursement', async () => {
    findLoan.mockResolvedValue({
      id: 'loan-1',
      institutionId: null,
      accountId: null,
      originalAmount: 1000,
      currentBalance: 800,
      currency: 'DOP',
    });
    updateLoan.mockResolvedValue({
      id: 'loan-1',
      name: 'Carro',
      originalAmount: 1000,
      currentBalance: 800,
      installmentAmount: 100,
      interestRate: null,
      currency: 'DOP',
    });

    await service.updateLoan('user-1', 'loan-1', { name: '  Carro  ' }, now);

    expect(updateLoan).toHaveBeenCalledWith(
      'user-1',
      'loan-1',
      expect.objectContaining({ name: 'Carro' }),
    );
  });

  it('serializes created loan money and rate as strings', async () => {
    createLoan.mockResolvedValue({
      originalAmount: 1000,
      currentBalance: 800,
      installmentAmount: 100,
      interestRate: 0.12,
      currency: 'USD',
      notes: 'BHD',
    });

    await expect(
      service.createLoan(
        'user-1',
        {
          lenderName: 'BHD',
          originalAmount: 1000,
          currentBalance: 800,
          installmentAmount: 100,
          installmentFreq: 'MONTHLY',
          totalInstallments: 12,
          nextDueDate: '2026-09-01',
          currency: 'USD',
          interestRate: 0.12,
          notes: 'BHD',
        },
        now,
      ),
    ).resolves.toMatchObject({
      originalAmount: '1000',
      currentBalance: '800',
      installmentAmount: '100',
      interestRate: '0.12',
      currency: 'USD',
    });
  });
});

describe('PlanningService savings goal updates', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const updateSavingsGoal = jest.fn();
  const findSavingsGoal = jest.fn().mockResolvedValue({
    id: 'goal-1',
    targetAmount: '5000',
    currentAmount: '0',
  });

  const service = new PlanningService(
    { updateSavingsGoal, findSavingsGoal } as unknown as PlanningRepository,
    {} as unknown as FinanceOwnershipService,
    {} as unknown as SyncLoanInstallmentsUseCase,
    {} as unknown as LedgerQueryService,
    {} as unknown as AdjustBalanceUseCase,
    {} as unknown as DeleteTransactionUseCase,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears the target date when null arrives', async () => {
    await service.updateSavingsGoal(
      'user-1',
      'goal-1',
      { targetDate: null },
      now,
    );

    expect(updateSavingsGoal).toHaveBeenCalledWith(
      'user-1',
      'goal-1',
      { targetDate: null },
      now,
    );
  });

  it('leaves the target date untouched when the field is not sent', async () => {
    await service.updateSavingsGoal('user-1', 'goal-1', { name: 'Fondo' }, now);

    expect(updateSavingsGoal).toHaveBeenCalledWith(
      'user-1',
      'goal-1',
      { name: 'Fondo' },
      now,
    );
  });
});
