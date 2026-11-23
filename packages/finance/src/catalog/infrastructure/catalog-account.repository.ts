import { Injectable } from '@nestjs/common';
import { clampPageLimit } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { decodeCursorKeyPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';
import {
  cardSnapshotRows,
  listClearedAccountLinks,
  loanSnapshotRows,
  movementSnapshotRows,
  restoreCatalogLedger,
  type LedgerPurge,
} from './catalog-deletion';

/** Encrypted account number plus the columns that work without decrypting. */
export type AccountNumberColumns = {
  accountNumber: string | null;
  accountNumberLast4: string | null;
  accountNumberHash: string | null;
};

/** Accounts: their rows, the savings earmarked in them and their deletion. */
@Injectable()
export class CatalogAccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  findAccountsByUser(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, isActive: true },
      orderBy: { name: 'asc' },
      include: { institutionRef: true },
    });
  }

  findAccountsPage(userId: string, query: CursorQueryDto) {
    const after = decodeCursorKeyPosition(query.cursor);
    return this.prisma.finAccount.findMany({
      where: {
        userId,
        isActive: true,
        ...(after
          ? {
              OR: [
                { name: { gt: after.key } },
                { name: after.key, id: { gt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { institutionRef: true },
      take: clampPageLimit(query.limit) + 1,
    });
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { id, userId },
      include: { institutionRef: true },
    });
  }

  findEmailAccountCandidates(userId: string, lastFour: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, accountNumberLast4: lastFour, isActive: true },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        accountNumberLast4: true,
        institutionId: true,
        institutionRef: {
          select: { id: true, name: true, domain: true },
        },
      },
    });
  }

  /** Una consulta para los sufijos de todas las propuestas del listado. */
  findEmailAccountCandidatesByLastFours(
    userId: string,
    lastFours: readonly string[],
  ) {
    return this.prisma.finAccount.findMany({
      where: {
        userId,
        accountNumberLast4: { in: [...lastFours] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        accountNumberLast4: true,
        institutionId: true,
        institutionRef: {
          select: { id: true, name: true, domain: true },
        },
      },
    });
  }

  /** One query for many accounts, for the bulk entity lookup. */
  findAccountsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finAccount.findMany({
      where: { id: { in: [...ids] }, userId },
      include: { institutionRef: true },
    });
  }

  async hasSavingsGoalMoney(accountId: string): Promise<boolean> {
    const goal = await this.prisma.finSavingsGoal.findFirst({
      where: { accountId, currentAmount: { gt: 0 } },
      select: { id: true },
    });
    return goal !== null;
  }

  async sumEarmarkedByAccountIds(
    userId: string,
    accountIds: string[],
  ): Promise<Map<string, number>> {
    if (accountIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.finSavingsGoalContribution.findMany({
      where: {
        goal: { userId, accountId: { in: accountIds }, mode: 'EARMARK' },
      },
      select: {
        amount: true,
        kind: true,
        goal: { select: { accountId: true } },
      },
    });
    const byAccount = new Map<string, number>();
    for (const row of rows) {
      const accountId = row.goal.accountId;
      if (!accountId) {
        continue;
      }
      const signed =
        row.kind === 'WITHDRAWAL' ? -Number(row.amount) : Number(row.amount);
      byAccount.set(accountId, (byAccount.get(accountId) ?? 0) + signed);
    }
    return byAccount;
  }

  createAccount(
    userId: string,
    dto: Omit<CreateAccountDto, 'accountNumber' | 'accountNumberLast4'> &
      AccountNumberColumns,
  ) {
    const accountInput: Prisma.FinAccountUncheckedCreateInput = {
      userId,
      name: dto.name,
      type: dto.type,
      currency: dto.currency ?? 'DOP',
      balance: 0,
      institutionId: dto.institutionId ?? null,
      accountNumber: dto.accountNumber,
      accountNumberLast4: dto.accountNumberLast4,
      accountNumberHash: dto.accountNumberHash,
      isDefaultForInstitution: dto.isDefaultForInstitution === true,
    };
    if (dto.color) {
      accountInput.color = dto.color;
    }
    return this.prisma.finAccount.create({
      data: accountInput,
      include: { institutionRef: true },
    });
  }

  updateAccount(
    id: string,
    userId: string,
    dto: Omit<UpdateAccountDto, 'accountNumber' | 'accountNumberLast4'> &
      Partial<AccountNumberColumns>,
  ) {
    return this.prisma.finAccount
      .updateMany({
        where: { id, userId },
        data: {
          institutionId: dto.institutionId,
          name: dto.name,
          type: dto.type,
          currency: dto.currency,
          color: dto.color,
          isActive: dto.isActive,
          accountNumber: dto.accountNumber,
          accountNumberLast4: dto.accountNumberLast4,
          accountNumberHash: dto.accountNumberHash,
          ...(dto.isDefaultForInstitution !== undefined
            ? { isDefaultForInstitution: dto.isDefaultForInstitution }
            : {}),
        },
      })
      .then(async (updateResult) => {
        if (updateResult.count === 0) {
          return null;
        }
        return this.findAccountById(id, userId);
      });
  }

  clearDefaultAccount(
    userId: string,
    institutionId: string,
    exceptId?: string,
  ) {
    return this.prisma.finAccount.updateMany({
      where: {
        userId,
        institutionId,
        isDefaultForInstitution: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isDefaultForInstitution: false },
    });
  }

  listAccountsByInstitution(userId: string, institutionId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, institutionId },
      select: { id: true },
    });
  }

  deleteAccount({ userId, id, movements }: LedgerPurge) {
    return this.prisma.$transaction(async (tx) => {
      const account = await tx.finAccount.findFirst({ where: { id, userId } });
      if (!account) {
        return { count: 0 };
      }
      const cards = await tx.finCard.findMany({
        where: { userId, accountId: id },
        include: { balances: true, statements: true },
      });
      const loans = await tx.finLoan.findMany({
        where: { userId, accountId: id },
        include: { installments: true },
      });
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.account,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.account,
              values: toDeletionValues(account),
            },
            ...cardSnapshotRows(cards),
            ...loanSnapshotRows(loans),
            ...movementSnapshotRows(movements),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
          accountsCleared: await listClearedAccountLinks(tx, id),
        },
      });
      await tx.finCard.deleteMany({ where: { userId, accountId: id } });
      return tx.finAccount.deleteMany({ where: { id, userId } });
    });
  }

  restoreAccount(userId: string, id: string, now: Date) {
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.account,
      entityId: id,
      now,
      afterReplay: (tx, snapshot) => restoreCatalogLedger(tx, userId, snapshot),
    });
  }
}
