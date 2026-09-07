import { PlanningService } from './planning.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';
import type { FinanceOwnershipService } from '../../shared/application/finance-ownership.service';

describe('PlanningService archive and receivables', () => {
  const updateLoan = jest.fn();
  const createLoan = jest.fn();
  const listLoans = jest.fn();
  const findLoan = jest.fn();
  const findReceivable = jest.fn();
  const updateReceivable = jest.fn();
  const createReceivable = jest.fn();
  const listBudgetsPage = jest.fn();

  const repo = {
    updateLoan,
    createLoan,
    listLoans,
    findLoan,
    findReceivable,
    updateReceivable,
    createReceivable,
    listBudgetsPage,
  } as unknown as PlanningRepository;

  const assertLoanAccountAlignment = jest.fn();
  const ownership = {
    assertInstitutionOwned: jest.fn(),
    assertLoanAccountAlignment,
    assertCategoryVisible: jest.fn(),
  } as unknown as FinanceOwnershipService;

  const service = new PlanningService(repo, ownership);

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
      service.updateLoan('user-1', 'loan-1', { isActive: false }),
    ).resolves.toMatchObject({ isActive: false });
    await expect(service.deactivateLoan('user-1', 'loan-1')).resolves.toEqual({
      success: true,
    });
    expect(updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      isActive: false,
    });
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
      service.updateLoan('user-1', 'loan-1', { accountId: 'acc-1' }),
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
      service.updateLoan('user-1', 'missing', { isActive: false }),
    ).rejects.toThrow(/not found/i);
  });

  it('marks a PENDING receivable as PAID and fills paidAmount', async () => {
    findReceivable.mockResolvedValue({
      id: 'rec-1',
      amount: 80,
      paidAmount: 0,
      status: 'PENDING',
    });
    updateReceivable.mockImplementation(
      (_userId: string, _id: string, data: unknown) =>
        Promise.resolve({
          id: 'rec-1',
          ...(data as object),
        }),
    );

    const result = await service.updateReceivable('user-1', 'rec-1', {
      status: 'PAID',
    });

    expect(result).toMatchObject({ status: 'PAID', paidAmount: '80' });
  });

  it('rejects paidAmount greater than amount', async () => {
    findReceivable.mockResolvedValue({
      id: 'rec-1',
      amount: 80,
      paidAmount: 0,
      status: 'PENDING',
    });

    await expect(
      service.updateReceivable('user-1', 'rec-1', { paidAmount: 90 }),
    ).rejects.toThrow(/cannot exceed amount/i);
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
      service.createLoan('user-1', {
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
      }),
    ).resolves.toMatchObject({
      originalAmount: '1000',
      currentBalance: '800',
      installmentAmount: '100',
      interestRate: '0.12',
      currency: 'USD',
    });
  });
});
