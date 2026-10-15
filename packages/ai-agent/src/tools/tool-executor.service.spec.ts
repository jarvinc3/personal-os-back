import { FinanceFacade } from '@personal-os/finance';
import { UsersService } from '@personal-os/users';
import { AiSessionsRepository } from '../chat/infrastructure/ai-sessions.repository';
import { ToolExecutorService } from './tool-executor.service';

describe('ToolExecutorService', () => {
  const findById = jest.fn();
  const updateProfile = jest.fn();
  const updateModuleConfig = jest.fn();
  const assertModuleEnabled = jest.fn();
  const usersService = {
    findById,
    updateProfile,
    updateModuleConfig,
    assertModuleEnabled,
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
  const unconfirmTransaction = jest.fn();
  const previewReconciliation = jest.fn();
  const createReconciliation = jest.fn();
  const getBankCharges = jest.fn();
  const getSubscriptionsSummary = jest.fn();
  const getSubscriptionAlerts = jest.fn();

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
    unconfirmTransaction,
    previewReconciliation,
    createReconciliation,
    getBankCharges,
    getSubscriptionsSummary,
    getSubscriptionAlerts,
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
    assertModuleEnabled.mockResolvedValue(undefined);
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

  it('blocks finance tools when the finance module is disabled', async () => {
    assertModuleEnabled.mockRejectedValue(
      new Error('El módulo finance está desactivado'),
    );

    const result = await executor.execute(ctx, 'get_finance_summary', {});

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      'Tool execution failed: El módulo finance está desactivado',
    );
    expect(getAnalyticsSummary).not.toHaveBeenCalled();
  });

  it('does not require finance enabled for profile tools', async () => {
    await executor.execute(ctx, 'set_theme', { value: 'dark' });
    expect(assertModuleEnabled).not.toHaveBeenCalled();
  });

  it('routes unconfirm_transaction through the finance facade', async () => {
    unconfirmTransaction.mockResolvedValue({ id: 'tx-1', status: 'PENDING' });
    const transactionId = '550e8400-e29b-41d4-a716-446655440000';

    const toolResult = await executor.execute(ctx, 'unconfirm_transaction', {
      transactionId,
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Transaction unlocked');
    expect(unconfirmTransaction).toHaveBeenCalledWith('user-1', transactionId);
  });

  it('previews reconcile_product without writing the close', async () => {
    previewReconciliation.mockResolvedValue({
      difference: '-50.00',
      suggestedAdjustments: [],
    });
    const accountId = '550e8400-e29b-41d4-a716-446655440000';

    const toolResult = await executor.execute(ctx, 'reconcile_product', {
      accountId,
      asOfDate: '2026-10-15',
      realBalance: 9950,
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Reconciliation preview');
    expect(previewReconciliation).toHaveBeenCalledWith('user-1', {
      accountId,
      cardId: undefined,
      currency: undefined,
      asOfDate: '2026-10-15',
      realBalance: 9950,
    });
    expect(createReconciliation).not.toHaveBeenCalled();
  });

  it('confirms reconcile_product with the suggested split when none is given', async () => {
    previewReconciliation.mockResolvedValue({
      difference: '-50.00',
      suggestedAdjustments: [
        { kind: 'IMPUESTO_DGII', amount: '-15.00' },
        { kind: 'OTRO', amount: '-35.00' },
      ],
    });
    createReconciliation.mockResolvedValue({ id: 'rec-1' });
    const accountId = '550e8400-e29b-41d4-a716-446655440000';

    const toolResult = await executor.execute(ctx, 'reconcile_product', {
      accountId,
      asOfDate: '2026-10-15',
      realBalance: 9950,
      apply: true,
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Product reconciled');
    expect(createReconciliation).toHaveBeenCalledWith('user-1', {
      accountId,
      cardId: undefined,
      currency: undefined,
      asOfDate: '2026-10-15',
      realBalance: 9950,
      adjustments: [
        { kind: 'IMPUESTO_DGII', amount: -15 },
        { kind: 'OTRO', amount: -35 },
      ],
      note: undefined,
    });
  });

  it('routes get_bank_charges with its date range and grouping', async () => {
    getBankCharges.mockResolvedValue({ total: '-50.00', count: 2 });

    const toolResult = await executor.execute(ctx, 'get_bank_charges', {
      from: '2026-10-01',
      to: '2026-10-31',
      groupBy: 'kind',
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Bank charges loaded');
    expect(getBankCharges).toHaveBeenCalledWith('user-1', {
      from: new Date('2026-10-01'),
      to: new Date('2026-10-31'),
      groupBy: 'kind',
    });
  });

  it('routes get_subscriptions_summary to the finance facade', async () => {
    getSubscriptionsSummary.mockResolvedValue({ monthlyCost: '100.00' });

    const toolResult = await executor.execute(
      ctx,
      'get_subscriptions_summary',
      {},
    );

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Subscriptions summary loaded');
    expect(getSubscriptionsSummary).toHaveBeenCalledWith('user-1');
  });

  it('routes get_subscription_alerts to the finance facade', async () => {
    getSubscriptionAlerts.mockResolvedValue([{ kind: 'MISSED_CHARGE' }]);

    const toolResult = await executor.execute(ctx, 'get_subscription_alerts', {
      userId: 'user-1',
    });

    expect(toolResult.success).toBe(true);
    expect(toolResult.message).toBe('Subscription alerts loaded');
    expect(getSubscriptionAlerts).toHaveBeenCalledWith('user-1');
  });
});
