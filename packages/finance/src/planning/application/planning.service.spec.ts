import { BadRequestException } from '@nestjs/common';
import { PlanningService } from './planning.service';
import type { SyncLoanInstallmentsUseCase } from './sync-loan-installments.use-case';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';

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
    assertLoanAccountAlignment,
    assertCategoryVisible: jest.fn(),
    assertExpenseCategory: jest.fn(),
  } as unknown as FinanceOwnershipService;

  const syncInstallments = {
    execute: jest.fn().mockResolvedValue(undefined),
  } as unknown as SyncLoanInstallmentsUseCase;

  const service = new PlanningService(repo, ownership, syncInstallments);

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
    );
    await expect(local.deleteLoan('user-1', 'missing')).rejects.toThrow(
      /not found/i,
    );
  });

  it('hard-deletes a receivable', async () => {
    const deleteReceivable = jest.fn().mockResolvedValue({ count: 1 });
    const local = new PlanningService(
      { ...repo, deleteReceivable } as unknown as PlanningRepository,
      ownership,
      syncInstallments,
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
    );
    await expect(local.deleteReceivable('user-1', 'missing')).rejects.toThrow(
      /not found/i,
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

  it('returns 404 when deactivating another user loan', async () => {
    findLoan.mockResolvedValue(null);
    updateLoan.mockResolvedValue(null);
    await expect(
      service.updateLoan('user-1', 'missing', { isActive: false }, now),
    ).rejects.toThrow(/not found/i);
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
    ).rejects.toThrow(/not found/i);
    expect(updateReceivable).not.toHaveBeenCalled();
  });

  it('paginates budgets with items and total', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({ id: `b-${i}` }));
    listBudgetsPage.mockResolvedValue([page, 25]);

    const result = await service.listBudgetsPage('user-1', {
      page: 1,
      limit: 20,
    });

    expect(result.items).toHaveLength(20);
    expect(result.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 25,
      totalPages: 2,
    });
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
      /Budget not found/,
    );
  });

  it('rejects budgets on income categories', async () => {
    (ownership.assertExpenseCategory as jest.Mock).mockRejectedValue(
      new BadRequestException('Budgets require an expense category'),
    );

    await expect(
      service.createBudget('user-1', {
        categoryId: 'cat-income',
        periodType: 'MONTHLY',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        amountLimit: 1000,
      }),
    ).rejects.toThrow(/expense category/i);
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
