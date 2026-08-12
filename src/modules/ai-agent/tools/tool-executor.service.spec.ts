import { FinanceFacade } from '../../finance/finance.facade';
import { UsersService } from '../../users/application/users.service';
import { AiSessionsRepository } from '../chat/infrastructure/ai-sessions.repository';
import { ToolExecutorService } from './tool-executor.service';

describe('ToolExecutorService', () => {
  const findById = jest.fn();
  const updateProfile = jest.fn();
  const updateModuleConfig = jest.fn();
  const usersService = {
    findById,
    updateProfile,
    updateModuleConfig,
  } as unknown as UsersService;

  const createTransaction = jest.fn();
  const listTransactions = jest.fn();
  const getAnalyticsSummary = jest.fn();
  const getBudgetStatus = jest.fn();
  const createBudget = jest.fn();
  const updateBudget = jest.fn();
  const listSavingsGoals = jest.fn();
  const createSavingsGoal = jest.fn();
  const updateSavingsGoal = jest.fn();
  const listLoans = jest.fn();
  const updateLoan = jest.fn();
  const triggerEmailSync = jest.fn();
  const getSpendingByCategory = jest.fn();
  const getTransaction = jest.fn();
  const listCategories = jest.fn();
  const listEmailSources = jest.fn();
  const updateTransaction = jest.fn();
  const confirmTransaction = jest.fn();

  const financeFacade = {
    createTransaction,
    listTransactions,
    getAnalyticsSummary,
    getBudgetStatus,
    createBudget,
    updateBudget,
    listSavingsGoals,
    createSavingsGoal,
    updateSavingsGoal,
    listLoans,
    updateLoan,
    triggerEmailSync,
    getSpendingByCategory,
    getTransaction,
    listCategories,
    listEmailSources,
    updateTransaction,
    confirmTransaction,
  } as unknown as FinanceFacade;

  const findModuleBySlug = jest.fn();
  const updateSession = jest.fn();
  const sessionsRepo = {
    findModuleBySlug,
    updateSession,
  } as unknown as AiSessionsRepository;

  const executor = new ToolExecutorService(
    usersService,
    financeFacade,
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
    expect(createTransaction.mock.calls).toHaveLength(0);
  });

  it('passes validated create_transaction args to finance with source AI', async () => {
    createTransaction.mockResolvedValue({ id: 'tx-1' });
    const accountId = '550e8400-e29b-41d4-a716-446655440000';

    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 12.5,
      transactionDate: '2024-01-15',
      currency: 'DOP',
      accountId,
    });

    expect(result.success).toBe(true);
    expect(createTransaction.mock.calls).toEqual([
      [
        'user-1',
        {
          accountId,
          cardId: undefined,
          type: 'DEBIT',
          amount: 12.5,
          currency: 'DOP',
          transactionDate: '2024-01-15',
          description: undefined,
          merchant: undefined,
          categoryId: undefined,
        },
        'AI',
      ],
    ]);
  });

  it('rejects JSON parse-error sentinel without domain calls', async () => {
    const result = await executor.execute(ctx, 'set_theme', {
      __parseError: 'Tool arguments are not valid JSON',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('valid JSON');
    expect(updateProfile.mock.calls).toHaveLength(0);
  });

  it('maps domain service throws into tool failure results', async () => {
    createTransaction.mockRejectedValue(new Error('account missing'));

    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 10,
      transactionDate: '2024-01-15',
      accountId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Tool execution failed: account missing');
  });
});
