import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@personal-os/core';
import type { SubscriptionRow } from '../infrastructure/subscriptions.repository';
import { isValidSubscriptionCursorKey } from '../domain/subscription-list';
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
    payments: [],
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

function build(options: { reminderDaysBefore?: number } = {}) {
  const repo = {
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    findActive: jest.fn().mockResolvedValue([]),
    findByStatus: jest.fn().mockResolvedValue([]),
    listPaymentsForSubscriptions: jest.fn().mockResolvedValue([]),
    listPaymentsInRange: jest.fn().mockResolvedValue([]),
    listAlertDismissals: jest.fn().mockResolvedValue([]),
    dismissAlert: jest.fn().mockResolvedValue({}),
    dismissAlerts: jest.fn().mockResolvedValue({ count: 1 }),
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
  const usersRepository = {
    findUserModuleBySlug: jest.fn().mockResolvedValue(
      options.reminderDaysBefore === undefined
        ? null
        : {
            config: {
              subscriptions: { reminderDaysBefore: options.reminderDaysBefore },
            },
          },
    ),
  };
  const service = new SubscriptionsService(
    repo as never,
    {} as never,
    logos as never,
    ownership as never,
    baseCurrency as never,
    resolveAmounts as never,
    usersRepository as never,
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

  it('lists upcoming charges inside the global warning window', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({ id: 'sub-1', nextBillingDate: day('2026-11-10') }),
      subscriptionRow({ id: 'sub-2', nextBillingDate: day('2026-11-13') }),
      subscriptionRow({ id: 'sub-3', nextBillingDate: day('2026-11-27') }),
    ]);

    const summary = await service.summary('user-1', day('2026-11-07'));

    expect(summary.reminderWindowDays).toBe(5);
    expect(summary.upcoming.map((item) => item.id)).toEqual(['sub-1']);
  });

  it('widens the upcoming window with the configured days', async () => {
    const { service, repo } = build({ reminderDaysBefore: 10 });
    repo.findActive.mockResolvedValue([
      subscriptionRow({ id: 'sub-1', nextBillingDate: day('2026-11-10') }),
      subscriptionRow({ id: 'sub-2', nextBillingDate: day('2026-11-13') }),
      subscriptionRow({ id: 'sub-3', nextBillingDate: day('2026-11-27') }),
    ]);

    const summary = await service.summary('user-1', day('2026-11-07'));

    expect(summary.reminderWindowDays).toBe(10);
    expect(summary.upcoming.map((item) => item.id)).toEqual(['sub-1', 'sub-2']);
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

  it('reports a charge that differs from the expected amount', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([subscriptionRow({ id: 'sub-1' })]);
    repo.listPaymentsForSubscriptions.mockResolvedValue([
      paymentRow({
        subscriptionId: 'sub-1',
        amount: 80,
        paidAt: day('2026-10-25'),
      }),
      paymentRow({
        subscriptionId: 'sub-1',
        amount: 100,
        paidAt: day('2026-09-25'),
      }),
    ]);

    const alerts = await service.alerts('user-1', day('2026-10-28'));
    const mismatch = alerts.find((alert) => alert.kind === 'AMOUNT_MISMATCH');

    expect(mismatch).toMatchObject({
      id: 'AMOUNT_MISMATCH:sub-1:2026-10-25',
      amount: '80.00',
      expectedAmount: '100.00',
      previousAmount: null,
    });
    expect(alerts.map((alert) => alert.kind)).not.toContain('PRICE_INCREASE');
  });

  it('does not report a confirmed price increase as a mismatch', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([subscriptionRow({ id: 'sub-1' })]);
    repo.listPaymentsForSubscriptions.mockResolvedValue([
      paymentRow({
        subscriptionId: 'sub-1',
        amount: 120,
        paidAt: day('2026-10-25'),
      }),
      paymentRow({
        subscriptionId: 'sub-1',
        amount: 100,
        paidAt: day('2026-09-25'),
      }),
    ]);

    const alerts = await service.alerts('user-1', day('2026-10-28'));

    expect(alerts.map((alert) => alert.kind)).toEqual(['PRICE_INCREASE']);
  });

  it('dismisses every active alert in one call', async () => {
    const { service, repo } = build();
    repo.findActive.mockResolvedValue([
      subscriptionRow({ id: 'sub-1', nextBillingDate: day('2026-10-20') }),
    ]);

    const dismissal = await service.dismissAllAlerts(
      'user-1',
      day('2026-10-28'),
    );

    expect(repo.dismissAlerts).toHaveBeenCalledWith([
      {
        userId: 'user-1',
        subscriptionId: 'sub-1',
        kind: 'MISSED_CHARGE',
        alertDate: day('2026-10-20'),
      },
    ]);
    expect(dismissal).toEqual({ dismissed: 1 });
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

  it('flags the row when the last charge differs from the expected amount', async () => {
    const { service, repo } = build();
    repo.list.mockResolvedValue([
      subscriptionRow({
        id: 'sub-1',
        amount: 100,
        payments: [{ amount: 80, paidAt: day('2026-10-25') }],
      }),
      subscriptionRow({
        id: 'sub-2',
        amount: 100,
        payments: [{ amount: 100, paidAt: day('2026-10-25') }],
      }),
      subscriptionRow({ id: 'sub-3' }),
    ]);

    const page = await service.list('user-1', { limit: 20 }, day('2026-10-01'));

    expect(page.items.map((item) => item.lastChargeMismatch)).toEqual([
      true,
      false,
      false,
    ]);
    expect(page.items.map((item) => item.lastPaymentAmount)).toEqual([
      '80.00',
      '100.00',
      null,
    ]);
  });

  it('passes the unassigned filters through to the repository', async () => {
    const { service, repo } = build();
    repo.list.mockResolvedValue([]);

    await service.list(
      'user-1',
      { limit: 20, unassignedCategory: true, unassignedMethod: true },
      day('2026-10-01'),
    );

    expect(repo.list).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        unassignedCategory: true,
        unassignedMethod: true,
      }),
    );
  });

  it('passes the category, frequency and order filters through', async () => {
    const { service, repo } = build();
    repo.list.mockResolvedValue([]);

    await service.list(
      'user-1',
      { limit: 20, categoryIds: ['cat-1', 'cat-2'], frequency: 'OTHER' },
      day('2026-10-01'),
    );

    expect(repo.list).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        categoryIds: ['cat-1', 'cat-2'],
        frequency: 'OTHER',
        sort: 'NEXT_DATE',
      }),
    );
  });

  it('continues the page with a key of the active order', async () => {
    const { service, repo } = build();
    repo.list.mockResolvedValue([
      subscriptionRow({ id: 'sub-1', amount: 120 }),
      subscriptionRow({ id: 'sub-2', amount: 80 }),
    ]);

    const page = await service.list(
      'user-1',
      { limit: 1, sort: 'AMOUNT' },
      day('2026-10-01'),
    );

    expect(repo.list).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ sort: 'AMOUNT', take: 2 }),
    );
    expect(
      decodeCursor(String(page.nextCursor), (key: string) =>
        isValidSubscriptionCursorKey('AMOUNT', key),
      ),
    ).toEqual({ key: '120.00', id: 'sub-1' });
  });

  it('rejects a cursor that does not belong to the active order', async () => {
    const { service } = build();
    const forged = encodeCursor({ key: 'Netflix', id: 'sub-1' });

    await expect(
      service.list(
        'user-1',
        { limit: 20, sort: 'AMOUNT', cursor: forged },
        day('2026-10-01'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
