import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../prisma/generated/client';
import { PrismaService } from '../../../../prisma/prisma.service';

const sourceListInclude = {
  connection: {
    select: {
      id: true,
      emailAddress: true,
      provider: true,
      isActive: true,
    },
  },
  institution: {
    select: { id: true, name: true, isActive: true },
  },
  logs: { orderBy: { startedAt: 'desc' as const }, take: 5 },
} satisfies Prisma.FinEmailSourceInclude;

const pendingMessageInclude = {
  source: {
    include: {
      connection: {
        select: { id: true, emailAddress: true, provider: true },
      },
      institution: {
        select: { id: true, name: true, isActive: true },
      },
    },
  },
  transaction: { select: { id: true } },
} satisfies Prisma.FinEmailMessageInclude;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type UpsertEmailMessageInput = {
  sourceId: string;
  gmailMessageId: string;
  outcome:
    | 'IMPORTED'
    | 'SKIPPED_NOT_TX'
    | 'FAILED_NON_RETRYABLE'
    | 'PENDING_ASSIGNMENT';
  reason?: string | null;
  provider?: string | null;
  model?: string | null;
  instrumentHint?: string | null;
  lastFourHint?: string | null;
  extractedPayload?: unknown;
};

@Injectable()
export class EmailSourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listEmailSources(userId: string) {
    return this.prisma.finEmailSource.findMany({
      where: { userId },
      include: sourceListInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  findEmailSource(userId: string, id: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, id },
      include: {
        ...sourceListInclude,
        logs: { orderBy: { startedAt: 'desc' }, take: 10 },
      },
    });
  }

  createEmailSource(
    userId: string,
    data: Omit<Prisma.FinEmailSourceUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finEmailSource.create({
      data: { ...data, userId },
      include: sourceListInclude,
    });
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
        return this.findEmailSource(userId, id);
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
        isActive: true,
        connection: {
          select: {
            id: true,
            accessToken: true,
            refreshToken: true,
            tokenExpiresAt: true,
          },
        },
      },
    });
  }

  findConnectionByUserEmail(
    userId: string,
    provider: string,
    emailAddress: string,
  ) {
    return this.prisma.finEmailConnection.findUnique({
      where: {
        userId_provider_emailAddress: { userId, provider, emailAddress },
      },
    });
  }

  createConnection(
    userId: string,
    data: Omit<Prisma.FinEmailConnectionUncheckedCreateInput, 'userId'>,
  ) {
    return this.prisma.finEmailConnection.create({
      data: { ...data, userId },
    });
  }

  updateConnectionTokens(
    connectionId: string,
    data: {
      accessToken: string;
      refreshToken: string;
      tokenExpiresAt: Date;
      emailAddress?: string;
      isActive?: boolean;
    },
  ) {
    return this.prisma.finEmailConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        tokenExpiresAt: data.tokenExpiresAt,
        ...(data.emailAddress ? { emailAddress: data.emailAddress } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });
  }

  findSourceByConnectionAndInstitution(
    userId: string,
    connectionId: string,
    institutionId: string,
  ) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, connectionId, institutionId },
      include: sourceListInclude,
    });
  }

  listInstitutionDestinations(userId: string, institutionId: string) {
    return Promise.all([
      this.prisma.finAccount.findMany({
        where: { userId, institutionId, isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.finCard.findMany({
        where: { userId, institutionId, isActive: true },
        select: { id: true, lastFour: true, type: true, name: true },
      }),
    ]);
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

  listPendingAssignmentMessages(userId: string) {
    return this.prisma.finEmailMessage.findMany({
      where: {
        outcome: 'PENDING_ASSIGNMENT',
        source: { userId },
      },
      include: pendingMessageInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  findEmailMessageById(userId: string, id: string) {
    return this.prisma.finEmailMessage.findFirst({
      where: { id, source: { userId } },
      include: pendingMessageInclude,
    });
  }

  findEmailMessage(sourceId: string, gmailMessageId: string) {
    return this.prisma.finEmailMessage.findUnique({
      where: {
        sourceId_gmailMessageId: { sourceId, gmailMessageId },
      },
    });
  }

  upsertEmailMessage(data: UpsertEmailMessageInput) {
    const {
      sourceId,
      gmailMessageId,
      outcome,
      reason,
      provider,
      model,
      instrumentHint,
      lastFourHint,
      extractedPayload,
    } = data;
    return this.prisma.finEmailMessage.upsert({
      where: {
        sourceId_gmailMessageId: { sourceId, gmailMessageId },
      },
      create: {
        sourceId,
        gmailMessageId,
        outcome,
        reason: reason ?? null,
        provider: provider ?? null,
        model: model ?? null,
        instrumentHint: instrumentHint ?? null,
        lastFourHint: lastFourHint ?? null,
        extractedPayload:
          extractedPayload === undefined || extractedPayload === null
            ? undefined
            : jsonInput(extractedPayload),
      },
      update: {
        outcome,
        reason: reason ?? null,
        provider: provider ?? null,
        model: model ?? null,
        ...(instrumentHint !== undefined
          ? { instrumentHint: instrumentHint ?? null }
          : {}),
        ...(lastFourHint !== undefined
          ? { lastFourHint: lastFourHint ?? null }
          : {}),
        ...(extractedPayload !== undefined
          ? {
              extractedPayload:
                extractedPayload === null
                  ? undefined
                  : jsonInput(extractedPayload),
            }
          : {}),
      },
    });
  }
}
