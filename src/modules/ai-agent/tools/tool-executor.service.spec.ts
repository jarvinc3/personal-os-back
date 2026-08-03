import { FinanceService } from '../../finance/finance.service';
import { UsersService } from '../../users/users.service';
import { AiSessionsRepository } from '../ai-sessions.repository';
import { ToolExecutorService } from './tool-executor.service';

describe('ToolExecutorService', () => {
  const usersService = {
    findById: jest.fn(),
    updateProfile: jest.fn(),
    updateModuleConfig: jest.fn(),
  } as unknown as UsersService;

  const financeService = {
    createTransaction: jest.fn(),
    listTransactions: jest.fn(),
    getAnalyticsSummary: jest.fn(),
    getBudgetStatus: jest.fn(),
    createBudget: jest.fn(),
    updateBudget: jest.fn(),
    listSavingsGoals: jest.fn(),
    createSavingsGoal: jest.fn(),
    updateSavingsGoal: jest.fn(),
    listLoans: jest.fn(),
    updateLoan: jest.fn(),
    triggerEmailSync: jest.fn(),
    getSpendingByCategory: jest.fn(),
  } as unknown as FinanceService;

  const sessionsRepo = {
    findModuleBySlug: jest.fn(),
    updateSession: jest.fn(),
  } as unknown as AiSessionsRepository;

  const executor = new ToolExecutorService(
    usersService,
    financeService,
    sessionsRepo,
  );

  const ctx = {
    userId: 'user-1',
    sessionId: 'session-1',
    moduleSlug: 'finance' as string | null,
    confirmBeforeActions: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects invalid mutating args without calling finance services', async () => {
    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 'not-a-number',
      transactionDate: '2024-01-15',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Invalid arguments/);
    expect(financeService.createTransaction).not.toHaveBeenCalled();
  });

  it('passes validated create_transaction args to finance', async () => {
    (financeService.createTransaction as jest.Mock).mockResolvedValue({
      id: 'tx-1',
    });

    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 12.5,
      transactionDate: '2024-01-15',
      currency: 'DOP',
    });

    expect(result.success).toBe(true);
    expect(financeService.createTransaction).toHaveBeenCalledWith('user-1', {
      accountId: undefined,
      cardId: undefined,
      type: 'DEBIT',
      amount: 12.5,
      currency: 'DOP',
      transactionDate: '2024-01-15',
      description: undefined,
      merchant: undefined,
      categoryId: undefined,
    });
  });

  it('rejects JSON parse-error sentinel without domain calls', async () => {
    const result = await executor.execute(ctx, 'set_theme', {
      __parseError: 'Tool arguments are not valid JSON',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('valid JSON');
    expect(usersService.updateProfile).not.toHaveBeenCalled();
  });

  it('maps domain service throws into tool failure results', async () => {
    (financeService.createTransaction as jest.Mock).mockRejectedValue(
      new Error('account missing'),
    );

    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 10,
      transactionDate: '2024-01-15',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('account missing');
  });
});
