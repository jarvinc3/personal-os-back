import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class EmailSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listEmailSources(userId: string) {
    return this.prisma.finEmailSource.findMany({
      where: { userId },
      include: { logs: { orderBy: { startedAt: 'desc' }, take: 5 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findEmailSource(userId: string, id: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, id },
      include: { logs: { orderBy: { startedAt: 'desc' }, take: 10 } },
    });
  }

  createEmailSource(
    userId: string,
    data: Omit<Prisma.FinEmailSourceUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finEmailSource.create({ data: { ...data, userId } });
  }

  updateEmailSource(
    userId: string,
    id: string,
    data: Prisma.FinEmailSourceUncheckedUpdateInput,
  ) {
    return this.prisma.finEmailSource
      .updateMany({ where: { userId, id }, data })
      .then(async (result) => {
        if (result.count === 0) return null;
        return this.prisma.finEmailSource.findFirst({
          where: { userId, id },
          include: { logs: { orderBy: { startedAt: 'desc' }, take: 5 } },
        });
      });
  }

  createEmailSyncLog(sourceId: string) {
    return this.prisma.finEmailSyncLog.create({
      data: {
        sourceId,
        startedAt: new Date(),
        status: 'RUNNING',
      },
    });
  }

  async completeEmailSyncSuccessWithOutbox(
    id: string,
    data: {
      status: 'SUCCESS';
      emailsScanned: number;
      transactionsNew: number;
    },
    outbox: {
      eventId: string;
      eventName: string;
      aggregateType: string;
      aggregateId: string;
      userId: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.finEmailSyncLog.update({
        where: { id },
        data: {
          status: data.status,
          emailsScanned: data.emailsScanned,
          transactionsNew: data.transactionsNew,
          completedAt: new Date(),
          error: null,
        },
      });
      await tx.domainEventOutbox.create({
        data: {
          eventId: outbox.eventId,
          eventName: outbox.eventName,
          aggregateType: outbox.aggregateType,
          aggregateId: outbox.aggregateId,
          userId: outbox.userId,
          payload: outbox.payload,
        },
      });
    });
  }

  completeEmailSyncLog(
    id: string,
    data: {
      status: 'SUCCESS' | 'FAILED';
      emailsScanned: number;
      transactionsNew: number;
      error?: string;
    },
  ) {
    return this.prisma.finEmailSyncLog.update({
      where: { id },
      data: {
        status: data.status,
        emailsScanned: data.emailsScanned,
        transactionsNew: data.transactionsNew,
        completedAt: new Date(),
        error: data.error,
      },
    });
  }

  findEmailSourceForRefresh(sourceId: string) {
    return this.prisma.finEmailSource.findUnique({
      where: { id: sourceId },
      select: {
        id: true,
        userId: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiresAt: true,
        bankDomain: true,
        accountId: true,
        cardId: true,
        lastMessageId: true,
        lastSyncedAt: true,
        isActive: true,
      },
    });
  }

  updateEmailSourceTokens(
    sourceId: string,
    data: {
      accessToken: string;
      refreshToken: string;
      tokenExpiresAt: Date;
      emailAddress?: string;
      accountId?: string | null;
      cardId?: string | null;
    },
  ) {
    return this.prisma.finEmailSource.update({
      where: { id: sourceId },
      data: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        ...(data.emailAddress ? { emailAddress: data.emailAddress } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId } : {}),
        ...(data.cardId !== undefined ? { cardId: data.cardId } : {}),
      },
    });
  }

  findEmailSourceByUserEmailAndDomain(
    userId: string,
    emailAddress: string,
    bankDomain: string,
  ) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, emailAddress, bankDomain },
    });
  }

  listCategories(userId: string) {
    return this.prisma.finCategory.findMany({
      where: { OR: [{ userId }, { isSystem: true }] },
    });
  }

  findAccountById(id: string, userId: string) {
    return this.prisma.finAccount.findFirst({ where: { id, userId } });
  }

  findCardById(userId: string, id: string) {
    return this.prisma.finCard.findFirst({ where: { id, userId } });
  }
}
