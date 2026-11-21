import { Injectable } from '@nestjs/common';
import type { AuthDeletionOutboxStatus, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type {
  ModuleSettingsDefaults,
  UsersRepositoryPort,
} from '../application/ports/users.repository.port';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../domain/defaults/global-preferences-defaults';

const AUTH_DELETION_LEASE_MS = 5 * 60_000;

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
export class UsersRepository implements UsersRepositoryPort {
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

  findEnabledUserModuleBySlug(userId: string, slug: string) {
    return this.prisma.userModule.findFirst({
      where: { userId, isEnabled: true, module: { slug } },
      select: { id: true, config: true },
    });
  }

  findUserModuleBySlug(userId: string, slug: string) {
    return this.prisma.userModule.findFirst({
      where: { userId, module: { slug } },
      select: { id: true, isEnabled: true, config: true },
    });
  }

  async findEnabledModuleConfigs(slug: string) {
    const rows = await this.prisma.userModule.findMany({
      where: { isEnabled: true, module: { slug } },
      select: {
        userId: true,
        config: true,
        user: { select: { timezone: true } },
      },
    });
    return rows.map((row) => ({
      userId: row.userId,
      timezone: row.user.timezone,
      config: row.config,
    }));
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

  async setLastSeenReleaseVersion(id: string, version: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastSeenReleaseVersion: version },
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

  async resetSettingsToDefaults(
    userId: string,
    moduleDefaults: readonly ModuleSettingsDefaults[],
  ): Promise<void> {
    const defaultsBySlug = new Map(
      moduleDefaults.map((module) => [module.slug, module.defaults]),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          preferences: GLOBAL_USER_PREFERENCES_DEFAULTS,
        },
      });
      const modules = await tx.module.findMany({
        where: { slug: { in: [...defaultsBySlug.keys()] } },
        select: { id: true, slug: true },
      });
      for (const module of modules) {
        const config = defaultsBySlug.get(module.slug);
        if (!config) {
          continue;
        }
        await tx.userModule.updateMany({
          where: { userId, moduleId: module.id },
          data: { config: config as Prisma.InputJsonValue },
        });
      }
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
        claimedAt: null,
      },
    });
  }

  /**
   * A worker that died with a claim leaves the row IN_PROGRESS. The lease
   * makes it due again; a row that exhausted its attempts goes to DEAD.
   */
  async recoverExpiredAuthDeletions(maxAttempts: number): Promise<void> {
    const now = new Date();
    const expired = {
      status: 'IN_PROGRESS' as const,
      OR: [
        {
          claimedAt: {
            lte: new Date(now.getTime() - AUTH_DELETION_LEASE_MS),
          },
        },
        { claimedAt: null },
      ],
    };
    await this.prisma.authDeletionOutbox.updateMany({
      where: { ...expired, attempts: { gte: maxAttempts } },
      data: {
        status: 'DEAD' satisfies AuthDeletionOutboxStatus,
        claimedAt: null,
        lastError: 'Lease expired after final attempt',
        nextAttemptAt: now,
      },
    });
    await this.prisma.authDeletionOutbox.updateMany({
      where: { ...expired, attempts: { lt: maxAttempts } },
      data: {
        status: 'FAILED' satisfies AuthDeletionOutboxStatus,
        claimedAt: null,
        lastError: 'Lease expired; retry scheduled',
        nextAttemptAt: now,
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
        claimedAt: now,
        attempts: { increment: 1 },
      },
    });

    if (result.count === 0) {
      return null;
    }

    return {
      id: candidate.id,
      userId: candidate.userId,
      attempts: candidate.attempts + 1,
    };
  }

  async completeAuthDeletion(id: string, attempts: number) {
    return this.prisma.authDeletionOutbox.updateMany({
      where: { id, status: 'IN_PROGRESS', attempts },
      data: {
        status: 'COMPLETED' satisfies AuthDeletionOutboxStatus,
        lastError: null,
        completedAt: new Date(),
        claimedAt: null,
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
    return this.prisma.authDeletionOutbox.updateMany({
      where: { id, status: 'IN_PROGRESS', attempts },
      data: {
        status: terminal ? 'DEAD' : 'FAILED',
        lastError: lastError.slice(0, 2000),
        nextAttemptAt,
        claimedAt: null,
      },
    });
  }
}
