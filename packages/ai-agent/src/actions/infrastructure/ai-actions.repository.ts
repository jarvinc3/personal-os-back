import { Injectable } from '@nestjs/common';
import type { AiActionStatus, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

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
        result: data.result
          ? (data.result as Prisma.InputJsonValue)
          : undefined,
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

  /**
   * Atomically transitions PENDING → RUNNING for the given owner.
   * Returns the claimed row, or null if already claimed/cancelled/missing.
   */
  async claimForExecution(id: string, userId: string) {
    const result = await this.prisma.aiAction.updateMany({
      where: {
        id,
        status: 'PENDING',
        session: { userId },
      },
      // executedAt marks claim/start so the reaper can age RUNNING rows.
      data: { status: 'RUNNING', executedAt: new Date() },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id, userId);
  }

  /**
   * Atomically transitions PENDING → CANCELLED for the given owner.
   */
  async claimForCancel(id: string, userId: string) {
    const result = await this.prisma.aiAction.updateMany({
      where: {
        id,
        status: 'PENDING',
        session: { userId },
      },
      data: {
        status: 'CANCELLED',
        executedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return null;
    }

    return this.findById(id, userId);
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

  /** Mark RUNNING actions claimed before cutoff as FAILED (crash recovery). */
  async failStaleRunning(claimedBefore: Date): Promise<number> {
    const result = await this.prisma.aiAction.updateMany({
      where: {
        status: 'RUNNING',
        executedAt: { lt: claimedBefore },
      },
      data: {
        status: 'FAILED',
        result: {
          error: 'Action timed out while RUNNING (reaper)',
        },
        executedAt: new Date(),
      },
    });
    return result.count;
  }
}
