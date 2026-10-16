import { Injectable } from '@nestjs/common';
import type { AuthDeletionOutboxStatus, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { UsersRepositoryPort } from '../application/ports/users.repository.port';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../domain/defaults/global-preferences-defaults';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  isModuleSlug,
} from '../domain/defaults/user-settings-defaults';

const FINANCE_MODULE_SLUG = 'finance';
const EMAIL_SYNC_CONFIG_KEY = 'emailSync';
const EMAIL_SYNC_AUTOMATIC_KEY = 'automatic';

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

  async findFinanceSummaryRecipients() {
    const rows = await this.prisma.userModule.findMany({
      where: { isEnabled: true, module: { slug: FINANCE_MODULE_SLUG } },
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

  async resetSettingsToDefaults(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          preferences: GLOBAL_USER_PREFERENCES_DEFAULTS,
        },
      });
      const modules = await tx.module.findMany({
        select: { id: true, slug: true },
      });
      for (const module of modules) {
        if (!isModuleSlug(module.slug)) {
          continue;
        }
        await tx.userModule.updateMany({
          where: { userId, moduleId: module.id },
          data: {
            config: DEFAULT_MODULE_CONFIG_BY_SLUG[module.slug],
          },
        });
      }
    });
  }

  /** Ledger wipe pauses the cron so it cannot refill the ledger right away. */
  async pauseFinanceEmailSyncAutomatic(userId: string): Promise<void> {
    const financeModule = await this.prisma.module.findUnique({
      where: { slug: FINANCE_MODULE_SLUG },
      select: { id: true },
    });
    if (!financeModule) {
      return;
    }
    const userModule = await this.prisma.userModule.findUnique({
      where: { userId_moduleId: { userId, moduleId: financeModule.id } },
      select: { id: true, config: true },
    });
    if (!userModule) {
      return;
    }
    const config = (userModule.config ?? {}) as Record<string, unknown>;
    const emailSync = (config[EMAIL_SYNC_CONFIG_KEY] ?? {}) as Record<
      string,
      unknown
    >;
    await this.prisma.userModule.update({
      where: { id: userModule.id },
      data: {
        config: {
          ...config,
          [EMAIL_SYNC_CONFIG_KEY]: {
            ...emailSync,
            [EMAIL_SYNC_AUTOMATIC_KEY]: false,
          },
        },
      },
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
