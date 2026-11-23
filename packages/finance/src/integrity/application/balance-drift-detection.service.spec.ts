import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import type {
  BalanceDriftRow,
  IntegrityRepository,
  IntegritySnapshot,
} from '../infrastructure/integrity.repository';
import { BalanceDriftDetectionService } from './balance-drift-detection.service';

function driftRow(overrides: Partial<BalanceDriftRow> = {}): BalanceDriftRow {
  return {
    id: 'drift-1',
    accountId: 'acc-1',
    cardId: null,
    currency: 'DOP',
    storedBalance: new Prisma.Decimal(100),
    expectedBalance: new Prisma.Decimal(0),
    difference: new Prisma.Decimal(-100),
    detectedAt: new Date('2026-10-20T04:00:00.000Z'),
    resolvedAt: null,
    account: { name: 'Ahorros' },
    card: null,
    ...overrides,
  };
}

const DRIFTED_SNAPSHOT: IntegritySnapshot = {
  accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 10000 }],
  cards: [],
  cardBalances: [],
  movements: [
    {
      accountId: 'acc-1',
      cardId: null,
      type: 'DEBIT',
      ledgerAmountCents: -10000,
      ledgerCurrency: 'DOP',
    },
    {
      accountId: 'acc-1',
      cardId: null,
      type: 'CREDIT',
      ledgerAmountCents: 10000,
      ledgerCurrency: 'DOP',
    },
  ],
};

const CARD_SNAPSHOT: IntegritySnapshot = {
  accounts: [],
  cards: [{ id: 'card-1', type: 'CREDIT', accountId: null }],
  cardBalances: [
    { id: 'balance-1', cardId: 'card-1', currency: 'USD', balanceCents: 20000 },
  ],
  movements: [
    {
      accountId: null,
      cardId: 'card-1',
      type: 'DEBIT',
      ledgerAmountCents: -5000,
      ledgerCurrency: 'USD',
    },
  ],
};

const BALANCED_SNAPSHOT: IntegritySnapshot = {
  accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 0 }],
  cards: [],
  cardBalances: [],
  movements: [],
};

function build(overrides: {
  snapshot?: IntegritySnapshot;
  open?: BalanceDriftRow[];
  openAfter?: BalanceDriftRow[];
}) {
  const repo = {
    loadSnapshot: jest
      .fn()
      .mockResolvedValue(overrides.snapshot ?? DRIFTED_SNAPSHOT),
    listOpenDrifts: jest
      .fn()
      .mockResolvedValueOnce(overrides.open ?? [])
      .mockResolvedValueOnce(overrides.openAfter ?? [driftRow()]),
    createDrift: jest.fn().mockResolvedValue(driftRow()),
    updateDrift: jest.fn(),
    resolveDrift: jest.fn().mockResolvedValue(undefined),
  };
  const detection = new BalanceDriftDetectionService(
    repo as unknown as IntegrityRepository,
  );
  return { detection, repo };
}

describe('BalanceDriftDetectionService', () => {
  it('records a drift and exposes its money as labels', async () => {
    const { detection, repo } = build({});

    const checked = await detection.check('user-1');

    expect(repo.createDrift).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        storedCents: 10000,
        expectedCents: 0,
      }),
    );
    expect(checked.drifts).toEqual([
      expect.objectContaining({
        storedBalance: '100.00',
        expectedBalance: '0.00',
        difference: '-100.00',
        name: 'Ahorros',
      }),
    ]);
  });

  it('closes a stale drift when the product no longer drifts', async () => {
    const stale = driftRow({ id: 'drift-stale' });
    const { detection, repo } = build({
      snapshot: BALANCED_SNAPSHOT,
      open: [stale],
      openAfter: [],
    });

    const checked = await detection.check('user-1', { accountId: 'acc-1' });

    expect(repo.createDrift).not.toHaveBeenCalled();
    expect(repo.resolveDrift).toHaveBeenCalledWith(
      'drift-stale',
      expect.any(Date),
    );
    expect(checked.drifts).toEqual([]);
  });

  it('rejects a check for a product the user does not own', async () => {
    const { detection } = build({});

    await expect(
      detection.check('user-1', { accountId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('finds a card balance by its currency', async () => {
    const { detection } = build({ snapshot: CARD_SNAPSHOT });

    const product = await detection.findProduct('user-1', {
      cardId: 'card-1',
      currency: 'usd',
    });

    expect(product).toMatchObject({
      target: { cardId: 'card-1', currency: 'USD' },
      currency: 'USD',
      storedCents: 20000,
      expectedCents: -5000,
    });
  });

  it('returns no product when the target is not in the snapshot', async () => {
    const { detection } = build({ snapshot: CARD_SNAPSHOT });

    await expect(
      detection.findProduct('user-1', { accountId: 'acc-1' }),
    ).resolves.toBeNull();
  });

  it('keeps the sweep silent when everything is balanced', async () => {
    const { detection, repo } = build({
      snapshot: BALANCED_SNAPSHOT,
      open: [],
      openAfter: [],
    });

    const { changed } = await detection.sweep('user-1');

    expect(changed).toEqual([]);
    expect(repo.createDrift).not.toHaveBeenCalled();
  });
});
