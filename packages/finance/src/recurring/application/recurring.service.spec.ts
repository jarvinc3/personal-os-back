import { Prisma } from '@personal-os/database';
import { RecurringService } from './recurring.service';
import type { RecurringRepository } from '../infrastructure/recurring.repository';
import type { MerchantsService } from '../../merchants/application/merchants.service';

type RepoMock = {
  findChargesForDetection: jest.Mock;
  findPatternByMerchantAndKind: jest.Mock;
  findPatternById: jest.Mock;
  createPattern: jest.Mock;
  updatePattern: jest.Mock;
  findConfirmedPatterns: jest.Mock;
};

function charge(id: string, day: number, amount: number) {
  return {
    id,
    merchantId: 'merchant-1',
    merchantName: 'Netflix',
    categoryId: null,
    type: 'DEBIT' as const,
    amount,
    transactionDate: new Date(Date.UTC(2026, 0, day)),
  };
}

function patternRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pattern-1',
    userId: 'user-1',
    categoryId: null,
    merchantId: 'merchant-1',
    merchant: 'Netflix',
    avgAmount: new Prisma.Decimal('100.00'),
    currency: 'DOP',
    frequency: '30',
    nextExpectedDate: new Date(Date.UTC(2026, 1, 1)),
    amountTolerance: new Prisma.Decimal('10'),
    status: 'SUGGESTED' as const,
    kind: 'SUBSCRIPTION' as const,
    confidenceScore: 70,
    lastSeenAt: new Date(Date.UTC(2026, 0, 31)),
    confirmedAt: null,
    aiAnalysis: {},
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    merchantRef: { name: 'Netflix', logoUrl: null, categoryId: null },
    ...overrides,
  };
}

function build(overrides: Partial<RepoMock> = {}) {
  const repo: RepoMock = {
    findChargesForDetection: jest.fn().mockResolvedValue([]),
    findPatternByMerchantAndKind: jest.fn().mockResolvedValue(null),
    findPatternById: jest.fn().mockResolvedValue(patternRow()),
    createPattern: jest.fn().mockResolvedValue(patternRow()),
    updatePattern: jest.fn().mockResolvedValue(patternRow()),
    findConfirmedPatterns: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const merchants = { resolve: jest.fn(), get: jest.fn() };
  const ownership = { assertCategoryVisible: jest.fn() };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('DOP') };
  return {
    service: new RecurringService(
      repo as unknown as RecurringRepository,
      merchants as unknown as MerchantsService,
      ownership as never,
      baseCurrency as never,
    ),
    repo,
    merchants,
  };
}

const now = new Date(Date.UTC(2026, 2, 10));

describe('RecurringService.detect', () => {
  it('creates a SUGGESTED pattern for three monthly charges', async () => {
    const { service, repo } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 500),
          charge('b', 31, 500),
          charge('c', 61, 505),
        ]),
    });

    await service.detect('user-1', now);

    expect(repo.createPattern).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        merchantId: 'merchant-1',
        status: 'SUGGESTED',
        kind: 'SUBSCRIPTION',
        frequency: '30',
        currency: 'DOP',
        amountTolerance: 10,
      }),
    );
  });

  it('never revives a dismissed pattern', async () => {
    const { service, repo } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 500),
          charge('b', 31, 500),
          charge('c', 61, 500),
        ]),
      findPatternByMerchantAndKind: jest
        .fn()
        .mockResolvedValue(patternRow({ status: 'DISMISSED' })),
    });

    await service.detect('user-1', now);

    expect(repo.createPattern).not.toHaveBeenCalled();
    expect(repo.updatePattern).not.toHaveBeenCalled();
  });

  it('reports a price increase on a confirmed pattern', async () => {
    const { service, repo } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 100),
          charge('b', 31, 100),
          charge('c', 61, 150),
        ]),
      findPatternByMerchantAndKind: jest.fn().mockResolvedValue(
        patternRow({
          status: 'CONFIRMED',
          avgAmount: new Prisma.Decimal('100.00'),
        }),
      ),
    });

    const outcome = await service.detect('user-1', now);

    expect(repo.updatePattern).toHaveBeenCalled();
    expect(outcome.priceChanges).toEqual([
      {
        patternId: 'pattern-1',
        merchant: 'Netflix',
        currency: 'DOP',
        previousAmount: 100,
        newAmount: 150,
      },
    ]);
  });

  it('does not flag a small price move inside the tolerance', async () => {
    const { service } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 100),
          charge('b', 31, 100),
          charge('c', 61, 105),
        ]),
      findPatternByMerchantAndKind: jest.fn().mockResolvedValue(
        patternRow({
          status: 'CONFIRMED',
          avgAmount: new Prisma.Decimal('100.00'),
        }),
      ),
    });

    const outcome = await service.detect('user-1', now);

    expect(outcome.priceChanges).toEqual([]);
  });

  it('keeps the stored tolerance after a confirmed run', async () => {
    const { service, repo } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 100),
          charge('b', 31, 100),
          charge('c', 61, 150),
        ]),
      findPatternByMerchantAndKind: jest.fn().mockResolvedValue(
        patternRow({
          status: 'CONFIRMED',
          amountTolerance: new Prisma.Decimal('10'),
        }),
      ),
    });

    await service.detect('user-1', now);

    expect(repo.updatePattern).toHaveBeenCalledWith(
      'user-1',
      'pattern-1',
      expect.objectContaining({ amountTolerance: 10 }),
    );
  });

  it('flags the same price rise on a later run', async () => {
    const { service } = build({
      findChargesForDetection: jest
        .fn()
        .mockResolvedValue([
          charge('a', 1, 100),
          charge('b', 31, 100),
          charge('c', 61, 150),
        ]),
      findPatternByMerchantAndKind: jest.fn().mockResolvedValue(
        patternRow({
          status: 'CONFIRMED',
          avgAmount: { toString: () => '116.67' },
          amountTolerance: { toString: () => '10' },
        }),
      ),
    });

    const outcome = await service.detect('user-1', now);

    expect(outcome.priceChanges).toHaveLength(1);
  });
});

describe('RecurringService.create', () => {
  it('rejects a manual recurring with no merchant', async () => {
    const { service } = build();

    await expect(
      service.create('user-1', {
        avgAmount: 100,
        frequency: 30,
        nextExpectedDate: '2026-04-01',
      }),
    ).rejects.toThrow('merchant or merchantId is required');
  });
});

describe('RecurringService.update', () => {
  it('computes the monthly and annual equivalents as exact decimals', async () => {
    const { service } = build({
      updatePattern: jest
        .fn()
        .mockResolvedValue(
          patternRow({ avgAmount: '0.125', frequency: '365' }),
        ),
    });

    const updated = await service.update('user-1', 'pattern-1', {});

    // 0.125 a year is 0.01 a month; the half cent rounds to the even cent.
    expect(updated.monthlyEquivalent).toBe('0.01');
    expect(updated.annualEquivalent).toBe('0.12');
  });

  it('resolves the merchant when the name is edited', async () => {
    const { service, repo, merchants } = build();
    merchants.resolve.mockResolvedValue({
      id: 'merchant-2',
      name: 'Renta',
      normalizedKey: 'RENTA',
      categoryId: null,
    });

    await service.update('user-1', 'pattern-1', { merchant: 'Renta' });

    expect(merchants.resolve).toHaveBeenCalledWith('user-1', 'Renta');
    expect(repo.updatePattern).toHaveBeenCalledWith(
      'user-1',
      'pattern-1',
      expect.objectContaining({ merchant: 'Renta', merchantId: 'merchant-2' }),
    );
  });
});
