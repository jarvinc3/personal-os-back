import { FinanceFacade } from '@personal-os/finance';
import { UsersService } from '@personal-os/users';
import { AiSessionsRepository } from '../chat/infrastructure/ai-sessions.repository';
import { MODULE_CONTEXT } from '../prompts/module-context';
import { ToolExecutorService } from './tool-executor.service';

const USER_ID = 'user-1';
const SESSION_ID = 'session-1';
const FACADE_RESULT = { marker: 'facade-result' };

type LoadCase = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  facadeMethod: string;
  expectedArgs: unknown[];
  message: string;
  expectedData: unknown;
};

const loadCases: LoadCase[] = [
  {
    id: 'loads the finance summary with its date filters',
    tool: 'get_finance_summary',
    args: { dateFrom: '2026-01-01', dateTo: '2026-02-01' },
    facadeMethod: 'getAnalyticsSummary',
    expectedArgs: [USER_ID, '2026-01-01', '2026-02-01'],
    message: 'Finance summary loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'drops non-string date filters from the finance summary',
    tool: 'get_finance_summary',
    args: { dateFrom: 20260101 },
    facadeMethod: 'getAnalyticsSummary',
    expectedArgs: [USER_ID, undefined, undefined],
    message: 'Finance summary loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'lists transactions with the default limit',
    tool: 'list_transactions',
    args: { type: 'DEBIT' },
    facadeMethod: 'listTransactions',
    expectedArgs: [USER_ID, { limit: 50, type: 'DEBIT' }],
    message: 'Transactions loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'lists accounts under an items envelope',
    tool: 'list_accounts',
    args: {},
    facadeMethod: 'listAccounts',
    expectedArgs: [USER_ID],
    message: 'Accounts loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists cards under an items envelope',
    tool: 'list_cards',
    args: {},
    facadeMethod: 'listCards',
    expectedArgs: [USER_ID],
    message: 'Cards loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists budgets under an items envelope',
    tool: 'list_budgets',
    args: {},
    facadeMethod: 'listBudgets',
    expectedArgs: [USER_ID],
    message: 'Budgets loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists email sources under an items envelope',
    tool: 'list_email_sources',
    args: {},
    facadeMethod: 'listEmailSources',
    expectedArgs: [USER_ID],
    message: 'Email sources loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists categories filtered by type',
    tool: 'list_categories',
    args: { type: 'INCOME' },
    facadeMethod: 'listCategories',
    expectedArgs: [USER_ID, 'INCOME'],
    message: 'Categories loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'drops an unknown category type',
    tool: 'list_categories',
    args: { type: 'OTHER' },
    facadeMethod: 'listCategories',
    expectedArgs: [USER_ID, undefined],
    message: 'Categories loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'loads the budget status',
    tool: 'get_budget_status',
    args: {},
    facadeMethod: 'getBudgetStatus',
    expectedArgs: [USER_ID],
    message: 'Budget status loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists savings goals',
    tool: 'list_savings_goals',
    args: {},
    facadeMethod: 'listSavingsGoals',
    expectedArgs: [USER_ID],
    message: 'Savings goals loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists loans',
    tool: 'list_loans',
    args: {},
    facadeMethod: 'listLoans',
    expectedArgs: [USER_ID],
    message: 'Loans loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'lists possible duplicates',
    tool: 'list_possible_duplicates',
    args: {},
    facadeMethod: 'listPossibleDuplicates',
    expectedArgs: [USER_ID],
    message: 'Possible duplicates loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'lists pending emails',
    tool: 'list_pending_emails',
    args: {},
    facadeMethod: 'listPendingEmails',
    expectedArgs: [USER_ID],
    message: 'Pending emails loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'loads the subscriptions summary',
    tool: 'get_subscriptions_summary',
    args: {},
    facadeMethod: 'getSubscriptionsSummary',
    expectedArgs: [USER_ID],
    message: 'Subscriptions summary loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'loads subscription alerts',
    tool: 'get_subscription_alerts',
    args: {},
    facadeMethod: 'getSubscriptionAlerts',
    expectedArgs: [USER_ID],
    message: 'Subscription alerts loaded',
    expectedData: { alerts: FACADE_RESULT },
  },
  {
    id: 'lists merchants',
    tool: 'list_merchants',
    args: {},
    facadeMethod: 'listMerchants',
    expectedArgs: [USER_ID],
    message: 'Merchants loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'breaks spending down by category',
    tool: 'get_spending_by_category',
    args: { dateFrom: '2026-01-01' },
    facadeMethod: 'getSpendingByCategory',
    expectedArgs: [USER_ID, '2026-01-01', undefined],
    message: 'Spending breakdown loaded',
    expectedData: { items: FACADE_RESULT },
  },
  {
    id: 'groups spending over time by month',
    tool: 'get_spending_over_time',
    args: { dateFrom: '2026-01-01', dateTo: '2026-02-01', groupBy: 'month' },
    facadeMethod: 'getSpendingOverTime',
    expectedArgs: [USER_ID, '2026-01-01', '2026-02-01', 'month'],
    message: 'Spending over time loaded',
    expectedData: FACADE_RESULT,
  },
  {
    id: 'defaults spending over time to daily grouping',
    tool: 'get_spending_over_time',
    args: { groupBy: 'quarter' },
    facadeMethod: 'getSpendingOverTime',
    expectedArgs: [USER_ID, undefined, undefined, 'day'],
    message: 'Spending over time loaded',
    expectedData: FACADE_RESULT,
  },
];

function createHarness() {
  const usersService = {
    findById: jest.fn(),
    updateProfile: jest.fn(),
    updateModuleConfig: jest.fn(),
    assertModuleEnabled: jest.fn().mockResolvedValue(undefined),
  };
  const sessionsRepo = {
    findModuleBySlug: jest.fn(),
    updateSession: jest.fn().mockResolvedValue(undefined),
  };
  const facadeMocks = new Map<string, jest.Mock>();
  const financeFacade = new Proxy(
    {},
    {
      get: (_target, property: string) => {
        const existing = facadeMocks.get(property);
        if (existing) {
          return existing;
        }
        const mock = jest.fn();
        facadeMocks.set(property, mock);
        return mock;
      },
    },
  ) as unknown as FinanceFacade;

  return {
    executor: new ToolExecutorService(
      usersService as unknown as UsersService,
      financeFacade,
      sessionsRepo as unknown as AiSessionsRepository,
    ),
    usersService,
    sessionsRepo,
    facade: (method: string): jest.Mock => {
      const existing = facadeMocks.get(method);
      if (existing) {
        return existing;
      }
      const mock = jest.fn();
      facadeMocks.set(method, mock);
      return mock;
    },
  };
}

const ctx = {
  userId: USER_ID,
  sessionId: SESSION_ID,
  moduleSlug: 'finance',
  confirmBeforeActions: false,
};

describe('ToolExecutorService dispatch', () => {
  it.each(loadCases)('$id', async (testCase) => {
    const harness = createHarness();
    harness.facade(testCase.facadeMethod).mockResolvedValue(FACADE_RESULT);

    const agentResult = await harness.executor.execute(
      ctx,
      testCase.tool,
      testCase.args,
    );

    expect(agentResult.success).toBe(true);
    expect(agentResult.message).toBe(testCase.message);
    expect(agentResult.data).toEqual(testCase.expectedData);
    expect(harness.facade(testCase.facadeMethod)).toHaveBeenCalledWith(
      ...testCase.expectedArgs,
    );
    expect(harness.usersService.assertModuleEnabled).toHaveBeenCalledWith(
      USER_ID,
      'finance',
    );
  });

  it('does not check the finance module for non-finance tools', async () => {
    const harness = createHarness();
    harness.usersService.findById.mockResolvedValue({
      id: USER_ID,
      email: 'a@b.c',
      fullName: 'Ana',
      avatarUrl: null,
      locale: 'es',
      timezone: 'UTC',
      preferences: {},
      userModules: [],
    });

    await harness.executor.execute(ctx, 'get_user_context', {});

    expect(harness.usersService.assertModuleEnabled).not.toHaveBeenCalled();
  });

  it('rejects a get_transaction call without an id', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(
      ctx,
      'get_transaction',
      {},
    );

    expect(agentResult).toEqual({
      success: false,
      message: 'transactionId is required',
    });
    expect(harness.facade('getTransaction')).not.toHaveBeenCalled();
  });

  it('loads a transaction by id', async () => {
    const harness = createHarness();
    harness.facade('getTransaction').mockResolvedValue({ id: 'tx-1' });

    const agentResult = await harness.executor.execute(ctx, 'get_transaction', {
      transactionId: 'tx-1',
    });

    expect(agentResult).toMatchObject({
      success: true,
      message: 'Transaction loaded',
      data: { id: 'tx-1' },
    });
  });

  it('answers an unknown tool without calling finance', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(ctx, 'ghost_tool', {});

    expect(agentResult).toEqual({
      success: false,
      message: 'Unknown tool: ghost_tool',
    });
  });

  it('surfaces the parse error from the model arguments', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(ctx, 'list_accounts', {
      __parseError: 'arguments are not JSON',
    });

    expect(agentResult).toEqual({
      success: false,
      message: 'arguments are not JSON',
    });
  });

  it('uses a fallback message for a non-string parse error', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(ctx, 'list_accounts', {
      __parseError: true,
    });

    expect(agentResult).toEqual({
      success: false,
      message: 'Tool arguments are not valid JSON',
    });
  });

  it('wraps an unexpected dispatch failure', async () => {
    const harness = createHarness();
    harness.facade('listAccounts').mockRejectedValue(new Error('boom'));

    const agentResult = await harness.executor.execute(
      ctx,
      'list_accounts',
      {},
    );

    expect(agentResult).toEqual({
      success: false,
      message: 'Tool execution failed: boom',
    });
  });

  it('loads the user context with profile data', async () => {
    const harness = createHarness();
    harness.usersService.findById.mockResolvedValue({
      id: USER_ID,
      email: 'ana@example.com',
      fullName: 'Ana',
      avatarUrl: 'https://cdn.test/ana.png',
      locale: 'es',
      timezone: 'America/Santo_Domingo',
      preferences: { ai: {} },
      userModules: [{ slug: 'finance' }],
    });

    const agentResult = await harness.executor.execute(
      ctx,
      'get_user_context',
      {},
    );

    expect(agentResult).toMatchObject({
      success: true,
      message: 'User context loaded',
      data: {
        profile: {
          id: USER_ID,
          email: 'ana@example.com',
          fullName: 'Ana',
          locale: 'es',
          timezone: 'America/Santo_Domingo',
        },
      },
    });
  });

  it('merges the new theme with the stored preferences', async () => {
    const harness = createHarness();
    harness.usersService.findById.mockResolvedValue({
      preferences: { theme: { density: 'compact' } },
    });
    harness.usersService.updateProfile.mockResolvedValue({});

    const agentResult = await harness.executor.execute(ctx, 'set_theme', {
      value: 'dark',
    });

    expect(harness.usersService.updateProfile).toHaveBeenCalledWith(USER_ID, {
      preferences: { theme: { density: 'compact', value: 'dark' } },
    });
    expect(agentResult).toMatchObject({
      success: true,
      message: 'Theme set to dark',
      sideEffects: [
        { type: 'invalidate', keys: ['profile', 'me'] },
        { type: 'theme', value: 'dark' },
      ],
    });
  });

  it('updates the profile with a blank avatar removed', async () => {
    const harness = createHarness();
    harness.usersService.updateProfile.mockResolvedValue({
      id: USER_ID,
      email: 'ana@example.com',
      fullName: 'Ana',
      avatarUrl: null,
      locale: 'es',
      timezone: 'UTC',
    });

    const agentResult = await harness.executor.execute(
      ctx,
      'update_user_profile',
      {
        fullName: 'Ana',
        avatarUrl: '   ',
      },
    );

    expect(harness.usersService.updateProfile).toHaveBeenCalledWith(USER_ID, {
      fullName: 'Ana',
      avatarUrl: null,
    });
    expect(agentResult).toMatchObject({
      success: true,
      message: 'User profile updated',
    });
  });

  it('keeps only the fields sent in the profile patch', async () => {
    const harness = createHarness();
    harness.usersService.updateProfile.mockResolvedValue({
      id: USER_ID,
      email: 'ana@example.com',
      fullName: null,
      avatarUrl: null,
      locale: 'en',
      timezone: 'UTC',
    });

    await harness.executor.execute(ctx, 'update_user_profile', {
      locale: 'en',
    });

    expect(harness.usersService.updateProfile).toHaveBeenCalledWith(USER_ID, {
      locale: 'en',
    });
  });

  it('replaces the preferences block', async () => {
    const harness = createHarness();
    harness.usersService.updateProfile.mockResolvedValue({});

    const agentResult = await harness.executor.execute(
      ctx,
      'update_preferences',
      {
        preferences: { theme: { value: 'light' } },
      },
    );

    expect(harness.usersService.updateProfile).toHaveBeenCalledWith(USER_ID, {
      preferences: { theme: { value: 'light' } },
    });
    expect(agentResult.message).toBe('Preferences updated');
  });

  it('applies the AI settings over the stored ones', async () => {
    const harness = createHarness();
    harness.usersService.findById.mockResolvedValue({
      preferences: { ai: { tone: 'concise' } },
    });
    harness.usersService.updateProfile.mockResolvedValue({});

    const agentResult = await harness.executor.execute(
      ctx,
      'update_ai_settings',
      {
        tone: 'detailed',
        proactiveInsights: false,
        confirmBeforeActions: true,
      },
    );

    const patch = harness.usersService.updateProfile.mock.calls[0][1];
    expect(patch.preferences.ai).toMatchObject({
      tone: 'detailed',
      proactiveInsights: false,
      confirmBeforeActions: true,
    });
    expect(agentResult.message).toBe('AI settings updated');
  });

  it('patches notification channels and quiet hours', async () => {
    const harness = createHarness();
    harness.usersService.updateProfile.mockResolvedValue({});

    await harness.executor.execute(ctx, 'update_notification_settings', {
      channels: { push: false },
      quietHours: { enabled: true, start: '22:00', end: '07:00' },
    });

    expect(harness.usersService.updateProfile).toHaveBeenCalledWith(USER_ID, {
      preferences: {
        notifications: {
          channels: { push: false },
          quietHours: { enabled: true, start: '22:00', end: '07:00' },
        },
      },
    });
  });

  it('updates a module config with both invalidation keys', async () => {
    const harness = createHarness();
    harness.usersService.updateModuleConfig.mockResolvedValue({});

    const agentResult = await harness.executor.execute(
      ctx,
      'update_module_config',
      {
        slug: 'projects',
        config: { defaultView: 'board' },
      },
    );

    expect(harness.usersService.updateModuleConfig).toHaveBeenCalledWith(
      USER_ID,
      'projects',
      { config: { defaultView: 'board' } },
    );
    expect(agentResult).toMatchObject({
      success: true,
      message: 'Module projects config updated',
      sideEffects: [
        { type: 'invalidate', keys: ['profile', 'me'] },
        { type: 'invalidate', keys: ['user-module', 'projects'] },
      ],
    });
  });

  it('toggles a module off', async () => {
    const harness = createHarness();
    harness.usersService.updateModuleConfig.mockResolvedValue({});

    const agentResult = await harness.executor.execute(ctx, 'toggle_module', {
      slug: 'health',
      isEnabled: false,
    });

    expect(harness.usersService.updateModuleConfig).toHaveBeenCalledWith(
      USER_ID,
      'health',
      { isEnabled: false },
    );
    expect(agentResult.message).toBe('Module health disabled');
  });

  it('rejects an unknown module context slug', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(
      ctx,
      'switch_module_context',
      {
        slug: 'ghost',
      },
    );

    expect(agentResult.success).toBe(false);
    expect(agentResult.message).toContain('Invalid slug');
    expect(harness.sessionsRepo.updateSession).not.toHaveBeenCalled();
  });

  it('switches the context to general without a module lookup', async () => {
    const harness = createHarness();

    const agentResult = await harness.executor.execute(
      ctx,
      'switch_module_context',
      {
        slug: 'general',
      },
    );

    expect(harness.sessionsRepo.findModuleBySlug).not.toHaveBeenCalled();
    expect(harness.sessionsRepo.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      {
        contextType: 'general',
        moduleId: null,
      },
    );
    expect(agentResult).toMatchObject({
      success: true,
      data: { moduleSlug: 'general' },
    });
  });

  it('rejects a module context that does not exist', async () => {
    const harness = createHarness();
    harness.sessionsRepo.findModuleBySlug.mockResolvedValue(null);

    const agentResult = await harness.executor.execute(
      ctx,
      'switch_module_context',
      {
        slug: 'finance',
      },
    );

    expect(agentResult).toEqual({
      success: false,
      message: 'Module "finance" not found',
    });
  });

  it('switches the context to an enabled module', async () => {
    const harness = createHarness();
    harness.sessionsRepo.findModuleBySlug.mockResolvedValue({ id: 'mod-1' });

    const agentResult = await harness.executor.execute(
      ctx,
      'switch_module_context',
      {
        slug: 'finance',
      },
    );

    expect(harness.sessionsRepo.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      {
        contextType: 'finance',
        moduleId: 'mod-1',
      },
    );
    expect(agentResult).toMatchObject({
      success: true,
      data: { moduleSlug: 'finance' },
    });
    expect(agentResult.sideEffects).toEqual([
      {
        type: 'moduleContext',
        slug: 'finance',
        label: MODULE_CONTEXT.finance.label,
      },
    ]);
  });

  it('filters recurring subscriptions by status', async () => {
    const harness = createHarness();
    harness.facade('listSubscriptions').mockResolvedValue({
      subscriptions: [{ id: 'sub-1' }],
      recurring: [
        { id: 'rec-1', status: 'CONFIRMED' },
        { id: 'rec-2', status: 'DISMISSED' },
      ],
    });

    const agentResult = await harness.executor.execute(
      ctx,
      'list_subscriptions',
      {
        status: 'CONFIRMED',
      },
    );

    expect(agentResult.data).toEqual({
      subscriptions: [{ id: 'sub-1' }],
      recurring: [{ id: 'rec-1', status: 'CONFIRMED' }],
    });
  });

  it('keeps every recurring subscription without a status filter', async () => {
    const harness = createHarness();
    harness.facade('listSubscriptions').mockResolvedValue({
      subscriptions: [],
      recurring: [
        { id: 'rec-1', status: 'CONFIRMED' },
        { id: 'rec-2', status: 'SUGGESTED' },
      ],
    });

    const agentResult = await harness.executor.execute(
      ctx,
      'list_subscriptions',
      {
        status: 'unknown',
      },
    );

    expect(agentResult.data).toEqual({
      subscriptions: [],
      recurring: [
        { id: 'rec-1', status: 'CONFIRMED' },
        { id: 'rec-2', status: 'SUGGESTED' },
      ],
    });
  });

  it('loads bank charges with the given range and grouping', async () => {
    const harness = createHarness();
    harness.facade('getBankCharges').mockResolvedValue({ items: [] });

    await harness.executor.execute(ctx, 'get_bank_charges', {
      from: '2026-01-01',
      to: '2026-02-01',
      groupBy: 'month',
    });

    expect(harness.facade('getBankCharges')).toHaveBeenCalledWith(USER_ID, {
      from: new Date('2026-01-01'),
      to: new Date('2026-02-01'),
      groupBy: 'month',
    });
  });

  it('merges side effects without duplicates', () => {
    const harness = createHarness();

    const merged = harness.executor.mergeSideEffects([
      {
        success: true,
        message: 'first',
        sideEffects: [
          { type: 'invalidate', keys: ['profile'] },
          { type: 'theme', value: 'dark' },
        ],
      },
      {
        success: true,
        message: 'second',
        sideEffects: [{ type: 'invalidate', keys: ['profile'] }],
      },
      { success: false, message: 'no effects' },
    ]);

    expect(merged).toEqual([
      { type: 'invalidate', keys: ['profile'] },
      { type: 'theme', value: 'dark' },
    ]);
  });
});
