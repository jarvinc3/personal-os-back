import { BadRequestException, Injectable } from '@nestjs/common';
import { clampPageLimit } from '@personal-os/core';
import type { CursorPoint } from '@personal-os/core';
import type { CursorQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { LedgerTransactionRow } from '../../ledger/application/ports/ledger.repository.port';
import { restoreLedgerRows } from '../../ledger/infrastructure/balance.helpers';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  reversedMovements,
  toDeletionValues,
  type ClearedAccountLink,
  type DeletionSnapshot,
} from '../../shared/domain/deletion-snapshot';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import {
  decodeCursorKeyPosition,
  decodeCursorPosition,
} from '../../shared/infrastructure/cursor-window';
import { parseInstitutionOrderKey } from '../domain/institution-order';
import { INSTRUMENT_EVENT_KIND } from '../../shared/domain/instrument-event';
import { PENDING_TRANSACTION_STATUS } from '../../shared/domain/transaction-status';
import {
  CASH_ACCOUNT_TYPE,
  CASH_INSTITUTION_NAME,
  CASH_INSTITUTION_TYPE,
} from '../../shared/domain/cash';
import { normalizeCurrencyCode } from '../../shared/presentation/validation.decorators';
import type { CreateAccountDto } from '../presentation/dto/create-account.dto';
import type { UpdateAccountDto } from '../presentation/dto/update-account.dto';

type LedgerPurge = {
  userId: string;
  id: string;
  movements: readonly LedgerTransactionRow[];
};

/** Encrypted account number plus the columns that work without decrypting. */
export type AccountNumberColumns = {
  accountNumber: string | null;
  accountNumberLast4: string | null;
  accountNumberHash: string | null;
};

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

@Injectable()
export class CatalogRepository {
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
    dto: Omit<CreateAccountDto, 'accountNumber'> & AccountNumberColumns,
  ) {
    const data: Prisma.FinAccountUncheckedCreateInput = {
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
      data.color = dto.color;
    }

    return this.prisma.finAccount.create({
      data,
      include: { institutionRef: true },
    });
  }

  updateAccount(
    id: string,
    userId: string,
    dto: Omit<UpdateAccountDto, 'accountNumber'> &
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
      .then(async (result) => {
        if (result.count === 0) {
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
    data: Omit<Prisma.FinInstitutionUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finInstitution.create({ data: { ...data, userId } });
  }

  findSystemCashInstitution(userId: string) {
    return this.prisma.finInstitution.findFirst({
      where: { userId, type: CASH_INSTITUTION_TYPE, isSystem: true },
    });
  }

  createSystemCashInstitution(userId: string) {
    return this.prisma.finInstitution.create({
      data: {
        userId,
        name: CASH_INSTITUTION_NAME,
        type: CASH_INSTITUTION_TYPE,
        country: 'DO',
        isSystem: true,
      },
    });
  }

  findFirstCashAccount(userId: string) {
    return this.prisma.finAccount.findFirst({
      where: { userId, type: CASH_ACCOUNT_TYPE },
      select: { id: true },
    });
  }

  createCashAccount(
    userId: string,
    input: { institutionId: string; name: string; currency: string },
  ) {
    return this.prisma.finAccount.create({
      data: {
        userId,
        institutionId: input.institutionId,
        name: input.name,
        type: CASH_ACCOUNT_TYPE,
        currency: input.currency,
      },
    });
  }

  assignInstitutionlessCashAccounts(userId: string, institutionId: string) {
    return this.prisma.finAccount.updateMany({
      where: { userId, type: CASH_ACCOUNT_TYPE, institutionId: null },
      data: { institutionId },
    });
  }

  updateInstitution(
    userId: string,
    id: string,
    data: Prisma.FinInstitutionUpdateInput,
  ) {
    return this.prisma.finInstitution
      .updateMany({ where: { userId, id }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.prisma.finInstitution.findFirst({ where: { userId, id } });
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

  /** Categories the user can see: their own plus the system ones. */
  findCategoriesByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finCategory.findMany({
      where: { id: { in: [...ids] }, OR: [{ userId }, { isSystem: true }] },
    });
  }

  createCard(
    userId: string,
    data: Omit<Prisma.FinCardUncheckedCreateInput, 'userId'>,
  ) {
    const payload = { ...data };
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

  updateCard(userId: string, id: string, data: Prisma.FinCardUpdateInput) {
    return this.prisma.finCard
      .updateMany({ where: { id, userId }, data })
      .then(async (result) => {
        if (result.count === 0) {
          return null;
        }
        return this.findCardById(userId, id);
      });
  }

  upsertCardBalance(
    userId: string,
    cardId: string,
    currency: string,
    balance: number,
    creditLimit?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({
        where: { id: cardId, userId },
      });
      if (!card) {
        return null;
      }
      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        if (creditLimit !== undefined) {
          await this.recordCreditLimitChange(tx, {
            userId,
            cardId,
            currency: normalizedCurrency,
            previousLimit: existing.creditLimit,
            nextLimit: creditLimit,
          });
        }
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: {
            balance,
            ...(creditLimit !== undefined ? { creditLimit } : {}),
          },
        });
      }
      if (creditLimit !== undefined) {
        await this.recordCreditLimitChange(tx, {
          userId,
          cardId,
          currency: normalizedCurrency,
          previousLimit: null,
          nextLimit: creditLimit,
        });
      }
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance,
          ...(creditLimit !== undefined ? { creditLimit } : {}),
        },
      });
    });
  }

  setCardCreditLimit(
    userId: string,
    cardId: string,
    currency: string,
    creditLimit: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const card = await tx.finCard.findFirst({
        where: { id: cardId, userId },
      });
      if (!card) {
        return null;
      }
      const normalizedCurrency = String(normalizeCurrencyCode(currency));
      const existing = await tx.finCardBalance.findFirst({
        where: { cardId, currency: normalizedCurrency },
      });
      if (existing) {
        await this.recordCreditLimitChange(tx, {
          userId,
          cardId,
          currency: normalizedCurrency,
          previousLimit: existing.creditLimit,
          nextLimit: creditLimit,
        });
        return tx.finCardBalance.update({
          where: { id: existing.id },
          data: { creditLimit },
        });
      }
      await this.recordCreditLimitChange(tx, {
        userId,
        cardId,
        currency: normalizedCurrency,
        previousLimit: null,
        nextLimit: creditLimit,
      });
      return tx.finCardBalance.create({
        data: {
          cardId,
          currency: normalizedCurrency,
          balance: 0,
          creditLimit,
        },
      });
    });
  }

  findInstrumentEvents(
    userId: string,
    target: { accountId?: string; cardId?: string },
    page: { cursor: CursorPoint | null; take: number },
  ) {
    return this.prisma.finInstrumentEvent.findMany({
      where: {
        userId,
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.cardId ? { cardId: target.cardId } : {}),
        ...(page.cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(page.cursor.key) } },
                {
                  createdAt: new Date(page.cursor.key),
                  id: { lt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }

  findAdjustmentTransactions(
    userId: string,
    target: { accountId?: string; cardId?: string },
    page: { cursor: CursorPoint | null; take: number },
  ) {
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        type: 'ADJUSTMENT',
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.cardId ? { cardId: target.cardId } : {}),
        ...(page.cursor
          ? {
              OR: [
                { transactionDate: { lt: new Date(page.cursor.key) } },
                {
                  transactionDate: new Date(page.cursor.key),
                  id: { lt: page.cursor.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
  }

  private async recordCreditLimitChange(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      cardId: string;
      currency: string;
      previousLimit: unknown;
      nextLimit: number;
    },
  ): Promise<void> {
    const previousLimit =
      input.previousLimit === null || input.previousLimit === undefined
        ? null
        : Number(input.previousLimit);
    if (previousLimit !== null && previousLimit === input.nextLimit) {
      return;
    }
    await tx.finInstrumentEvent.create({
      data: {
        userId: input.userId,
        cardId: input.cardId,
        kind: INSTRUMENT_EVENT_KIND.CREDIT_LIMIT_CHANGED,
        payload: {
          currency: input.currency,
          previousLimit,
          nextLimit: input.nextLimit,
        },
      },
    });
  }

  deleteCardBalance(userId: string, cardId: string, currency: string) {
    return this.prisma.finCardBalance.deleteMany({
      where: {
        cardId,
        currency: String(normalizeCurrencyCode(currency)),
        card: { userId },
      },
    });
  }

  listCategories(userId: string, type?: 'EXPENSE' | 'INCOME') {
    return this.prisma.finCategory.findMany({
      where: {
        OR: [{ userId }, { isSystem: true }],
        ...(type ? { type } : {}),
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
  }

  createCategory(userId: string, data: Prisma.FinCategoryUncheckedCreateInput) {
    return this.prisma.finCategory.create({
      data: { ...data, userId, isSystem: false },
    });
  }

  updateCategory(
    userId: string,
    id: string,
    data: Prisma.FinCategoryUncheckedUpdateInput,
    cascadeTypeToChildren?: 'EXPENSE' | 'INCOME',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.finCategory.updateMany({
        where: { id, userId, isSystem: false },
        data,
      });
      if (result.count === 0) {
        return null;
      }
      if (cascadeTypeToChildren) {
        await tx.finCategory.updateMany({
          where: { parentId: id, userId },
          data: { type: cascadeTypeToChildren },
        });
      }
      return tx.finCategory.findFirst({ where: { id, userId } });
    });
  }

  deleteCategory(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.finCategory.findFirst({
        where: { id, userId, isSystem: false },
      });
      if (!category) {
        return { count: 0 };
      }
      const children = await tx.finCategory.findMany({
        where: { userId, parentId: id },
      });
      const categoryIds = [id, ...children.map((child) => child.id)];
      const budgets = await tx.finBudget.findMany({
        where: { userId, categoryId: { in: categoryIds } },
        include: { alerts: true },
      });
      const cleared = await tx.finTransaction.findMany({
        where: { userId, categoryId: { in: categoryIds } },
        select: { id: true, categoryId: true },
      });
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.category,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.category,
              values: toDeletionValues(category),
            },
            ...children.map((child) => ({
              model: DELETION_MODEL.category,
              values: toDeletionValues(child),
            })),
            ...budgets.map((budget) => ({
              model: DELETION_MODEL.budget,
              values: toDeletionValues({ ...budget, alerts: undefined }),
            })),
            ...budgets.flatMap((budget) =>
              budget.alerts.map((alert) => ({
                model: DELETION_MODEL.budgetAlert,
                values: toDeletionValues(alert),
              })),
            ),
          ],
          categoriesCleared: cleared.map((row) => ({
            transactionId: row.id,
            categoryId: row.categoryId as string,
          })),
        },
      });
      await tx.finTransaction.updateMany({
        where: { userId, categoryId: { in: categoryIds } },
        data: { categoryId: null },
      });
      return tx.finCategory.deleteMany({
        where: { id: { in: categoryIds }, userId, isSystem: false },
      });
    });
  }

  restoreCategory(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.category, id, now);
  }

  findInstitution(userId: string, id: string) {
    return this.prisma.finInstitution.findFirst({ where: { id, userId } });
  }

  listAccountsByInstitution(userId: string, institutionId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, institutionId },
      select: { id: true },
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
            {
              model: DELETION_MODEL.card,
              values: toDeletionValues({
                ...card,
                balances: undefined,
                statements: undefined,
              }),
            },
            ...card.balances.map((balance) => ({
              model: DELETION_MODEL.cardBalance,
              values: toDeletionValues(balance),
            })),
            ...card.statements.map((statement) => ({
              model: DELETION_MODEL.cardStatement,
              values: toDeletionValues(statement),
            })),
            ...movements.map((movement) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(movement),
            })),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
        },
      });
      return tx.finCard.deleteMany({ where: { id, userId } });
    });
  }

  restoreCard(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.card,
      id,
      now,
      (tx, snapshot) => this.restoreLedgerWithin(tx, userId, snapshot),
    );
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
            ...cards.map((card) => ({
              model: DELETION_MODEL.card,
              values: toDeletionValues({
                ...card,
                balances: undefined,
                statements: undefined,
              }),
            })),
            ...cards.flatMap((card) =>
              card.balances.map((balance) => ({
                model: DELETION_MODEL.cardBalance,
                values: toDeletionValues(balance),
              })),
            ),
            ...cards.flatMap((card) =>
              card.statements.map((statement) => ({
                model: DELETION_MODEL.cardStatement,
                values: toDeletionValues(statement),
              })),
            ),
            ...loans.map((loan) => ({
              model: DELETION_MODEL.loan,
              values: toDeletionValues({ ...loan, installments: undefined }),
            })),
            ...loans.flatMap((loan) =>
              loan.installments.map((installment) => ({
                model: DELETION_MODEL.loanInstallment,
                values: toDeletionValues(installment),
              })),
            ),
            ...movements.map((movement) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(movement),
            })),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
          accountsCleared: await this.listClearedAccountLinks(tx, id),
        },
      });
      await tx.finCard.deleteMany({ where: { userId, accountId: id } });
      return tx.finAccount.deleteMany({ where: { id, userId } });
    });
  }

  restoreAccount(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.account,
      id,
      now,
      (tx, snapshot) => this.restoreLedgerWithin(tx, userId, snapshot),
    );
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
      const emailSources = await tx.finEmailSource.findMany({
        where: { userId, institutionId: id },
      });
      const clearedLinks: ClearedAccountLink[] = [];
      for (const account of accounts) {
        clearedLinks.push(
          ...(await this.listClearedAccountLinks(tx, account.id)),
        );
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
            ...cards.map((card) => ({
              model: DELETION_MODEL.card,
              values: toDeletionValues({
                ...card,
                balances: undefined,
                statements: undefined,
              }),
            })),
            ...cards.flatMap((card) =>
              card.balances.map((balance) => ({
                model: DELETION_MODEL.cardBalance,
                values: toDeletionValues(balance),
              })),
            ),
            ...cards.flatMap((card) =>
              card.statements.map((statement) => ({
                model: DELETION_MODEL.cardStatement,
                values: toDeletionValues(statement),
              })),
            ),
            ...loans.map((loan) => ({
              model: DELETION_MODEL.loan,
              values: toDeletionValues({ ...loan, installments: undefined }),
            })),
            ...loans.flatMap((loan) =>
              loan.installments.map((installment) => ({
                model: DELETION_MODEL.loanInstallment,
                values: toDeletionValues(installment),
              })),
            ),
            ...emailSources.map((source) => ({
              model: DELETION_MODEL.emailSource,
              values: toDeletionValues(source),
            })),
            ...movements.map((movement) => ({
              model: DELETION_MODEL.transaction,
              values: toDeletionValues(movement),
            })),
          ],
          ledgerReversed: movements.map((movement) => movement.id),
          accountsCleared: clearedLinks,
        },
      });
      return tx.finInstitution.deleteMany({ where: { id, userId } });
    });
  }

  restoreInstitution(userId: string, id: string, now: Date) {
    return this.journal.restore(
      userId,
      DELETION_ENTITY.institution,
      id,
      now,
      (tx, snapshot) => this.restoreLedgerWithin(tx, userId, snapshot),
    );
  }

  private restoreLedgerWithin(
    tx: Prisma.TransactionClient,
    userId: string,
    snapshot: DeletionSnapshot,
  ) {
    return restoreLedgerRows(tx, userId, reversedMovements(snapshot));
  }

  private async listClearedAccountLinks(
    tx: Prisma.TransactionClient,
    accountId: string,
  ): Promise<ClearedAccountLink[]> {
    const payments = await tx.finReceivablePayment.findMany({
      where: { accountId },
      select: { id: true },
    });
    const contributions = await tx.finSavingsGoalContribution.findMany({
      where: { accountId },
      select: { id: true },
    });
    return [
      ...payments.map((row) => ({
        model: DELETION_MODEL.receivablePayment,
        rowId: row.id,
        accountId,
      })),
      ...contributions.map((row) => ({
        model: DELETION_MODEL.savingsGoalContribution,
        rowId: row.id,
        accountId,
      })),
    ];
  }
}
