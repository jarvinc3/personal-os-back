import { FinanceEvents } from '../../contracts';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@personal-os/database';
import { BalanceIntegrityService } from './balance-integrity.service';
import type {
  BalanceDriftRow,
  IntegrityRepository,
  IntegritySnapshot,
} from '../infrastructure/integrity.repository';

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

const BALANCED_SNAPSHOT: IntegritySnapshot = {
  accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 0 }],
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

function build(overrides: {
  snapshot?: IntegritySnapshot;
  open?: BalanceDriftRow[];
  openAfter?: BalanceDriftRow[];
  create?: jest.Mock;
}) {
  const repo = {
    loadSnapshot: jest
      .fn()
      .mockResolvedValue(overrides.snapshot ?? DRIFTED_SNAPSHOT),
    listOpenDrifts: jest
      .fn()
      .mockResolvedValueOnce(overrides.open ?? [])
      .mockResolvedValueOnce(overrides.openAfter ?? [driftRow()]),
    findOpenDrift: jest.fn().mockResolvedValue(driftRow()),
    createDrift: overrides.create ?? jest.fn().mockResolvedValue(driftRow()),
    updateDrift: jest.fn(),
    resolveDrift: jest.fn().mockResolvedValue(undefined),
    correctBalance: jest.fn().mockResolvedValue(undefined),
    listUserIdsWithProducts: jest.fn().mockResolvedValue(['user-1']),
  };
  const events = { enqueue: jest.fn().mockResolvedValue({ eventId: 'e1' }) };
  const service = new BalanceIntegrityService(
    repo as unknown as IntegrityRepository,
    events,
  );
  return { service, repo, events };
}

describe('BalanceIntegrityService', () => {
  it('records a drift on check and returns it as a view', async () => {
    const { service, repo } = build({});
    const checked = await service.check('user-1');

    expect(repo.createDrift).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        storedCents: 10000,
        expectedCents: 0,
      }),
    );
    expect(checked.drifts).toEqual([
      expect.objectContaining({
        id: 'drift-1',
        accountId: 'acc-1',
        storedBalance: '100.00',
        expectedBalance: '0.00',
        difference: '-100.00',
        name: 'Ahorros',
      }),
    ]);
  });

  it('closes a stale drift when the product no longer drifts', async () => {
    const stale = driftRow({ id: 'drift-stale' });
    const { service, repo } = build({
      snapshot: BALANCED_SNAPSHOT,
      open: [stale],
      openAfter: [],
    });

    const checked = await service.check('user-1', { accountId: 'acc-1' });

    expect(repo.createDrift).not.toHaveBeenCalled();
    expect(repo.resolveDrift).toHaveBeenCalledWith(
      'drift-stale',
      expect.any(Date),
    );
    expect(checked.drifts).toEqual([]);
  });

  it('rejects a check for an account that does not exist', async () => {
    const { service } = build({});
    await expect(
      service.check('user-1', { accountId: 'missing' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recalculates the stored balance from the confirmed movements', async () => {
    const { service, repo } = build({});
    const recalculated = await service.recalculate('user-1', {
      accountId: 'acc-1',
    });

    expect(repo.correctBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        target: { accountId: 'acc-1' },
        currency: 'DOP',
        expectedCents: 0,
      }),
    );
    expect(recalculated).toEqual({
      corrected: true,
      accountId: 'acc-1',
      cardId: null,
      currency: 'DOP',
      balance: '0.00',
    });
  });

  it('requires a currency to recalculate a card', async () => {
    const { service } = build({});
    await expect(
      service.recalculate('user-1', { cardId: 'card-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('emits one event per changed drift on the nightly sweep', async () => {
    const { service, events } = build({});
    const changed = await service.runForUser('user-1');

    expect(changed).toBe(1);
    expect(events.enqueue).toHaveBeenCalledTimes(1);
    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: FinanceEvents.BALANCE_DRIFT_DETECTED,
        aggregateType: 'FinBalanceDrift',
        aggregateId: 'drift-1',
        userId: 'user-1',
        payload: expect.objectContaining({
          driftId: 'drift-1',
          accountId: 'acc-1',
          difference: '-100.00',
        }),
      }),
    );
  });

  it('does not emit when a drift already existed with the same difference', async () => {
    const { service, events } = build({
      open: [driftRow()],
      openAfter: [driftRow()],
    });
    const changed = await service.runForUser('user-1');

    expect(changed).toBe(0);
    expect(events.enqueue).not.toHaveBeenCalled();
  });

  it('refreshes an open drift when the amount moved but the difference holds', async () => {
    const stale = driftRow({
      storedBalance: new Prisma.Decimal(100),
      expectedBalance: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(-100),
    });
    const refreshed = driftRow({
      storedBalance: new Prisma.Decimal(150),
      expectedBalance: new Prisma.Decimal(50),
      difference: new Prisma.Decimal(-100),
    });
    const { service, repo, events } = build({
      snapshot: {
        accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 15000 }],
        cards: [],
        cardBalances: [],
        movements: [
          {
            accountId: 'acc-1',
            cardId: null,
            type: 'CREDIT',
            ledgerAmountCents: 5000,
            ledgerCurrency: 'DOP',
          },
        ],
      },
      open: [stale],
      openAfter: [refreshed],
    });
    repo.updateDrift.mockResolvedValue(refreshed);

    const changed = await service.runForUser('user-1');

    expect(repo.updateDrift).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'drift-1',
        storedCents: 15000,
        expectedCents: 5000,
      }),
    );
    expect(changed).toBe(0);
    expect(events.enqueue).not.toHaveBeenCalled();
  });

  it('emits again when an open drift changes its difference', async () => {
    const stale = driftRow({
      storedBalance: new Prisma.Decimal(100),
      expectedBalance: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(-100),
    });
    const refreshed = driftRow({
      storedBalance: new Prisma.Decimal(150),
      expectedBalance: new Prisma.Decimal(0),
      difference: new Prisma.Decimal(-150),
    });
    const { service, repo, events } = build({
      snapshot: {
        accounts: [{ id: 'acc-1', currency: 'DOP', balanceCents: 15000 }],
        cards: [],
        cardBalances: [],
        movements: [],
      },
      open: [stale],
      openAfter: [refreshed],
    });
    repo.updateDrift.mockResolvedValue(refreshed);

    const changed = await service.runForUser('user-1');

    expect(changed).toBe(1);
    expect(events.enqueue).toHaveBeenCalledTimes(1);
    expect(events.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          storedBalance: '150.00',
          expectedBalance: '0.00',
          difference: '-150.00',
        }),
      }),
    );
  });
});
