import type { CatalogRepository } from '../infrastructure/catalog.repository';
import { InstrumentHistoryService } from './instrument-history.service';

function event(
  id: string,
  kind: string,
  at: string,
  payload: Record<string, unknown> = {},
) {
  return { id, kind, payload, createdAt: new Date(at) };
}

function adjustment(id: string, at: string, amount: number, currency: string) {
  return {
    id,
    amount,
    currency,
    transactionDate: new Date(at),
  };
}

describe('InstrumentHistoryService', () => {
  const findAccountById = jest.fn();
  const findCardById = jest.fn();
  const findInstrumentEvents = jest.fn();
  const findAdjustmentTransactions = jest.fn();
  const repo = {
    findAccountById,
    findCardById,
    findInstrumentEvents,
    findAdjustmentTransactions,
  } as unknown as CatalogRepository;

  const service = new InstrumentHistoryService(repo);

  beforeEach(() => {
    jest.clearAllMocks();
    findAccountById.mockResolvedValue({ id: 'acc-1', name: 'Nómina' });
    findCardById.mockResolvedValue({ id: 'card-1', name: 'Visa' });
    findInstrumentEvents.mockResolvedValue([]);
    findAdjustmentTransactions.mockResolvedValue([]);
  });

  it('merges limit changes and adjustments in reverse chronological order', async () => {
    findInstrumentEvents.mockResolvedValue([
      event('e1', 'CREDIT_LIMIT_CHANGED', '2026-10-02T12:00:00.000Z', {
        previousLimit: 1000,
        nextLimit: 2000,
      }),
    ]);
    findAdjustmentTransactions.mockResolvedValue([
      adjustment('a1', '2026-10-03T12:00:00.000Z', 150, 'DOP'),
    ]);

    const page = await service.getCardHistory('user-1', 'card-1', {
      limit: 10,
    });

    expect(page.items.map((item) => item.id)).toEqual(['a1', 'e1']);
    expect(page.items[0]).toMatchObject({
      kind: 'ADJUSTMENT',
      amount: '150',
      currency: 'DOP',
    });
    expect(page.items[1]).toMatchObject({
      kind: 'CREDIT_LIMIT_CHANGED',
      payload: { previousLimit: 1000, nextLimit: 2000 },
    });
  });

  it('applies the cursor to the merged timeline', async () => {
    findInstrumentEvents.mockResolvedValue([
      event('e1', 'CREDIT_LIMIT_CHANGED', '2026-10-02T12:00:00.000Z'),
    ]);
    findAdjustmentTransactions.mockResolvedValue([
      adjustment('a1', '2026-10-03T12:00:00.000Z', 150, 'DOP'),
    ]);

    const firstPage = await service.getCardHistory('user-1', 'card-1', {
      limit: 1,
    });
    expect(firstPage.items.map((item) => item.id)).toEqual(['a1']);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await service.getCardHistory('user-1', 'card-1', {
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual(['e1']);
    const [, , pageArg] = findInstrumentEvents.mock.calls.at(-1) ?? [];
    expect(pageArg).toEqual({
      cursor: expect.objectContaining({ id: 'a1' }),
      take: 2,
    });
  });

  it('rejects an account that does not belong to the user', async () => {
    findAccountById.mockResolvedValue(null);

    await expect(
      service.getAccountHistory('user-1', 'acc-x', { limit: 10 }),
    ).rejects.toThrow('Account not found');
  });
});
