import { Test } from '@nestjs/testing';
import { FinanceFacade } from '../../finance';
import { UsersService } from '../../users';
import { AiSessionsRepository } from '../chat/infrastructure/ai-sessions.repository';
import { ToolExecutorService } from './tool-executor.service';

describe('ToolExecutorService finance via FinanceFacade (TestingModule)', () => {
  const getAnalyticsSummary = jest.fn();
  const createTxExecute = jest.fn();

  const usersService = {
    findById: jest.fn(),
    updateProfile: jest.fn(),
    updateModuleConfig: jest.fn(),
    assertModuleEnabled: jest.fn().mockResolvedValue(undefined),
  };

  const sessionsRepo = {
    findModuleBySlug: jest.fn(),
    updateSession: jest.fn(),
  };

  let executor: ToolExecutorService;

  const ctx = {
    userId: 'user-1',
    sessionId: 'session-1',
    moduleSlug: 'finance' as string | null,
    confirmBeforeActions: false,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    getAnalyticsSummary.mockResolvedValue({
      netWorth: '100',
      cashFlow: '0',
      baseCurrency: 'DOP',
      balanceStatus: 'COMPLETE',
      totals: { accountBalance: '100', cardDebt: '0', income: '0', expenses: '0' },
    });
    createTxExecute.mockResolvedValue({ id: 'tx-1' });

    const stub = {} as never;
    const moduleRef = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        {
          provide: FinanceFacade,
          useFactory: () =>
            new FinanceFacade(
              stub,
              { execute: createTxExecute } as never,
              stub,
              stub,
              stub,
              stub,
              stub,
              stub,
              { getAnalyticsSummary } as never,
              stub,
            ),
        },
        { provide: UsersService, useValue: usersService },
        { provide: AiSessionsRepository, useValue: sessionsRepo },
      ],
    }).compile();

    executor = moduleRef.get(ToolExecutorService);
  });

  it('routes get_finance_summary through FinanceFacade.getAnalyticsSummary', async () => {
    const result = await executor.execute(ctx, 'get_finance_summary', {
      dateFrom: '2026-01-01',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Finance summary loaded');
    expect(getAnalyticsSummary).toHaveBeenCalledWith(
      'user-1',
      '2026-01-01',
      undefined,
    );
    expect(result.data).toEqual({
      netWorth: '100',
      cashFlow: '0',
      baseCurrency: 'DOP',
      balanceStatus: 'COMPLETE',
      totals: { accountBalance: '100', cardDebt: '0', income: '0', expenses: '0' },
    });
  });

  it('forwards incomplete net worth from the analytics summary', async () => {
    getAnalyticsSummary.mockResolvedValue({
      netWorth: null,
      cashFlow: '20',
      baseCurrency: 'DOP',
      balanceStatus: 'INCOMPLETE',
      balanceIssues: [
        { code: 'MISSING_CREDIT_LIMIT', cardId: 'card-1', currency: 'DOP' },
      ],
      totals: {
        accountBalance: '100',
        cardDebt: null,
        income: '20',
        expenses: '0',
      },
    });

    const result = await executor.execute(ctx, 'get_finance_summary', {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      netWorth: null,
      cashFlow: '20',
      balanceStatus: 'INCOMPLETE',
    });
  });

  it('routes create_transaction through FinanceFacade with source AI', async () => {
    const accountId = '550e8400-e29b-41d4-a716-446655440000';

    const result = await executor.execute(ctx, 'create_transaction', {
      type: 'DEBIT',
      amount: 12.5,
      transactionDate: '2024-01-15',
      currency: 'DOP',
      accountId,
    });

    expect(result.success).toBe(true);
    expect(createTxExecute).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        accountId,
        type: 'DEBIT',
        amount: 12.5,
        currency: 'DOP',
        transactionDate: '2024-01-15',
      }),
      'AI',
    );
  });
});
