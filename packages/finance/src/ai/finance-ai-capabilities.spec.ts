import { FinanceAiCapabilities } from './finance-ai-capabilities';

describe('FinanceAiCapabilities', () => {
  const ctx = {
    userId: 'user-1',
    invocationId: 'invocation-1',
    correlationId: 'conversation-1',
  };

  function setup(timezone = 'America/New_York', enabled = true) {
    const analytics = {
      getAnalyticsSummary: jest.fn().mockResolvedValue({
        baseCurrency: 'USD',
        cashFlow: '100.00',
        totals: { income: '500.00', expenses: '400.00' },
      }),
    };
    const prisma = {
      userModule: {
        findFirst: jest.fn().mockResolvedValue(enabled ? { id: 'um-1' } : null),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ timezone }) },
    };
    return {
      service: new FinanceAiCapabilities(analytics as never, prisma as never),
      analytics,
      prisma,
    };
  }

  it('exposes a read-only validated monthly spending capability', async () => {
    const { service, analytics, prisma } = setup();
    const [definition] = service.describe();

    expect(definition).toMatchObject({
      id: 'finance_monthly_summary',
      moduleSlug: 'finance',
      effect: 'READ',
    });
    await expect(service.isAvailable(ctx)).resolves.toBe(true);
    await expect(
      service.execute(ctx, definition.id, { month: '2026-03' }),
    ).resolves.toEqual({
      month: '2026-03',
      baseCurrency: 'USD',
      income: '500.00',
      expenses: '400.00',
      cashFlow: '100.00',
    });
    const [userId, from, to] = analytics.getAnalyticsSummary.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(from).toBe('2026-03-01T05:00:00.000Z');
    expect(to).toBe('2026-04-01T03:59:59.999Z');
    expect(prisma.userModule.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        isEnabled: true,
        module: { slug: 'finance' },
      },
      select: { id: true },
    });
  });

  it('rejects an invalid month and reports disabled Finance as unavailable', async () => {
    const { service, analytics } = setup('America/Santo_Domingo', false);
    const [definition] = service.describe();

    await expect(
      service.execute(ctx, definition.id, { month: 'not-a-month' }),
    ).rejects.toThrow();
    expect(analytics.getAnalyticsSummary).not.toHaveBeenCalled();
    await expect(service.isAvailable(ctx)).resolves.toBe(false);
    await expect(service.readContext(ctx)).resolves.toEqual({
      available: false,
    });
  });
});
