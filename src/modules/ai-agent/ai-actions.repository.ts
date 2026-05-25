import { Injectable } from '@nestjs/common';
import type { AiActionStatus, Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiActionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    sessionId: string;
    messageId?: string;
    actionType: string;
    targetModule: string;
    payload: Record<string, unknown>;
    status?: AiActionStatus;
    result?: Record<string, unknown>;
  }) {
    return this.prisma.aiAction.create({
      data: {
        sessionId: data.sessionId,
        messageId: data.messageId,
        actionType: data.actionType,
        targetModule: data.targetModule,
        payload: data.payload as Prisma.InputJsonValue,
        status: data.status ?? 'PENDING',
        result: data.result ? (data.result as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  findById(id: string, userId: string) {
    return this.prisma.aiAction.findFirst({
      where: { id, session: { userId } },
    });
  }

  findBySession(sessionId: string, userId: string) {
    return this.prisma.aiAction.findMany({
      where: { sessionId, session: { userId } },
      orderBy: { executedAt: 'desc' },
    });
  }

  updateStatus(
    id: string,
    status: AiActionStatus,
    result?: Record<string, unknown>,
  ) {
    return this.prisma.aiAction.update({
      where: { id },
      data: {
        status,
        result: result ? (result as Prisma.InputJsonValue) : undefined,
        executedAt: ['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)
          ? new Date()
          : undefined,
      },
    });
  }
}
