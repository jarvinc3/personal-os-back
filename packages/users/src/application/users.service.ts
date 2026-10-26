import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '@personal-os/core';
import { moduleDisabledMessage } from '@personal-os/core';
import { SupabaseAdminService } from '@personal-os/auth';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../domain/defaults/global-preferences-defaults';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  isModuleSlug,
  validateCardDueDaysBefore,
  validateSubscriptionReminderDays,
  type ModuleSlug,
} from '../domain/defaults/user-settings-defaults';
import { UpdateModuleConfigDto } from '../presentation/dto/update-module-config.dto';
import { UpdateProfileDto } from '../presentation/dto/update-profile.dto';
import { mergeWithDefaults } from '../domain/settings-merge';
import {
  readWeekStartsOnInput,
  validateWeekStartsOn,
} from '../domain/week-starts-on';
import {
  USERS_REPOSITORY,
  type UserWithModulesRecord,
  type UsersRepositoryPort,
} from './ports/users.repository.port';

export type DeleteAccountResult = {
  success: true;
  authCleanupPending: boolean;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
    private readonly supabaseAdminService: SupabaseAdminService,
  ) {}

  private mapUser(user: UserWithModulesRecord) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      locale: user.locale,
      preferences: user.preferences,
      lastSeenReleaseVersion: user.lastSeenReleaseVersion,
      userModules: user.userModules.map((row) => ({
        slug: row.module.slug as ModuleSlug,
        isEnabled: row.isEnabled,
        config: row.config,
        enabledAt: row.enabledAt.toISOString(),
      })),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async findById(userId: string) {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return this.mapUser(user);
  }

  private assertFinanceConfig(config: Record<string, unknown>): void {
    const financeConfig = config as {
      subscriptions?: { reminderDaysBefore?: unknown };
      reminders?: { cardDueDaysBefore?: unknown };
    };
    const reminderDays = financeConfig.subscriptions?.reminderDaysBefore;
    if (reminderDays !== undefined) {
      const reminderError = validateSubscriptionReminderDays(reminderDays);
      if (reminderError) {
        throw new BadRequestException(reminderError);
      }
    }
    const cardDueDays = financeConfig.reminders?.cardDueDaysBefore;
    if (cardDueDays !== undefined) {
      const cardDueError = validateCardDueDaysBefore(cardDueDays);
      if (cardDueError) {
        throw new BadRequestException(cardDueError);
      }
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const weekStartsOnError = validateWeekStartsOn(
      readWeekStartsOnInput(dto.preferences),
    );
    if (weekStartsOnError) {
      throw new BadRequestException(weekStartsOnError);
    }

    const current = await this.findById(userId);

    let mergedPreferences = current.preferences as Record<string, unknown>;
    if (dto.preferences !== undefined) {
      mergedPreferences = mergeWithDefaults(
        dto.preferences,
        mergeWithDefaults(
          current.preferences as Record<string, unknown>,
          GLOBAL_USER_PREFERENCES_DEFAULTS as unknown as Record<
            string,
            unknown
          >,
        ),
      );
    }

    const updated = await this.usersRepository.updateProfile(userId, {
      fullName: dto.fullName,
      timezone: dto.timezone,
      locale: dto.locale,
      avatarUrl: dto.avatarUrl,
      preferences: mergedPreferences,
    });

    if (dto.preferences !== undefined) {
      this.eventEmitter.emit(AppEvents.USER_PREFERENCES_UPDATED, {
        userId,
        preferences: mergedPreferences,
      });
    }

    return this.mapUser(updated);
  }

  async markReleaseNotesSeen(userId: string, version: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    await this.usersRepository.setLastSeenReleaseVersion(userId, version);
  }

  async updateModuleConfig(
    userId: string,
    slug: string,
    dto: UpdateModuleConfigDto,
  ) {
    if (!isModuleSlug(slug)) {
      throw new BadRequestException(`Módulo desconocido "${slug}"`);
    }

    if (slug === 'finance' && dto.config !== undefined) {
      this.assertFinanceConfig(dto.config);
    }

    if (dto.config === undefined && dto.isEnabled === undefined) {
      throw new BadRequestException('Debes indicar config o isEnabled');
    }

    const moduleRecord = await this.usersRepository.findModuleBySlug(slug);
    if (!moduleRecord) {
      throw new NotFoundException(`Módulo "${slug}" no encontrado`);
    }

    const defaults = DEFAULT_MODULE_CONFIG_BY_SLUG[slug] as unknown as Record<
      string,
      unknown
    >;
    const existing = await this.usersRepository.findUserModule(
      userId,
      moduleRecord.id,
    );

    if (!existing && dto.config === undefined) {
      throw new BadRequestException(
        'El módulo aún no está configurado; indica config para crear el registro',
      );
    }

    if (!existing && dto.isEnabled === false && dto.config === undefined) {
      throw new BadRequestException(
        'El módulo aún no está configurado; no se puede desactivar antes de configurarlo',
      );
    }

    const currentConfig = (existing?.config ?? {}) as Record<string, unknown>;
    const mergedConfig = dto.config
      ? mergeWithDefaults(
          mergeWithDefaults(dto.config, currentConfig),
          defaults,
        )
      : mergeWithDefaults(currentConfig, defaults);

    const isEnabled = dto.isEnabled ?? existing?.isEnabled ?? true;

    await this.usersRepository.upsertUserModule(
      userId,
      moduleRecord.id,
      mergedConfig,
      isEnabled,
    );

    const wasEnabled = existing?.isEnabled ?? false;
    if (!wasEnabled && isEnabled) {
      this.eventEmitter.emit(AppEvents.MODULE_ENABLED, { userId, slug });
    } else if (wasEnabled && dto.isEnabled === false) {
      this.eventEmitter.emit(AppEvents.MODULE_DISABLED, { userId, slug });
    }

    if (dto.config !== undefined) {
      this.eventEmitter.emit(AppEvents.MODULE_CONFIG_UPDATED, {
        userId,
        slug,
      });
    }

    return this.findById(userId);
  }

  /**
   * Deletes app data first (with outbox), then best-effort Supabase Auth wipe.
   * Auth failures leave a retriable outbox row; app data is already gone.
   */
  async deleteAccount(userId: string): Promise<DeleteAccountResult> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    await this.eventEmitter.emitAsync(AppEvents.USER_ACCOUNT_DELETING, {
      userId,
    });
    await this.usersRepository.deleteAccountWithAuthOutbox(userId);

    const authResult =
      await this.supabaseAdminService.tryDeleteAuthUser(userId);
    if (authResult.ok) {
      await this.usersRepository.markAuthOutboxCompleted(userId);
      this.logger.log(
        `account_deleted userId=${userId} authCleanupPending=false`,
      );
      return { success: true, authCleanupPending: false };
    }

    this.logger.warn(
      `account_deleted userId=${userId} authCleanupPending=true reason=${authResult.message}`,
    );
    return { success: true, authCleanupPending: true };
  }

  async assertModuleEnabled(userId: string, slug: string): Promise<void> {
    const enabled = await this.usersRepository.findEnabledUserModuleBySlug(
      userId,
      slug,
    );
    if (!enabled) {
      throw new ForbiddenException(moduleDisabledMessage(slug));
    }
  }

  /** Users with finance on whose weekly summary is not turned off. */
  async listWeeklySummaryRecipients(): Promise<
    { userId: string; timezone: string; day: number }[]
  > {
    const rows = await this.usersRepository.findFinanceSummaryRecipients();
    return rows.flatMap((row) => {
      const config = mergeWithDefaults(
        row.config,
        DEFAULT_MODULE_CONFIG_BY_SLUG.finance as unknown as Record<
          string,
          unknown
        >,
      );
      const notifications = (config.notifications ?? {}) as {
        weeklySummary?: boolean;
      };
      if (notifications.weeklySummary === false) {
        return [];
      }
      const reports = (config.reports ?? {}) as { weeklySummaryDay?: number };
      const day =
        typeof reports.weeklySummaryDay === 'number'
          ? reports.weeklySummaryDay
          : DEFAULT_MODULE_CONFIG_BY_SLUG.finance.reports.weeklySummaryDay;
      return [{ userId: row.userId, timezone: row.timezone, day }];
    });
  }
}
