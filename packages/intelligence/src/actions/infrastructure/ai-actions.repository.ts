import { Injectable } from '@nestjs/common';
import type {
  AiActionPolicy,
  AiActionStatus,
  Prisma,
} from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiActionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    originType?: string;
    originReference?: string;
    userId: string;
    actionType: string;
    targetModule: string;
    payload: Record<string, unknown>;
    policy: AiActionPolicy;
    policyVersion: string;
    argumentDigest: string;
    status?: AiActionStatus;
    result?: Record<string, unknown>;
  }) {
    return this.prisma.aiAction.create({
      data: {
        originType: data.originType ?? 'AGENT',
        originReference: data.originReference,
        userId: data.userId,
        actionType: data.actionType,
        targetModule: data.targetModule,
        payload: data.payload as Prisma.InputJsonValue,
        policy: data.policy,
        policyVersion: data.policyVersion,
        argumentDigest: data.argumentDigest,
        status: data.status ?? 'PENDING',
        executedAt:
          data.status &&
          ['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'].includes(data.status)
            ? new Date()
            : undefined,
        result: data.result
          ? (data.result as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }

  findById(id: string, userId: string) {
    return this.prisma.aiAction.findFirst({
      where: { id, userId },
    });
  }

  findClaimedForExecution(input: {
    id: string;
    userId: string;
    actionType: string;
    policy: AiActionPolicy;
    policyVersion: string;
    argumentDigest: string;
  }) {
    return this.prisma.aiAction.findFirst({
      where: {
        id: input.id,
        userId: input.userId,
        actionType: input.actionType,
        status: 'RUNNING',
        policy: input.policy,
        policyVersion: input.policyVersion,
        argumentDigest: input.argumentDigest,
      },
    });
  }

  listForUser(userId: string) {
    return this.prisma.aiAction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  countForUser(userId: string) {
    return this.prisma.aiAction.count({ where: { userId } });
  }

  async wipeForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.aiAction.deleteMany({
      where: { userId },
    });
    return count;
  }

  findByOrigin(userId: string, originType: string, originReference: string) {
    return this.prisma.aiAction.findMany({
      where: { userId, originType, originReference },
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
        userId,
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
        userId,
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
    userId: string,
    status: AiActionStatus,
    result?: Record<string, unknown>,
  ) {
    return this.prisma.aiAction.updateMany({
      where: { id, userId, status: 'RUNNING' },
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
        result: { ok: false, error: 'ACTION_TIMEOUT' },
        executedAt: new Date(),
      },
    });
    return result.count;
  }
}
