import { ConflictException, Injectable } from '@nestjs/common';
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
import {
  DELETION_MODEL,
  PARTIAL_OPERATION,
  PARTIAL_OPERATION_MESSAGE,
  RESTORE_CONFLICT,
  RESTORE_CONFLICT_MESSAGE,
  type RestoreResult,
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

const RETENTION_DAYS = 30;

@Injectable()
export class DeletionJournalRepository {
  constructor(private readonly prisma: PrismaService) {}

  record(tx: Prisma.TransactionClient, entry: DeletionEntry) {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    return tx.finDeletionJournal.create({
      data: {
        userId: entry.userId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        snapshot: entry.snapshot as unknown as Prisma.InputJsonValue,
        operationGroupId: operationGroupIdFromSnapshot(entry.snapshot),
        sizeBytes: Buffer.byteLength(JSON.stringify(entry.snapshot), 'utf8'),
        expiresAt,
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
        sizeBytes: true,
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

  /** Drops the entries past their retention window. */
  purgeExpired(now: Date) {
    return this.prisma.finDeletionJournal.deleteMany({
      where: { expiresAt: { lte: now } },
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
  ): Promise<RestoreResult> {
    const entry = await this.findPending(userId, entityType, entityId);
    if (!entry) {
      const alreadyRestored = await this.prisma.finDeletionJournal.findFirst({
        where: { userId, entityType, entityId, restoredAt: { not: null } },
        select: { id: true },
      });
      return { count: 0, alreadyRestored: Boolean(alreadyRestored) };
    }
    const snapshot = entry.snapshot as unknown as DeletionSnapshot;
    assertCompleteOperation(entry.operationGroupId, snapshot);
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.replayRows(tx, snapshot.rows);
        await this.applyUpdates(tx, snapshot.updates ?? []);
        await this.restoreClearedCategories(
          tx,
          snapshot.categoriesCleared ?? [],
        );
        await this.restoreClearedAccounts(tx, snapshot.accountsCleared ?? []);
        await afterReplay?.(tx, snapshot);
        await this.markRestored(tx, entry.id, now);
      });
    } catch (error) {
      const prismaError = error as { code?: string; meta?: unknown };
      if (prismaError.code === 'P2002') {
        throw new ConflictException({
          code: RESTORE_CONFLICT,
          message: RESTORE_CONFLICT_MESSAGE,
          details: { target: prismaError.meta ?? null },
        });
      }
      throw error;
    }
    return { count: 1, alreadyRestored: false };
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

function operationGroupIdFromSnapshot(
  snapshot: DeletionSnapshot,
): string | null {
  for (const row of snapshot.rows) {
    if (row.model !== DELETION_MODEL.transaction) {
      continue;
    }
    const group = row.values.transferGroupId;
    if (typeof group === 'string' && group) {
      return group;
    }
  }
  return null;
}

/** A grouped operation must be restored with every leg the delete took. */
function assertCompleteOperation(
  operationGroupId: string | null,
  snapshot: DeletionSnapshot,
): void {
  if (!operationGroupId) {
    return;
  }
  const legs = snapshot.rows.filter(
    (row) =>
      row.model === DELETION_MODEL.transaction &&
      row.values.transferGroupId === operationGroupId,
  );
  if (legs.length < 2) {
    throw new ConflictException({
      code: PARTIAL_OPERATION,
      message: PARTIAL_OPERATION_MESSAGE,
    });
  }
}
