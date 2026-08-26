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
    getAnalyticsSummary.mockResolvedValue({ totalSpent: 100 });
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
    expect(result.data).toEqual({ totalSpent: 100 });
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
