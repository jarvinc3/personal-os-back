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

  it('labels a transfer and names its target instrument', async () => {
    prisma.finTransaction.findFirst.mockResolvedValue({
      id: 'tx-1',
      type: 'TRANSFER',
      amount: { toString: () => '1500.00' },
      currency: 'DOP',
      status: 'CONFIRMED',
      transactionDate: new Date('2026-10-05T00:00:00.000Z'),
      description: null,
      merchant: null,
      account: { name: 'Ahorros BHD' },
      card: null,
    });

    const entity = await service.resolve('user-1', {
      type: 'transfer',
      id: 'tx-1',
    });

    expect(entity).toEqual({
      type: 'transfer',
      id: 'tx-1',
      name: 'Transferencia',
      summary: 'TRANSFER 1500.00 DOP · CONFIRMED · 2026-10-05 · Ahorros BHD',
    });
  });

  it('falls back when a transaction has no instrument or description', async () => {
    prisma.finTransaction.findFirst.mockResolvedValue({
      id: 'tx-2',
      type: 'DEBIT',
      amount: { toString: () => '90.00' },
      currency: 'DOP',
      status: 'CONFIRMED',
      transactionDate: new Date('2026-10-06T00:00:00.000Z'),
      description: null,
      merchant: null,
      account: null,
      card: null,
    });

    const entity = await service.resolve('user-1', {
      type: 'transaction',
      id: 'tx-2',
    });

    expect(entity?.name).toBe('Movimiento');
    expect(entity?.summary).toContain('sin instrumento');
  });

  it('summarizes an account with its institution', async () => {
    prisma.finAccount.findFirst.mockResolvedValue({
      id: 'account-1',
      name: 'Ahorros BHD',
      type: 'SAVINGS',
      balance: { toString: () => '25000.00' },
      currency: 'DOP',
      isActive: true,
      institutionRef: { name: 'BHD' },
    });

    const entity = await service.resolve('user-1', {
      type: 'account',
      id: 'account-1',
    });

    expect(entity?.name).toBe('Ahorros BHD');
    expect(entity?.summary).toBe('SAVINGS · saldo 25000.00 DOP · BHD · activa');
  });

  it('names cash when an account has no institution', async () => {
    prisma.finAccount.findFirst.mockResolvedValue({
      id: 'account-2',
      name: 'Efectivo',
      type: 'CASH',
      balance: { toString: () => '0.00' },
      currency: 'DOP',
      isActive: false,
      institutionRef: null,
    });

    const entity = await service.resolve('user-1', {
      type: 'account',
      id: 'account-2',
    });

    expect(entity?.summary).toBe(
      'CASH · saldo 0.00 DOP · efectivo · archivada',
    );
  });

  it('summarizes a card with its balances', async () => {
    prisma.finCard.findFirst.mockResolvedValue({
      id: 'card-1',
      name: 'Visa BHD',
      type: 'CREDIT',
      isActive: true,
      institution: { name: 'BHD' },
      balances: [{ balance: { toString: () => '12000.00' }, currency: 'DOP' }],
    });

    const entity = await service.resolve('user-1', {
      type: 'card',
      id: 'card-1',
    });

    expect(entity?.name).toBe('Visa BHD');
    expect(entity?.summary).toBe('CREDIT · BHD · saldo 12000.00 DOP · activa');
  });

  it('names a loan installment after its loan', async () => {
    prisma.finLoanInstallment.findFirst.mockResolvedValue({
      id: 'installment-1',
      installmentNo: 3,
      amount: { toString: () => '4200.00' },
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      status: 'PENDING',
      loan: { lenderName: 'BHD', currency: 'DOP' },
    });

    const entity = await service.resolve('user-1', {
      type: 'loan_installment',
      id: 'installment-1',
    });

    expect(entity).toEqual({
      type: 'loan_installment',
      id: 'installment-1',
      name: 'Cuota 3 de BHD',
      summary: '4200.00 DOP · vence 2026-12-01 · PENDING',
    });
  });

  it('summarizes a receivable with its collected amount', async () => {
    prisma.finReceivable.findFirst.mockResolvedValue({
      id: 'receivable-1',
      debtorName: 'Juan Pérez',
      paidAmount: { toString: () => '500.00' },
      amount: { toString: () => '2000.00' },
      currency: 'DOP',
      status: 'PARTIAL',
      dueDate: new Date('2026-11-20T00:00:00.000Z'),
    });

    const entity = await service.resolve('user-1', {
      type: 'receivable',
      id: 'receivable-1',
    });

    expect(entity?.name).toBe('Juan Pérez');
    expect(entity?.summary).toBe(
      'cobrado 500.00 de 2000.00 DOP · PARTIAL · vence 2026-11-20',
    );
  });

  it('summarizes a savings goal with its progress', async () => {
    prisma.finSavingsGoal.findFirst.mockResolvedValue({
      id: 'goal-1',
      name: 'Viaje',
      currentAmount: { toString: () => '30000.00' },
      targetAmount: { toString: () => '100000.00' },
      currency: 'DOP',
      isCompleted: false,
    });

    const entity = await service.resolve('user-1', {
      type: 'savings_goal',
      id: 'goal-1',
    });

    expect(entity?.name).toBe('Viaje');
    expect(entity?.summary).toBe('30000.00 de 100000.00 DOP · en curso');
  });

  it('summarizes an institution with its country', async () => {
    prisma.finInstitution.findFirst.mockResolvedValue({
      id: 'institution-1',
      name: 'Banco BHD',
      type: 'BANK',
      country: 'DO',
      isActive: true,
    });

    const entity = await service.resolve('user-1', {
      type: 'institution',
      id: 'institution-1',
    });

    expect(entity?.name).toBe('Banco BHD');
    expect(entity?.summary).toBe('BANK · DO · activa');
  });

  it('names an email message after its source institution', async () => {
    prisma.finEmailMessage.findFirst.mockResolvedValue({
      id: 'email-1',
      outcome: 'IMPORTED',
      reason: null,
      source: { institution: { name: 'Banco BHD' } },
    });

    const entity = await service.resolve('user-1', {
      type: 'email_message',
      id: 'email-1',
    });

    expect(entity?.name).toBe('Banco BHD');
    expect(entity?.summary).toBe('correo de banco · IMPORTED');
  });

  it('reports a missing due date instead of a blank one', async () => {
    prisma.finLoan.findFirst.mockResolvedValue({
      id: 'loan-2',
      lenderName: 'Popular',
      currentBalance: { toString: () => '10000.00' },
      installmentAmount: { toString: () => '1000.00' },
      currency: 'DOP',
      paidInstallments: 1,
      totalInstallments: 10,
      nextDueDate: null,
    });

    const entity = await service.resolve('user-1', {
      type: 'loan',
      id: 'loan-2',
    });

    expect(entity?.summary).toContain('próxima sin fecha');
  });
});
