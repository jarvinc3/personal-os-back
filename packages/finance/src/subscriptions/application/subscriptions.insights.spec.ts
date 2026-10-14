import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import { SubscriptionsService } from './subscriptions.service';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function subscriptionRow(
  overrides: Record<string, unknown> = {},
): SubscriptionRow {
  return {
    id: 'sub-1',
    userId: 'user-1',
    name: 'Netflix',
    normalizedKey: 'NETFLIX',
    domain: null,
    logoPath: null,
    customLogoPath: null,
    amount: 100,
    currency: 'DOP',
    billingCycle: 'MONTHLY',
    billingInterval: 1,
    anchorDate: day('2026-10-10'),
    nextBillingDate: day('2026-11-10'),
    trialEndsAt: null,
    status: 'ACTIVE',
    pausedAt: null,
    cancelledAt: null,
    reminderDaysBefore: 3,
    lastRemindedFor: null,
    cardId: null,
    accountId: null,
    categoryId: null,
    manageUrl: null,
    notes: null,
    sourcePatternId: null,
    createdAt: day('2026-10-10'),
    updatedAt: day('2026-10-10'),
    card: null,
    account: null,
    category: null,
    sourcePattern: null,
    ...overrides,
  } as unknown as SubscriptionRow;
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    subscriptionId: 'sub-1',
    transactionId: null,
    amount: 100,
    currency: 'DOP',
    paidAt: day('2026-10-10'),
    source: 'AUTO',
    createdAt: day('2026-10-10'),
    ...overrides,
  };
}

function build() {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findActive: jest.fn().mockResolvedValue([]),
    findByStatus: jest.fn().mockResolvedValue([]),
    listPaymentsForSubscriptions: jest.fn().mockResolvedValue([]),
    listPaymentsInRange: jest.fn().mockResolvedValue([]),
    listAlertDismissals: jest.fn().mockResolvedValue([]),
    dismissAlert: jest.fn().mockResolvedValue({}),
    countPendingDetected: jest.fn().mockResolvedValue(0),
  };
  const logos = { resolveUrl: jest.fn().mockReturnValue(null) };
  const ownership = {
    assertCategoryVisible: jest.fn(),
  };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('DOP') };
  const resolveAmounts = {
    toBaseCurrency: jest.fn((amount: number, currency: string) =>
      Promise.resolve(currency === 'USD' ? amount * 60 : amount),
    ),
  };
  const service = new SubscriptionsService(
    repo as never,
    {} as never,
    logos as never,
    ownership as never,
    baseCurrency as never,
    resolveAmounts as never,
    {} as never,
  );
  return { service, repo, resolveAmounts };
}

describe('SubscriptionsService.summary', () => {
  it('reports the month-over-month trend, real spend and cancelled savings', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({ id: 'sub-1', amount: 120, currency: 'DOP' }),
      subscriptionRow({
        id: 'sub-2',
        name: 'Spotify',
        amount: 10,
        currency: 'USD',
        nextBillingDate: day('2026-11-20'),
      }),
    ]);
    repo.listPaymentsForSubscriptions.mockResolvedValue([
      paymentRow({ subscriptionId: 'sub-1', amount: 120 }),
      paymentRow({ subscriptionId: 'sub-1', amount: 100 }),
    ]);
    repo.listPaymentsInRange.mockImplementation(
      (_userId: string, from: Date) =>
        from.getUTCMonth() === 10
          ? Promise.resolve([
              { amount: 120, currency: 'DOP', paidAt: day('2026-11-02') },
              { amount: 10, currency: 'USD', paidAt: day('2026-11-03') },
            ])
          : Promise.resolve([]),
    );
    repo.findByStatus.mockResolvedValue([
      subscriptionRow({
        id: 'sub-3',
        amount: 60,
        currency: 'DOP',
        billingCycle: 'YEARLY',
        status: 'CANCELLED',
      }),
    ]);
    repo.countPendingDetected.mockResolvedValue(2);

    const summary = await service.summary('user-1', day('2026-11-15'));

    expect(summary.monthlyCost).toBe('720.00');
    expect(summary.previousMonthlyCost).toBe('700.00');
    expect(summary.trend).toEqual({ direction: 'up', percent: 2.9 });
    expect(summary.realSpendThisMonth).toBe('720.00');
    expect(summary.realSpendPreviousMonth).toBe('0.00');
    expect(summary.pendingDetectedCount).toBe(2);
    expect(summary.cancelledAnnualSavings).toBe('60.00');
    expect(summary.activeCount).toBe(2);
  });
});

describe('SubscriptionsService.breakdown', () => {
  it('groups active cost by category, instrument and currency in base currency', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({
        id: 'sub-1',
        amount: 100,
        category: {
          id: 'cat-1',
          name: 'Entretenimiento',
          icon: null,
          color: '#f00',
        },
        categoryId: 'cat-1',
        card: {
          id: 'card-1',
          name: 'Visa BHD',
          lastFour: '1234',
          color: null,
          institution: null,
        },
        cardId: 'card-1',
      }),
      subscriptionRow({
        id: 'sub-2',
        name: 'Spotify',
        amount: 10,
        currency: 'USD',
        category: null,
      }),
    ]);

    const byCategory = await service.breakdown('user-1', 'category');
    expect(byCategory.items).toEqual([
      {
        key: 'uncategorized',
        label: 'Sin categoría',
        color: null,
        count: 1,
        amount: '600.00',
      },
      {
        key: 'cat-1',
        label: 'Entretenimiento',
        color: '#f00',
        count: 1,
        amount: '100.00',
      },
    ]);

    const byCurrency = await service.breakdown('user-1', 'currency');
    expect(byCurrency.items.map((item) => item.key)).toEqual(['USD', 'DOP']);

    const byInstrument = await service.breakdown('user-1', 'instrument');
    expect(byInstrument.items).toEqual([
      {
        key: 'no-instrument',
        label: 'Sin método',
        color: null,
        count: 1,
        amount: '600.00',
      },
      {
        key: 'CARD:card-1',
        label: 'Visa BHD',
        color: null,
        count: 1,
        amount: '100.00',
      },
    ]);
  });
});

describe('SubscriptionsService.upcoming', () => {
  it('lists every weekly occurrence inside the window with its instrument', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({
        id: 'sub-1',
        billingCycle: 'WEEKLY',
        anchorDate: day('2026-10-01'),
        nextBillingDate: day('2026-10-01'),
        account: {
          id: 'acc-1',
          name: 'Cuenta Popular',
          accountNumber: '00012345678',
          color: null,
          institutionRef: null,
        },
        accountId: 'acc-1',
      }),
    ]);

    const upcoming = await service.upcoming(
      'user-1',
      { from: '2026-10-01', to: '2026-10-31' },
      day('2026-10-01'),
    );

    expect(upcoming.items).toHaveLength(5);
    expect(upcoming.items.map((item) => item.date)).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
      '2026-10-22',
      '2026-10-29',
    ]);
    expect(upcoming.items[0]?.paymentMethod).toEqual({
      type: 'ACCOUNT',
      id: 'acc-1',
      name: 'Cuenta Popular',
      institution: null,
      last4: '5678',
      logoUrl: null,
    });
  });
});

describe('SubscriptionsService.alerts', () => {
  it('drops the alerts the user dismissed for that occurrence', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({
        id: 'sub-1',
        nextBillingDate: day('2026-10-20'),
      }),
    ]);
    repo.listAlertDismissals.mockResolvedValue([
      {
        subscriptionId: 'sub-1',
        kind: 'MISSED_CHARGE',
        alertDate: day('2026-10-20'),
      },
    ]);

    const alerts = await service.alerts('user-1', day('2026-10-28'));

    expect(alerts.map((alert) => alert.kind)).not.toContain('MISSED_CHARGE');
  });

  it('persists a dismissal keyed by kind, subscription and date', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow());

    const dismissedAlert = await service.dismissAlert('user-1', {
      kind: 'PRICE_INCREASE',
      subscriptionId: 'sub-1',
      alertDate: '2026-10-28',
    });

    expect(repo.dismissAlert).toHaveBeenCalledWith({
      userId: 'user-1',
      subscriptionId: 'sub-1',
      kind: 'PRICE_INCREASE',
      alertDate: day('2026-10-28'),
    });
    expect(dismissedAlert).toEqual({
      id: 'PRICE_INCREASE:sub-1:2026-10-28',
      dismissed: true,
    });
  });
});

describe('SubscriptionsService.list', () => {
  it('embeds the payment method and category on each row', async () => {
    const { service, repo } = build();
    repo.list.mockResolvedValue([
      subscriptionRow({
        id: 'sub-1',
        category: {
          id: 'cat-1',
          name: 'Entretenimiento',
          icon: 'tv',
          color: '#f00',
        },
        categoryId: 'cat-1',
        card: {
          id: 'card-1',
          name: 'Visa BHD',
          lastFour: '1234',
          color: null,
          institution: null,
        },
        cardId: 'card-1',
      }),
    ]);

    const page = await service.list('user-1', { limit: 20 }, day('2026-10-01'));

    expect(page.items[0]?.paymentMethod).toMatchObject({
      type: 'CARD',
      id: 'card-1',
      name: 'Visa BHD',
      last4: '1234',
    });
    expect(page.items[0]?.category).toEqual({
      id: 'cat-1',
      name: 'Entretenimiento',
      icon: 'tv',
      color: '#f00',
    });
  });
});
