import { Injectable } from '@nestjs/common';
import { clampPageLimit, type CursorQueryDto } from '@personal-os/core';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { ReceivableStatus } from '../application/resolve-receivable-payment';
import {
  DELETION_ENTITY,
  DELETION_MODEL,
  toDeletionValues,
} from '../../shared/domain/deletion-snapshot';
import { decodeCursorPosition } from '../../shared/infrastructure/cursor-window';
import { DeletionJournalRepository } from '../../shared/infrastructure/deletion-journal.repository';
import { applyReceivableBalance } from './receivable-balance';
import { OPENING_BALANCE_NOTE } from './planning-opening-balance';

/** Money a user is owed, with its payments, credit and deletion journal. */
@Injectable()
export class PlanningReceivableRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: DeletionJournalRepository,
  ) {}

  listReceivables(userId: string) {
    return this.prisma.finReceivable.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  listReceivablesPage(userId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finReceivable.findMany({
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

  findReceivable(userId: string, id: string) {
    return this.prisma.finReceivable.findFirst({ where: { id, userId } });
  }

  findReceivablesByIds(userId: string, ids: readonly string[]) {
    return this.prisma.finReceivable.findMany({
      where: { id: { in: [...ids] }, userId },
    });
  }

  createReceivable(
    userId: string,
    input: {
      data: Omit<
        Prisma.FinReceivableUncheckedCreateInput,
        'userId' | 'paidAmount'
      >;
      openingAmount: number;
      requestedStatus: ReceivableStatus | undefined;
    },
  ) {
    const { data, openingAmount, requestedStatus } = input;
    return this.prisma.$transaction(async (tx) => {
      const receivable = await tx.finReceivable.create({
        data: { ...data, userId },
      });
      if (openingAmount > 0) {
        await tx.finReceivablePayment.create({
          data: {
            receivableId: receivable.id,
            amount: openingAmount,
            appliedAmount: openingAmount,
            paidAt: receivable.createdAt,
            notes: OPENING_BALANCE_NOTE,
          },
        });
      }
      await applyReceivableBalance(tx, receivable.id, requestedStatus);
      return tx.finReceivable.findUniqueOrThrow({
        where: { id: receivable.id },
      });
    });
  }

  deleteReceivable(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const receivable = await tx.finReceivable.findFirst({
        where: { id, userId },
        include: { payments: true },
      });
      if (!receivable) {
        return { count: 0 };
      }
      const { payments, ...receivableRow } = receivable;
      await this.journal.record(tx, {
        userId,
        entityType: DELETION_ENTITY.receivable,
        entityId: id,
        snapshot: {
          rows: [
            {
              model: DELETION_MODEL.receivable,
              values: toDeletionValues(receivableRow),
            },
            ...payments.map((payment) => ({
              model: DELETION_MODEL.receivablePayment,
              values: toDeletionValues(payment),
            })),
          ],
        },
      });
      return tx.finReceivable.deleteMany({ where: { id, userId } });
    });
  }

  restoreReceivable(userId: string, id: string, now: Date) {
    return this.journal.restore({
      userId,
      entityType: DELETION_ENTITY.receivable,
      entityId: id,
      now,
    });
  }

  async updateReceivable(
    userId: string,
    id: string,
    input: {
      data: Prisma.FinReceivableUncheckedUpdateManyInput;
      requestedStatus: ReceivableStatus | undefined;
    },
  ): Promise<void> {
    const { data, requestedStatus } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.finReceivable.updateMany({ where: { id, userId }, data });
      await applyReceivableBalance(tx, id, requestedStatus);
    });
  }

  listReceivablePayments(receivableId: string, query: CursorQueryDto) {
    const limit = clampPageLimit(query.limit);
    const after = decodeCursorPosition(query.cursor);
    return this.prisma.finReceivablePayment.findMany({
      where: {
        receivableId,
        ...(after
          ? {
              OR: [
                { paidAt: { lt: after.date } },
                { paidAt: after.date, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      include: { account: { select: { id: true, name: true } } },
      take: limit + 1,
    });
  }

  findReceivablePayment(receivableId: string, paymentId: string) {
    return this.prisma.finReceivablePayment.findFirst({
      where: { id: paymentId, receivableId },
    });
  }

  findReceivablePaymentByTransactionId(userId: string, transactionId: string) {
    return this.prisma.finReceivablePayment.findFirst({
      where: { transactionId, receivable: { userId } },
    });
  }

  createReceivablePayment(
    receivableId: string,
    payment: {
      amount: number;
      appliedAmount: number;
      excessAmount: number;
      excessHandling?: string | null;
      paidAt: Date;
      accountId: string;
      transactionId: string | null;
      notes?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.finReceivablePayment.create({
        data: { receivableId, ...payment },
      });
      await applyReceivableBalance(tx, receivableId);
      return created;
    });
  }

  async deleteReceivablePayment(receivableId: string, paymentId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.finReceivablePayment.deleteMany({
        where: { id: paymentId, receivableId },
      });
      await applyReceivableBalance(tx, receivableId);
    });
  }

  findExtraIncomeCategoryId() {
    return this.prisma.finCategory
      .findFirst({
        where: { isSystem: true, systemKind: 'EXTRA_INCOME', type: 'INCOME' },
        select: { id: true },
      })
      .then((category) => category?.id ?? null);
  }

  async addReceivableCreditBalance(
    receivableId: string,
    amount: number,
  ): Promise<void> {
    await this.prisma.finReceivable.update({
      where: { id: receivableId },
      data: { creditBalance: { increment: amount } },
    });
  }

  /** Moves part of the credit balance to another open receivable. */
  async applyReceivableCredit(input: {
    sourceReceivableId: string;
    targetReceivableId: string;
    amount: number;
    paidAt: Date;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.finReceivable.update({
        where: { id: input.sourceReceivableId },
        data: { creditBalance: { decrement: input.amount } },
      });
      await tx.finReceivablePayment.create({
        data: {
          receivableId: input.targetReceivableId,
          amount: input.amount,
          appliedAmount: input.amount,
          excessAmount: 0,
          paidAt: input.paidAt,
          transactionId: null,
        },
      });
      await applyReceivableBalance(tx, input.targetReceivableId);
    });
  }

  async writeOffReceivable(
    receivableId: string,
    input: { writtenOffAmount: number; writtenOffAt: Date },
  ): Promise<void> {
    await this.prisma.finReceivable.update({
      where: { id: receivableId },
      data: {
        status: 'WRITTEN_OFF',
        writtenOffAmount: input.writtenOffAmount,
        writtenOffAt: input.writtenOffAt,
      },
    });
  }
}
