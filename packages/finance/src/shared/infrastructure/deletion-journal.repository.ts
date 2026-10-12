import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type {
  ClearedAccountLink,
  ClearedCategory,
  DeletionEntity,
  DeletionRow,
  DeletionSnapshot,
  UpdatedRow,
} from '../domain/deletion-snapshot';

type DeletionEntry = {
  userId: string;
  entityType: DeletionEntity;
  entityId: string;
  snapshot: DeletionSnapshot;
};

type DeletableDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
};

@Injectable()
export class DeletionJournalRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(tx: Prisma.TransactionClient, entry: DeletionEntry) {
    return tx.finDeletionJournal.create({
      data: {
        userId: entry.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        snapshot: entry.snapshot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  findPending(userId: string, entityType: DeletionEntity, entityId: string) {
    return this.prisma.finDeletionJournal.findFirst({
      where: { userId, entityType, entityId, restoredAt: null },
      orderBy: { deletedAt: 'desc' },
    });
  }

  listPending(userId: string) {
    return this.prisma.finDeletionJournal.findMany({
      where: { userId, restoredAt: null },
      select: {
        entityType: true,
        entityId: true,
        snapshot: true,
        deletedAt: true,
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  markRestored(tx: Prisma.TransactionClient, id: string, now: Date) {
    return tx.finDeletionJournal.updateMany({
      where: { id, restoredAt: null },
      data: { restoredAt: now },
    });
  }

  /**
   * Puts back what a delete removed and closes its journal entry. The caller
   * owns the ledger side, which needs the balance helpers of that capability.
   */
  async restore(
    userId: string,
    entityType: DeletionEntity,
    entityId: string,
    now: Date,
    afterReplay?: (
      tx: Prisma.TransactionClient,
      snapshot: DeletionSnapshot,
    ) => Promise<void>,
  ): Promise<{ count: number }> {
    const entry = await this.findPending(userId, entityType, entityId);
    if (!entry) {
      return { count: 0 };
    }
    const snapshot = entry.snapshot as unknown as DeletionSnapshot;
    await this.prisma.$transaction(async (tx) => {
      await this.replayRows(tx, snapshot.rows);
      await this.applyUpdates(tx, snapshot.updates ?? []);
      await this.restoreClearedCategories(tx, snapshot.categoriesCleared ?? []);
      await this.restoreClearedAccounts(tx, snapshot.accountsCleared ?? []);
      await afterReplay?.(tx, snapshot);
      await this.markRestored(tx, entry.id, now);
    });
    return { count: 1 };
  }

  private async applyUpdates(
    tx: Prisma.TransactionClient,
    updates: readonly UpdatedRow[],
  ): Promise<void> {
    for (const update of updates) {
      const delegate = tx[update.model] as unknown as {
        updateMany(args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<unknown>;
      };
      await delegate.updateMany({
        where: { id: update.id },
        data: update.values,
      });
    }
  }

  private async restoreClearedCategories(
    tx: Prisma.TransactionClient,
    cleared: readonly ClearedCategory[],
  ): Promise<void> {
    for (const link of cleared) {
      await tx.finTransaction.updateMany({
        where: { id: link.transactionId, categoryId: null },
        data: { categoryId: link.categoryId },
      });
    }
  }

  private async restoreClearedAccounts(
    tx: Prisma.TransactionClient,
    cleared: readonly ClearedAccountLink[],
  ): Promise<void> {
    for (const link of cleared) {
      const delegate = tx[link.model] as unknown as {
        updateMany(args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<unknown>;
      };
      await delegate.updateMany({
        where: { id: link.rowId, accountId: null },
        data: { accountId: link.accountId },
      });
    }
  }

  /**
   * Puts the stored rows back. The single cast here is the one place a delegate
   * is chosen by model name; every caller passes rows it wrote itself.
   */
  async replayRows(
    tx: Prisma.TransactionClient,
    rows: readonly DeletionRow[],
  ): Promise<void> {
    for (const row of rows) {
      const delegate = tx[row.model] as unknown as DeletableDelegate;
      await delegate.create({ data: row.values });
    }
  }
}
