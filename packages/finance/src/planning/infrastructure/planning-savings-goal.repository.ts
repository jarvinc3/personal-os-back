import { Injectable } from '@nestjs/common';
import { clampPageLimit, type CursorQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { OPENING_BALANCE_NOTE } from '../../shared/domain/opening-balance';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { applySavingsGoalBalance } from './savings-goal-balance';

type SavingsGoalCreate = {
  userId: string;
  data: Omit<
    Prisma.FinSavingsGoalUncheckedCreateInput,
    'userId' | 'currentAmount'
  >;
  openingAmount: number;
  now: Date;
};

type SavingsGoalUpdate = {
  userId: string;
  id: string;
  data: Prisma.FinSavingsGoalUncheckedUpdateManyInput;
  now: Date;
};

/** Savings goals: their cursor page, their contributions and their balance. */
@Injectable()
export class PlanningSavingsGoalRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  listSavingsGoals(userId: string) {
    return this.prisma.finSavingsGoal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listSavingsGoalsPage(userId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finSavingsGoal.findMany({
      where: {
        userId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.date } },
                { createdAt: after.date, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  /** Timezone the goal's allocation resolves its local day with. */
  async findUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? null;
  }

  findSavingsGoal(userId: string, id: string) {
    return this.prisma.finSavingsGoal.findFirst({ where: { id, userId } });
  }

  findSavingsGoalsByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finSavingsGoal.findMany({
      where: { id: { in: [...ids] }, userId },
    });
  }

  async createSavingsGoal({
    userId,
    data,
    openingAmount,
    now,
  }: SavingsGoalCreate) {
    return this.prisma.$transaction(async (tx) => {
      const goal = await tx.finSavingsGoal.create({
        data: { ...data, userId },
      });
      if (openingAmount > 0) {
        await tx.finSavingsGoalContribution.create({
          data: {
            goalId: goal.id,
            amount: openingAmount,
            contributedAt: goal.createdAt,
            notes: OPENING_BALANCE_NOTE,
          },
        });
      }
      await applySavingsGoalBalance(tx, goal.id, now);
      return this.readSavingsGoal(tx, goal.id);
    });
  }

  async updateSavingsGoal({
    userId,
    id,
    data,
    now,
  }: SavingsGoalUpdate): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finSavingsGoal.updateMany({ where: { id, userId }, data });
      await applySavingsGoalBalance(tx, id, now);
    });
  }

  deleteSavingsGoal(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const goal = await tx.finSavingsGoal.findFirst({
        where: { id, userId },
        include: { contributions: true },
      });
      if (!goal) {
        return { count: 0 };
      }
      const { contributions, ...goalRow } = goal;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.savingsGoal,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.savingsGoal,
              values: toDeletionValues(goalRow),
            },
            ...contributions.map((contribution) => ({
              model: DELETION_MODEL.savingsGoalContribution,
              values: toDeletionValues(contribution),
            })),
          ],
        },
      });
      return tx.finSavingsGoal.deleteMany({ where: { id, userId } });
    });
  }

  restoreSavingsGoal(userId: string, id: string, now: Date) {
    return this.journal.restore(userId, DELETION_ENTITY.savingsGoal, id, now);
  }

  listSavingsGoalContributions(goalId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finSavingsGoalContribution.findMany({
      where: {
        goalId,
        ...(after
          ? {
              OR: [
                { contributedAt: { lt: after.date } },
                { contributedAt: after.date, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ contributedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  findSavingsGoalContribution(goalId: string, contributionId: string) {
    return this.prisma.finSavingsGoalContribution.findFirst({
      where: { id: contributionId, goalId },
    });
  }

  async addSavingsGoalContribution(
    goalId: string,
    contribution: {
      amount: number;
      contributedAt: Date;
      kind: 'CONTRIBUTION' | 'WITHDRAWAL';
      accountId?: string | null;
      destinationAccountId?: string | null;
      transactionId?: string | null;
      transferGroupId?: string | null;
      notes?: string;
    },
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.finSavingsGoalContribution.create({
        data: { goalId, ...contribution },
      });
      await applySavingsGoalBalance(tx, goalId, now);
      return created;
    });
  }

  /** Amount already earmarked in every EARMARK goal of one account. */
  async sumEarmarkedByAccount(
    userId: string,
    accountId: string,
  ): Promise<number> {
    const goals = await this.prisma.finSavingsGoal.findMany({
      where: { userId, accountId, mode: 'EARMARK' },
      select: { id: true },
    });
    if (goals.length === 0) {
      return 0;
    }
    const rows = await this.prisma.finSavingsGoalContribution.findMany({
      where: { goalId: { in: goals.map((goal) => goal.id) } },
      select: { amount: true, kind: true },
    });
    return rows.reduce(
      (sum, row) =>
        sum +
        (row.kind === 'WITHDRAWAL' ? -Number(row.amount) : Number(row.amount)),
      0,
    );
  }

  async removeSavingsGoalContribution(
    goalId: string,
    contributionId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finSavingsGoalContribution.deleteMany({
        where: { id: contributionId, goalId },
      });
      await applySavingsGoalBalance(tx, goalId, now);
    });
  }

  findSavingsGoalContributionByTransactionId(
    userId: string,
    transactionId: string,
  ) {
    return this.prisma.finSavingsGoalContribution.findFirst({
      where: { transactionId, goal: { userId } },
    });
  }

  private readSavingsGoal(tx: Prisma.TransactionClient, goalId: string) {
    return tx.finSavingsGoal.findUniqueOrThrow({ where: { id: goalId } });
  }
}
