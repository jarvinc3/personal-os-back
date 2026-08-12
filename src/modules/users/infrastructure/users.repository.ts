import { Injectable } from '@nestjs/common';
import type {
    AuthDeletionOutboxStatus,
    Prisma,
} from '../../../prisma/generated/client';
import { PrismaService } from '../../../prisma/prisma.service';

const userWithModulesInclude = {
  userModules: {
    include: {
      module: true,
    },
  },
} satisfies Prisma.UserInclude;

export type UserWithModules = Prisma.UserGetPayload<{
  include: typeof userWithModulesInclude;
}>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithModulesInclude,
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findModuleBySlug(slug: string) {
    return this.prisma.module.findUnique({
      where: { slug },
    });
  }

  findUserModule(userId: string, moduleId: string) {
    return this.prisma.userModule.findUnique({
      where: {
        userId_moduleId: { userId, moduleId },
      },
    });
  }

  updateProfile(
    id: string,
    data: {
      fullName?: string;
      timezone?: string;
      locale?: string;
      avatarUrl?: string | null;
      preferences?: Record<string, unknown>;
    },
  ) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        preferences: data.preferences as Prisma.InputJsonValue | undefined,
      },
      include: userWithModulesInclude,
    });
  }

  upsertUserModule(
    userId: string,
    moduleId: string,
    config: Record<string, unknown>,
    isEnabled = true,
  ) {
    return this.prisma.userModule.upsert({
      where: {
        userId_moduleId: { userId, moduleId },
      },
      create: {
        userId,
        moduleId,
        isEnabled,
        config: config as Prisma.InputJsonValue,
      },
      update: {
        isEnabled,
        config: config as Prisma.InputJsonValue,
      },
      include: {
        module: true,
      },
    });
  }

  deleteById(id: string) {
    return this.prisma.user.delete({
      where: { id },
    });
  }

  /**
   * Atomically records an Auth deletion outbox row and removes app data.
   * If Postgres succeeds, Auth cleanup can retry independently.
   */
  async deleteAccountWithAuthOutbox(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.authDeletionOutbox.create({
        data: {
          userId,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: new Date(),
        },
      });
      await tx.user.delete({ where: { id: userId } });
    });
  }

  findAuthOutboxByUserId(userId: string) {
    return this.prisma.authDeletionOutbox.findUnique({
      where: { userId },
    });
  }

  markAuthOutboxCompleted(userId: string) {
    return this.prisma.authDeletionOutbox.update({
      where: { userId },
      data: {
        status: 'COMPLETED',
        lastError: null,
        completedAt: new Date(),
        nextAttemptAt: new Date(),
      },
    });
  }

  /**
   * Claims the next due outbox row (PENDING or FAILED, due for retry).
   * Uses conditional update for atomicity across workers.
   */
  async claimNextAuthDeletion(
    maxAttempts: number,
  ): Promise<{ id: string; userId: string; attempts: number } | null> {
    const now = new Date();
    const candidate = await this.prisma.authDeletionOutbox.findFirst({
      where: {
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
        attempts: { lt: maxAttempts },
      },
      orderBy: { nextAttemptAt: 'asc' },
    });

    if (!candidate) {
      return null;
    }

    const result = await this.prisma.authDeletionOutbox.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['PENDING', 'FAILED'] },
        nextAttemptAt: { lte: now },
        attempts: { lt: maxAttempts },
      },
      data: {
        status: 'IN_PROGRESS' satisfies AuthDeletionOutboxStatus,
      },
    });

    if (result.count === 0) {
      return null;
    }

    return {
      id: candidate.id,
      userId: candidate.userId,
      attempts: candidate.attempts,
    };
  }

  async completeAuthDeletion(id: string) {
    return this.prisma.authDeletionOutbox.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        lastError: null,
        completedAt: new Date(),
      },
    });
  }

  async failAuthDeletion(
    id: string,
    attempts: number,
    lastError: string,
    nextAttemptAt: Date,
    terminal: boolean,
  ) {
    return this.prisma.authDeletionOutbox.update({
      where: { id },
      data: {
        status: terminal ? 'DEAD' : 'FAILED',
        attempts,
        lastError: lastError.slice(0, 2000),
        nextAttemptAt,
      },
    });
  }
}
