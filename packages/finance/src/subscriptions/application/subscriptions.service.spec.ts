import { ConflictException } from '@nestjs/common';
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
    anchorDate: day('2026-01-31'),
    nextBillingDate: day('2026-02-28'),
    trialEndsAt: null,
    status: 'ACTIVE',
    pausedAt: null,
    cancelledAt: null,
    reminderDaysBefore: 3,
    lastRemindedFor: null,
    cardId: null,
    accountId: null,
    manageUrl: null,
    notes: null,
    sourcePatternId: null,
    createdAt: day('2026-01-31'),
    updatedAt: day('2026-01-31'),
    card: null,
    account: null,
    sourcePattern: null,
    payments: [],
    ...overrides,
  } as unknown as SubscriptionRow;
}

function transactionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    userId: 'user-1',
    merchant: 'NETFLIX',
    amount: 100,
    currency: 'DOP',
    type: 'DEBIT',
    status: 'CONFIRMED',
    transactionDate: day('2026-02-28'),
    ...overrides,
  };
}

function build() {
  const repo = {
    findById: jest.fn(),
    findActive: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(subscriptionRow()),
    create: jest.fn().mockResolvedValue(subscriptionRow()),
    createPayment: jest.fn().mockResolvedValue({
      id: 'payment-1',
      amount: 100,
      currency: 'DOP',
      paidAt: day('2026-02-28'),
      source: 'AUTO',
    }),
    findPaymentByTransaction: jest.fn().mockResolvedValue(null),
    findTransaction: jest.fn(),
  };
  const prisma = { finRecurringPattern: { findFirst: jest.fn() } };
  const logos = {
    resolveUrl: jest.fn().mockReturnValue(null),
    ensureLogo: jest.fn().mockResolvedValue(null),
    saveCustomLogo: jest.fn(),
  };
  const ownership = {
    assertCardOwned: jest.fn(),
    assertAccountOwned: jest.fn(),
  };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('DOP') };
  const resolveAmounts = {
    toBaseCurrency: jest.fn((amount: number) => Promise.resolve(amount)),
  };
  const usersRepository = {
    findUserModuleBySlug: jest.fn().mockResolvedValue(null),
  };

  const service = new SubscriptionsService(
    repo as never,
    prisma as never,
    logos as never,
    ownership as never,
    baseCurrency as never,
    resolveAmounts as never,
    usersRepository as never,
  );

  return { service, repo, resolveAmounts };
}

describe('SubscriptionsService.resume', () => {
  it('recalculates nextBillingDate from today keeping the anchor day', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow({ status: 'PAUSED' }));

    await service.resume('user-1', 'sub-1', day('2026-02-10'));

    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
      expect.objectContaining({
        status: 'ACTIVE',
        pausedAt: null,
        cancelledAt: null,
        nextBillingDate: day('2026-02-28'),
      }),
    );
  });
});

describe('SubscriptionsService.update', () => {
  it('recalculates nextBillingDate when reactivating through PATCH', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow({ status: 'PAUSED' }));

    await service.update(
      'user-1',
      'sub-1',
      { status: 'ACTIVE' },
      day('2026-02-10'),
    );

    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
      expect.objectContaining({
        status: 'ACTIVE',
        nextBillingDate: day('2026-02-28'),
      }),
    );
  });

  it('clears the opposite timestamp when pausing', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow({ status: 'CANCELLED' }));

    await service.update(
      'user-1',
      'sub-1',
      { status: 'PAUSED' },
      day('2026-02-10'),
    );

    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
      expect.objectContaining({ status: 'PAUSED', cancelledAt: null }),
    );
  });
});

describe('SubscriptionsService.create', () => {
  it('derives the first charge from the anchor', async () => {
    const { service, repo } = build();
    repo.create.mockResolvedValue(subscriptionRow());

    await service.create(
      'user-1',
      {
        name: 'Netflix',
        amount: 100,
        billingCycle: 'MONTHLY',
        anchorDate: '2026-01-31',
      },
      day('2026-02-10'),
    );

    expect(repo.create).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ nextBillingDate: day('2026-02-28') }),
    );
  });
});

describe('SubscriptionsService.matchTransaction', () => {
  it('registers the payment and advances when exactly one subscription matches', async () => {
    const { service, repo } = build();
    repo.findTransaction.mockResolvedValue(transactionRow());
    repo.findActive.mockResolvedValue([subscriptionRow()]);

    await service.matchTransaction({ userId: 'user-1', transactionId: 'tx-1' });

    expect(repo.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        transactionId: 'tx-1',
        source: 'AUTO',
      }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      'user-1',
      'sub-1',
      expect.objectContaining({ nextBillingDate: day('2026-03-31') }),
    );
  });

  it('does not register anything when several subscriptions match', async () => {
    const { service, repo } = build();
    repo.findTransaction.mockResolvedValue(transactionRow());
    repo.findActive.mockResolvedValue([
      subscriptionRow({ id: 'sub-1' }),
      subscriptionRow({ id: 'sub-2' }),
    ]);

    await service.matchTransaction({ userId: 'user-1', transactionId: 'tx-1' });

    expect(repo.createPayment).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('ignores a movement already linked to the subscription', async () => {
    const { service, repo } = build();
    repo.findTransaction.mockResolvedValue(transactionRow());
    repo.findActive.mockResolvedValue([subscriptionRow()]);
    repo.findPaymentByTransaction.mockResolvedValue({ id: 'payment-1' });

    await service.matchTransaction({ userId: 'user-1', transactionId: 'tx-1' });

    expect(repo.createPayment).not.toHaveBeenCalled();
  });
});

describe('SubscriptionsService.recordManualPayment', () => {
  it('rejects a movement already registered for the subscription', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow());
    repo.findTransaction.mockResolvedValue(transactionRow());
    repo.findPaymentByTransaction.mockResolvedValue({ id: 'payment-1' });

    await expect(
      service.recordManualPayment('user-1', 'sub-1', {
        transactionId: 'tx-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.createPayment).not.toHaveBeenCalled();
  });

  it('does not advance the schedule for a paused subscription', async () => {
    const { service, repo } = build();
    repo.findById.mockResolvedValue(subscriptionRow({ status: 'PAUSED' }));

    await service.recordManualPayment('user-1', 'sub-1', { amount: 50 });

    expect(repo.createPayment).toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
