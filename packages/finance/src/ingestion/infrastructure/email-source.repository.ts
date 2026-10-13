import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import {
  EMAIL_MESSAGE_OUTCOME,
  type EmailMessageOutcome,
} from '../application/email-message-outcome';

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
  logs: { orderBy: { startedAt: 'desc' as const }, take: 20 },
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
  outcome: EmailMessageOutcome;
  reason?: string | null;
  provider?: string | null;
  model?: string | null;
  instrumentHint?: string | null;
  lastFourHint?: string | null;
  accountNumberHint?: string | null;
  extractedPayload?: unknown;
  fingerprint?: string | null;
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

  listAutoSyncSources() {
    return this.prisma.finEmailSource.findMany({
      where: {
        isActive: true,
        connection: { isActive: true },
        institution: { isActive: true },
        user: {
          userModules: {
            some: {
              isEnabled: true,
              module: { slug: 'finance' },
              AND: [
                {
                  config: {
                    path: ['emailSync', 'enabled'],
                    equals: true,
                  },
                },
                {
                  config: {
                    path: ['emailSync', 'automatic'],
                    equals: true,
                  },
                },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        userId: true,
        lastSyncedAt: true,
        user: {
          select: {
            timezone: true,
            userModules: {
              where: { module: { slug: 'finance' } },
              select: { config: true },
              take: 1,
            },
          },
        },
      },
    });
  }

  findEmailSource(userId: string, id: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, id },
      include: {
        ...sourceListInclude,
        logs: { orderBy: { startedAt: 'desc' }, take: 20 },
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
        if (result.count === 0) {
          return null;
        }
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

  findSourceByUserAndInstitution(userId: string, institutionId: string) {
    return this.prisma.finEmailSource.findFirst({
      where: { userId, institutionId },
      include: sourceListInclude,
    });
  }

  listMailboxes(userId: string) {
    return this.prisma.finEmailConnection.findMany({
      where: { userId, isActive: true },
      include: {
        sources: {
          where: { isActive: true },
          include: sourceListInclude,
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findMailbox(userId: string, id: string) {
    return this.prisma.finEmailConnection.findFirst({
      where: { userId, id },
    });
  }

  async deactivateMailbox(userId: string, id: string) {
    const mailbox = await this.findMailbox(userId, id);
    if (!mailbox) {
      return null;
    }
    await this.prisma.finEmailSource.updateMany({
      where: { userId, connectionId: id },
      data: { isActive: false },
    });
    return this.prisma.finEmailConnection.update({
      where: { id },
      data: { isActive: false },
    });
  }

  listInstitutionDestinations(userId: string, institutionId: string) {
    return Promise.all([
      this.prisma.finAccount.findMany({
        where: { userId, institutionId, isActive: true },
        select: {
          id: true,
          name: true,
          accountNumber: true,
          isDefaultForInstitution: true,
        },
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
        outcome: {
          in: [
            EMAIL_MESSAGE_OUTCOME.PENDING_ASSIGNMENT,
            EMAIL_MESSAGE_OUTCOME.PENDING_AMOUNT,
          ],
        },
        source: { userId },
      },
      include: pendingMessageInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  listCashAccounts(userId: string) {
    return this.prisma.finAccount.findMany({
      where: { userId, type: 'CASH', isActive: true },
      select: { id: true, name: true, currency: true },
    });
  }

  listEmailMovementsForTransferMatch(userId: string, since: Date) {
    return this.prisma.finTransaction.findMany({
      where: {
        userId,
        source: 'EMAIL',
        status: { in: ['PENDING', 'CONFIRMED'] },
        transactionDate: { gte: since },
      },
      include: {
        account: { select: { id: true, institutionId: true, type: true } },
        card: { select: { id: true, institutionId: true } },
        emailMessage: {
          select: { id: true, extractedPayload: true, outcome: true },
        },
      },
      orderBy: { transactionDate: 'asc' },
    });
  }

  listRecentEmailMessages(userId: string, take = 40) {
    return this.prisma.finEmailMessage.findMany({
      where: { source: { userId } },
      include: pendingMessageInclude,
      orderBy: { createdAt: 'desc' },
      take,
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

  listPendingReverseMessages(userId: string, limit: number) {
    return this.prisma.finEmailMessage.findMany({
      where: {
        outcome: EMAIL_MESSAGE_OUTCOME.PENDING_REVERSE,
        source: { userId, isActive: true },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
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
      accountNumberHint,
      extractedPayload,
      fingerprint,
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
        accountNumberHint: accountNumberHint ?? null,
        fingerprint: fingerprint ?? null,
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
        ...(accountNumberHint !== undefined
          ? { accountNumberHint: accountNumberHint ?? null }
          : {}),
        ...(fingerprint !== undefined
          ? { fingerprint: fingerprint ?? null }
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

  findEmailMessageByFingerprint(sourceId: string, fingerprint: string) {
    return this.prisma.finEmailMessage.findFirst({
      where: { sourceId, fingerprint },
      select: { id: true, outcome: true },
    });
  }
}
