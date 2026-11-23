import { BadRequestException, Injectable } from '@nestjs/common';
import { clampPageLimit } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
  type ClearedAccountLink,
} from '../../shared/domain/deletion-snapshot';
import { decodeCursorKeyPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { parseInstitutionOrderKey } from '../domain/institution-order';
import {
  cardSnapshotRows,
  listClearedAccountLinks,
  loanSnapshotRows,
  movementSnapshotRows,
  restoreCatalogLedger,
  type LedgerPurge,
} from './catalog-deletion';

/** Institutions: their rows, their cursor page and their deletion. */
@Injectable()
export class CatalogInstitutionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  findInstitutionsByUser(userId: string) {
    return this.prisma.finInstitution.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        type: true,
        shortName: true,
        domain: true,
        country: true,
        isActive: true,
        isSystem: true,
      },
    });
  }

  /** One query for many institutions, for the bulk entity lookup. */
  findInstitutionsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finInstitution.findMany({
      where: { id: { in: [...ids] }, userId },
    });
  }

  listInstitutions(userId: string, query: CursorQueryDto) {
    const after = decodeCursorKeyPosition(query.cursor);
    const position = after ? parseInstitutionOrderKey(after.key) : null;
    if (after && !position) {
      throw new BadRequestException('Cursor inválido');
    }
    return this.prisma.finInstitution.findMany({
      where: {
        userId,
        isActive: true,
        ...(position
          ? {
              OR: [
                { sortOrder: { gt: position.sortOrder } },
                {
                  sortOrder: position.sortOrder,
                  name: { gt: position.name },
                },
                {
                  sortOrder: position.sortOrder,
                  name: position.name,
                  id: { gt: after?.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: clampPageLimit(query.limit) + 1,
    });
  }

  createInstitution(
    userId: string,
    institutionData: Omit<Prisma.FinInstitutionUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finInstitution.create({
      data: { ...institutionData, userId },
    });
  }

  findInstitution(userId: string, id: string) {
    return this.prisma.finInstitution.findFirst({ where: { id, userId } });
  }

  updateInstitution(
    userId: string,
    id: string,
    institutionUpdate: Prisma.FinInstitutionUpdateInput,
  ) {
    return this.prisma.finInstitution
      .updateMany({ where: { userId, id }, data: institutionUpdate })
      .then(async (updateResult) => {
        if (updateResult.count === 0) {
          return null;
        }
        return this.prisma.finInstitution.findFirst({ where: { userId, id } });
      });
  }

  deleteInstitution({ userId, id, movements }: LedgerPurge) {
    return this.prisma.$transaction(async (tx) => {
      const institution = await tx.finInstitution.findFirst({
        where: { id, userId },
      });
      if (!institution) {
        return { count: 0 };
      }
      const accounts = await tx.finAccount.findMany({
        where: { userId, institutionId: id },
        select: { id: true },
      });
      const cards = await tx.finCard.findMany({
        where: { userId, institutionId: id },
        include: { balances: true, statements: true },
      });
      const loans = await tx.finLoan.findMany({
        where: { userId, institutionId: id },
        include: { installments: true },
      });
      const clearedLinks: ClearedAccountLink[] = [];
      for (const account of accounts) {
        clearedLinks.push(...(await listClearedAccountLinks(tx, account.id)));
      }
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.institution,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.institution,
              values: toDeletionValues(institution),
            },
            ...cardSnapshotRows(cards),
            ...loanSnapshotRows(loans),
            ...movementSnapshotRows(movements),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
          accountsCleared: clearedLinks,
        },
      });
      return tx.finInstitution.deleteMany({ where: { id, userId } });
    });
  }

  restoreInstitution(userId: string, id: string, now: Date) {
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.institution,
      entityId: id,
      now,
      afterReplay: (tx, snapshot) => restoreCatalogLedger(tx, userId, snapshot),
    });
  }
}
