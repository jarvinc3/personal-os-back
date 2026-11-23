import { Injectable } from '@nestjs/common';
import { clampPageLimit } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import { DELETION_ENTITY } from '../../shared/domain/deletion-snapshot';
import { PENDING_TRANSACTION_STATUS } from '../../shared/domain/transaction-status';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import {
  cardSnapshotRows,
  movementSnapshotRows,
  restoreCatalogLedger,
  type LedgerPurge,
} from './catalog-deletion';

/** Movements that already use the card's limit but are not confirmed yet. */
const PENDING_CARD_MOVEMENTS: Prisma.FinCard$transactionsArgs = {
  where: { status: PENDING_TRANSACTION_STATUS },
  select: {
    type: true,
    status: true,
    ledgerAmount: true,
    ledgerCurrency: true,
    transactionDate: true,
  },
};

/** Cards: their cursor page, their rows and their deletion. */
@Injectable()
export class CatalogCardRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  findEmailCardCandidates(userId: string, lastFour: string) {
    return this.prisma.finCard.findMany({
      where: { userId, lastFour, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        lastFour: true,
        institutionId: true,
        institution: {
          select: { id: true, name: true, domain: true },
        },
      },
    });
  }

  findEmailCardCandidatesByLastFours(
    userId: string,
    lastFours: readonly string[],
  ) {
    return this.prisma.finCard.findMany({
      where: {
        userId,
        lastFour: { in: [...lastFours] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        lastFour: true,
        institutionId: true,
        institution: {
          select: { id: true, name: true, domain: true },
        },
      },
    });
  }

  listCardsPage(userId: string, query: CursorQueryDto) {
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finCard.findMany({
      where: {
        userId,
        isActive: true,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.date } },
                { createdAt: after.date, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
        transactions: PENDING_CARD_MOVEMENTS,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: clampPageLimit(query.limit) + 1,
    });
  }

  listCards(userId: string) {
    return this.prisma.finCard.findMany({
      where: { userId, isActive: true },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
        transactions: PENDING_CARD_MOVEMENTS,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findCardById(userId: string, id: string) {
    return this.prisma.finCard.findFirst({
      where: { id, userId },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
        transactions: PENDING_CARD_MOVEMENTS,
      },
    });
  }

  /** One query for many cards, for the bulk entity lookup. */
  findCardsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finCard.findMany({
      where: { id: { in: [...ids] }, userId },
      include: {
        institution: true,
        account: { select: { id: true, name: true } },
        balances: true,
        transactions: PENDING_CARD_MOVEMENTS,
      },
    });
  }

  createCard(
    userId: string,
    cardInput: Omit<Prisma.FinCardUncheckedCreateInput, 'userId'>,
  ) {
    const payload = { ...cardInput };
    if (payload.type === 'CREDIT') {
      payload.accountId = null;
    }
    if (typeof payload.lastFour === 'string') {
      payload.lastFour = payload.lastFour.trim();
    }
    return this.prisma.finCard.create({
      data: { ...payload, userId },
      include: {
        institution: true,
        balances: true,
        account: { select: { id: true, name: true } },
        transactions: PENDING_CARD_MOVEMENTS,
      },
    });
  }

  updateCard(
    userId: string,
    id: string,
    cardUpdate: Prisma.FinCardUpdateInput,
  ) {
    return this.prisma.finCard
      .updateMany({ where: { id, userId }, data: cardUpdate })
      .then(async (updateResult) => {
        if (updateResult.count === 0) {
          return null;
        }
        return this.findCardById(userId, id);
      });
  }

  listCardsByInstitution(userId: string, institutionId: string) {
    return this.prisma.finCard.findMany({
      where: { userId, institutionId },
      select: { id: true },
    });
  }

  deleteCard({ userId, id, movements }: LedgerPurge) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({
        where: { id, userId },
        include: { balances: true, statements: true },
      });
      if (!card) {
        return { count: 0 };
      }
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.card,
        entityId: id,
        snapshot: {
          rows: [
            ...cardSnapshotRows([card]),
            ...movementSnapshotRows(movements),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
        },
      });
      return tx.finCard.deleteMany({ where: { id, userId } });
    });
  }

  restoreCard(userId: string, id: string, now: Date) {
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.card,
      entityId: id,
      now,
      afterReplay: (tx, snapshot) => restoreCatalogLedger(tx, userId, snapshot),
    });
  }
}
