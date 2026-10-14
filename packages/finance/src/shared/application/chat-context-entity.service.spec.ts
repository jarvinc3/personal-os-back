import { ChatContextEntityService } from './chat-context-entity.service';

function prismaMock() {
  return {
    finTransaction: { findFirst: jest.fn() },
    finAccount: { findFirst: jest.fn() },
    finCard: { findFirst: jest.fn() },
    finCardStatement: { findFirst: jest.fn() },
    finLoan: { findFirst: jest.fn() },
    finLoanInstallment: { findFirst: jest.fn() },
    finReceivable: { findFirst: jest.fn() },
    finSavingsGoal: { findFirst: jest.fn() },
    finBudget: { findFirst: jest.fn() },
    finInstitution: { findFirst: jest.fn() },
    finEmailMessage: { findFirst: jest.fn() },
  };
}

describe('ChatContextEntityService', () => {
  const prisma = prismaMock();
  const service = new ChatContextEntityService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a short summary for a valid loan of the user', async () => {
    prisma.finLoan.findFirst.mockResolvedValue({
      id: 'loan-1',
      lenderName: 'BHD',
      currentBalance: { toString: () => '50000.00' },
      installmentAmount: { toString: () => '4200.00' },
      currency: 'DOP',
      paidInstallments: 5,
      totalInstallments: 24,
      nextDueDate: new Date('2026-11-01T00:00:00.000Z'),
    });

    const entity = await service.resolve('user-1', {
      type: 'loan',
      id: 'loan-1',
    });

    expect(prisma.finLoan.findFirst).toHaveBeenCalledWith({
      where: { id: 'loan-1', userId: 'user-1' },
    });
    expect(entity).toEqual({
      type: 'loan',
      id: 'loan-1',
      name: 'BHD',
      summary:
        'saldo 50000.00 DOP · cuota 4200.00 · 5/24 pagadas · próxima 2026-11-01',
    });
  });

  it('ignores an entity that belongs to another user', async () => {
    prisma.finLoan.findFirst.mockResolvedValue(null);

    const entity = await service.resolve('user-1', {
      type: 'loan',
      id: 'loan-of-user-2',
    });

    expect(prisma.finLoan.findFirst).toHaveBeenCalledWith({
      where: { id: 'loan-of-user-2', userId: 'user-1' },
    });
    expect(entity).toBeNull();
  });

  it('ignores an entity that does not exist', async () => {
    prisma.finTransaction.findFirst.mockResolvedValue(null);

    const entity = await service.resolve('user-1', {
      type: 'transaction',
      id: 'missing',
    });

    expect(entity).toBeNull();
  });

  it('scopes a card statement through the card owner', async () => {
    prisma.finCardStatement.findFirst.mockResolvedValue({
      id: 'statement-1',
      currency: 'DOP',
      closingBalance: { toString: () => '12000.00' },
      minimumPayment: { toString: () => '1200.00' },
      dueDate: new Date('2026-11-10T00:00:00.000Z'),
      status: 'CLOSED',
      cycleStart: new Date('2026-10-01T00:00:00.000Z'),
      cycleEnd: new Date('2026-10-31T00:00:00.000Z'),
      card: { name: 'Visa BHD' },
    });

    const entity = await service.resolve('user-1', {
      type: 'card_statement',
      id: 'statement-1',
    });

    expect(prisma.finCardStatement.findFirst).toHaveBeenCalledWith({
      where: { id: 'statement-1', card: { userId: 'user-1' } },
      include: { card: { select: { name: true } } },
    });
    expect(entity?.name).toBe('Corte Visa BHD');
    expect(entity?.summary).toContain('12000.00 DOP');
  });

  it('resolves a budget with its category name when it has no name', async () => {
    prisma.finBudget.findFirst.mockResolvedValue({
      id: 'budget-1',
      name: null,
      amountLimit: { toString: () => '15000.00' },
      amountSpent: { toString: () => '3000.00' },
      periodStart: new Date('2026-10-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-31T00:00:00.000Z'),
      categories: [{ category: { name: 'Comida' } }],
    });

    const entity = await service.resolve('user-1', {
      type: 'budget',
      id: 'budget-1',
    });

    expect(entity?.name).toBe('Comida');
    expect(entity?.summary).toBe(
      'límite 15000.00 · gastado 3000.00 · 2026-10-01–2026-10-31',
    );
  });
});
