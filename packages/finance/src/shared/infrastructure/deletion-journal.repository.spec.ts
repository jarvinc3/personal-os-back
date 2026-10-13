import { DeletionJournalRepository } from './deletion-journal.repository';
import type { DeletionSnapshot } from '../domain/deletion-snapshot';

const now = new Date('2026-10-12T12:00:00.000Z');

function snapshotWithLegs(legs: number): DeletionSnapshot {
  return {
    rows: Array.from({ length: legs }, (_, index) => ({
      model: 'FinTransaction' as const,
      values: {
        id: `tx-${index}`,
        transferGroupId: 'grp-1',
        amount: '10.00',
      },
    })),
    ledgerReversed: ['tx-0', 'tx-1'].slice(0, legs),
  };
}

function build(overrides: {
  findFirst?: jest.Mock;
  transaction?: jest.Mock;
  deleteMany?: jest.Mock;
}) {
  const finDeletionJournal = {
    create: jest.fn().mockResolvedValue({ id: 'j1' }),
    findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
    deleteMany:
      overrides.deleteMany ?? jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    finDeletionJournal,
    $transaction:
      overrides.transaction ??
      jest.fn().mockImplementation((run: (tx: unknown) => unknown) =>
        Promise.resolve(
          run({
            finDeletionJournal: {
              create: jest.fn(),
              updateMany: jest.fn(),
            },
          }),
        ),
      ),
  };
  return { repo: new DeletionJournalRepository(prisma as never), prisma };
}

describe('DeletionJournalRepository', () => {
  it('records the operation group, the snapshot size and the expiry', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'j1' });
    const { repo } = build({});
    const snapshot = snapshotWithLegs(2);

    await repo.record({ finDeletionJournal: { create } } as never, {
      userId: 'user-1',
      entityType: 'transaction',
      entityId: 'grp-1',
      snapshot,
    });

    const createdEntry = create.mock.calls[0][0].data;
    expect(createdEntry.operationGroupId).toBe('grp-1');
    expect(createdEntry.sizeBytes).toBe(
      Buffer.byteLength(JSON.stringify(snapshot), 'utf8'),
    );
    expect(createdEntry.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('reports an already-restored entry instead of a missing one', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'j1' });
    const { repo } = build({ findFirst });

    const restoreOutcome = await repo.restore(
      'user-1',
      'transaction',
      'tx-1',
      now,
    );

    expect(restoreOutcome).toEqual({ count: 0, alreadyRestored: true });
  });

  it('maps a unique-key clash on replay to RESTORE_CONFLICT', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'j1',
      operationGroupId: 'grp-1',
      snapshot: snapshotWithLegs(2),
    });
    const transaction = jest
      .fn()
      .mockRejectedValue({ code: 'P2002', meta: { target: ['name'] } });
    const { repo } = build({ findFirst, transaction });

    await expect(
      repo.restore('user-1', 'institution', 'inst-1', now),
    ).rejects.toMatchObject({ response: { code: 'RESTORE_CONFLICT' } });
  });

  it('refuses to restore one leg of a grouped operation', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'j1',
      operationGroupId: 'grp-1',
      snapshot: snapshotWithLegs(1),
    });
    const { repo, prisma } = build({ findFirst });

    await expect(
      repo.restore('user-1', 'transaction', 'tx-0', now),
    ).rejects.toMatchObject({ response: { code: 'PARTIAL_OPERATION' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('purges only the entries past their expiry', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 2 });
    const { repo } = build({ deleteMany });

    const purgeResult = await repo.purgeExpired(now);

    expect(purgeResult).toEqual({ count: 2 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});
