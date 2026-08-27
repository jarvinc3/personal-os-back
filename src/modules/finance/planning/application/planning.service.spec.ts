import { PlanningService } from './planning.service';
import type { PlanningRepository } from '../infrastructure/planning.repository';

describe('PlanningService archive and receivables', () => {
  const updateLoan = jest.fn();
  const createLoan = jest.fn();
  const listLoans = jest.fn();
  const findReceivable = jest.fn();
  const updateReceivable = jest.fn();
  const createReceivable = jest.fn();

  const repo = {
    updateLoan,
    createLoan,
    listLoans,
    findReceivable,
    updateReceivable,
    createReceivable,
  } as unknown as PlanningRepository;

  const service = new PlanningService(repo);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deactivates a loan via PATCH isActive and DELETE', async () => {
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

  it('returns 404 when deactivating another user loan', async () => {
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

    expect(result).toMatchObject({ status: 'PAID', paidAmount: 80 });
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

  it('creates a loan with currency, interestRate fraction, and notes', async () => {
    createLoan.mockResolvedValue({
      id: 'loan-1',
      currency: 'USD',
      interestRate: 0.12,
      notes: 'BHD',
    });

    await service.createLoan('user-1', {
      lenderName: 'Bank',
      originalAmount: 1000,
      currentBalance: 800,
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      nextDueDate: '2026-09-01',
      currency: 'USD',
      interestRate: 0.12,
      notes: 'BHD',
    });

    expect(createLoan).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        currency: 'USD',
        interestRate: 0.12,
        notes: 'BHD',
      }),
    );
  });

  it('defaults currency to DOP when omitted', async () => {
    createLoan.mockResolvedValue({ id: 'loan-1', currency: 'DOP' });

    await service.createLoan('user-1', {
      lenderName: 'Bank',
      originalAmount: 1000,
      currentBalance: 800,
      installmentAmount: 100,
      installmentFreq: 'MONTHLY',
      totalInstallments: 12,
      nextDueDate: '2026-09-01',
    });

    expect(createLoan.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ currency: 'DOP' }),
    );
    expect(createLoan.mock.calls[0]?.[1]).not.toHaveProperty('interestRate');
  });

  it('patches notes or interestRate without wiping other fields', async () => {
    updateLoan.mockResolvedValue({ id: 'loan-1', notes: 'updated' });

    await service.updateLoan('user-1', 'loan-1', { notes: 'updated' });

    expect(updateLoan).toHaveBeenCalledWith('user-1', 'loan-1', {
      notes: 'updated',
    });
  });
});
