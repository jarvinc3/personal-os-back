import { UnprocessableEntityException } from '@nestjs/common';
import { ReconciliationsService } from './reconciliations.service';
import type {
  ReconciliationRow,
  ReconciliationTarget,
  ResolvedAdjustmentInput,
} from '../infrastructure/reconciliations.repository';

const accountTarget: ReconciliationTarget = {
  accountId: 'acc-1',
  cardId: null,
  cardType: null,
  derivedAccountId: null,
  currency: 'DOP',
  name: 'Ahorros',
  institutionName: 'BHD',
  currentBalance: 10000,
};

function reconciliationRow(
  overrides: Partial<ReconciliationRow> = {},
): ReconciliationRow {
  return {
    id: 'rec-1',
    userId: 'user-1',
    accountId: 'acc-1',
    cardId: null,
    currency: 'DOP',
    asOfDate: new Date('2026-10-15T00:00:00.000Z'),
    appBalance: 10000,
    realBalance: 9950,
    difference: -50,
    note: null,
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
    adjustments: [
      {
        id: 'adj-1',
        kind: 'IMPUESTO_DGII',
        amount: -15,
        transactionId: 'tx-1',
      },
      { id: 'adj-2', kind: 'OTRO', amount: -35, transactionId: 'tx-2' },
    ],
    ...overrides,
  };
}

function build(
  overrides: {
    target?: ReconciliationTarget | null;
    create?: jest.Mock;
  } = {},
) {
  const repo = {
    findTarget: jest.fn().mockResolvedValue(overrides.target ?? accountTarget),
    sumOutgoing: jest.fn().mockResolvedValue(10000),
    create:
      overrides.create ?? jest.fn().mockResolvedValue(reconciliationRow()),
    list: jest.fn().mockResolvedValue([]),
    findById: jest.fn(),
    delete: jest.fn(),
    restore: jest.fn(),
    listProducts: jest.fn().mockResolvedValue([
      {
        key: 'account:acc-1',
        kind: 'account',
        accountId: 'acc-1',
        cardId: null,
        currency: 'DOP',
        name: 'Ahorros',
        institutionName: 'BHD',
        balance: 9950,
      },
      {
        key: 'card:card-1:DOP',
        kind: 'card',
        accountId: null,
        cardId: 'card-1',
        currency: 'DOP',
        name: 'Visa',
        institutionName: 'Popular',
        balance: -1200,
      },
    ]),
    listBetween: jest.fn().mockResolvedValue([
      {
        id: 'rec-1',
        accountId: 'acc-1',
        cardId: null,
        currency: 'DOP',
        asOfDate: new Date('2026-10-15T00:00:00.000Z'),
        realBalance: 9950,
        difference: -50,
        createdAt: new Date('2026-10-15T12:00:00.000Z'),
      },
    ]),
    listAdjustmentsBetween: jest.fn().mockResolvedValue([]),
  };
  const resolveAmounts = {
    execute: jest.fn().mockImplementation((params: { amount: number }) =>
      Promise.resolve({
        amount: params.amount,
        currency: 'DOP',
        ledgerAmount: params.amount,
        ledgerCurrency: 'DOP',
        amountBaseCurrency: params.amount,
        exchangeRate: 1,
      }),
    ),
  };
  const baseCurrency = { execute: jest.fn().mockResolvedValue('DOP') };
  const service = new ReconciliationsService(
    repo as never,
    resolveAmounts as never,
    baseCurrency as never,
  );
  return { service, repo, resolveAmounts, baseCurrency };
}

describe('ReconciliationsService', () => {
  it('previews the difference and the DGII suggestion', async () => {
    const { service } = build();
    const preview = await service.preview('user-1', {
      accountId: 'acc-1',
      asOfDate: '2026-10-15',
      realBalance: 9950,
    });
    expect(preview).toMatchObject({
      appBalance: '10000.00',
      realBalance: '9950.00',
      difference: '-50.00',
      currency: 'DOP',
      suggestedAdjustments: [
        { kind: 'IMPUESTO_DGII', amount: '-15.00' },
        { kind: 'OTRO', amount: '-35.00' },
      ],
    });
  });

  it('keeps the card currency when converting adjustments', async () => {
    const { service, resolveAmounts } = build({
      target: {
        accountId: null,
        cardId: 'card-1',
        cardType: 'CREDIT',
        derivedAccountId: null,
        currency: 'USD',
        name: 'Visa',
        institutionName: 'Popular',
        currentBalance: 100,
      },
    });
    const preview = await service.preview('user-1', {
      cardId: 'card-1',
      currency: 'USD',
      asOfDate: '2026-10-15',
      realBalance: 90,
    });
    expect(preview.currency).toBe('USD');
    expect(resolveAmounts.execute).not.toHaveBeenCalled();
  });

  it('rejects adjustments that do not add up to the difference', async () => {
    const { service, repo } = build();
    await expect(
      service.create('user-1', {
        accountId: 'acc-1',
        asOfDate: '2026-10-15',
        realBalance: 9950,
        adjustments: [{ kind: 'OTRO', amount: -40 }],
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a non-zero difference without adjustments', async () => {
    const { service } = build();
    await expect(
      service.create('user-1', {
        accountId: 'acc-1',
        asOfDate: '2026-10-15',
        realBalance: 9950,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('registers a zero-difference close without movements', async () => {
    const { service, repo } = build();
    await service.create('user-1', {
      accountId: 'acc-1',
      asOfDate: '2026-10-15',
      realBalance: 10000,
      adjustments: [{ kind: 'OTRO', amount: -5 }],
    });
    const call = repo.create.mock.calls[0]?.[1] as {
      difference: number;
      adjustments: ResolvedAdjustmentInput[];
    };
    expect(call.difference).toBe(0);
    expect(call.adjustments).toEqual([]);
  });

  it('creates the close with resolved signed adjustments', async () => {
    const { service, repo } = build();
    const created = await service.create('user-1', {
      accountId: 'acc-1',
      asOfDate: '2026-10-15',
      realBalance: 9950,
      adjustments: [
        { kind: 'IMPUESTO_DGII', amount: -15 },
        { kind: 'OTRO', amount: -35 },
      ],
    });
    const call = repo.create.mock.calls[0]?.[1] as {
      adjustments: ResolvedAdjustmentInput[];
      appBalance: number;
      difference: number;
    };
    expect(call.appBalance).toBe(10000);
    expect(call.difference).toBe(-50);
    expect(
      call.adjustments.map((adjustment) => adjustment.amounts.ledgerAmount),
    ).toEqual([-15, -35]);
    expect(created).toMatchObject({
      id: 'rec-1',
      difference: '-50.00',
      adjustments: [
        { kind: 'IMPUESTO_DGII', amount: '-15.00' },
        { kind: 'OTRO', amount: '-35.00' },
      ],
    });
  });

  it('marks reconciled and pending products for a month', async () => {
    const { service } = build();
    const status = await service.status('user-1', '2026-10');
    expect(status.reconciledCount).toBe(1);
    expect(status.pendingCount).toBe(1);
    expect(status.items.map((item) => item.reconciled)).toEqual([true, false]);
  });

  it('groups bank charges by month, institution and kind', async () => {
    const { service, repo } = build();
    repo.listAdjustmentsBetween.mockResolvedValue([
      {
        kind: 'IMPUESTO_DGII',
        amount: -15,
        reconciliation: {
          asOfDate: new Date('2026-10-15T00:00:00.000Z'),
          account: {
            institutionId: 'inst-1',
            institutionRef: { name: 'BHD' },
          },
          card: null,
        },
      },
      {
        kind: 'COMISION',
        amount: -35,
        reconciliation: {
          asOfDate: new Date('2026-10-16T00:00:00.000Z'),
          account: null,
          card: { institutionId: 'inst-2', institution: { name: 'Popular' } },
        },
      },
    ]);
    const charges = await service.bankCharges(
      'user-1',
      new Date('2026-10-01T00:00:00.000Z'),
      new Date('2026-10-31T00:00:00.000Z'),
    );
    expect(charges.total).toBe('-50.00');
    expect(charges.count).toBe(2);
    expect(charges.byInstitution).toEqual([
      { name: 'Popular', total: '-35.00', count: 1 },
      { name: 'BHD', total: '-15.00', count: 1 },
    ]);
    expect(charges.byKind).toEqual([
      { kind: 'COMISION', total: '-35.00', count: 1 },
      { kind: 'IMPUESTO_DGII', total: '-15.00', count: 1 },
    ]);
  });
});
