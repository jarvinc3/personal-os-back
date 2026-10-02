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
  type ModuleSlug,
} from '../domain/defaults/user-settings-defaults';
import { validateEmailSyncSchedule } from '@personal-os/config';
import { UpdateModuleConfigDto } from '../presentation/dto/update-module-config.dto';
import { UpdateProfileDto } from '../presentation/dto/update-profile.dto';
import { mergeWithDefaults } from '../domain/settings-merge';
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
      throw new NotFoundException('User not found');
    }
    return this.mapUser(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
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

  async updateModuleConfig(
    userId: string,
    slug: string,
    dto: UpdateModuleConfigDto,
  ) {
    if (!isModuleSlug(slug)) {
      throw new NotFoundException(`Module "${slug}" not found`);
    }

    if (slug === 'finance' && dto.config !== undefined) {
      const emailSync = (dto.config as { emailSync?: { schedule?: unknown } })
        .emailSync;
      if (emailSync?.schedule !== undefined) {
        const scheduleError = validateEmailSyncSchedule(emailSync.schedule);
        if (scheduleError) {
          throw new BadRequestException(scheduleError);
        }
      }
    }

    if (dto.config === undefined && dto.isEnabled === undefined) {
      throw new BadRequestException(
        'Either config or isEnabled must be provided',
      );
    }

    const moduleRecord = await this.usersRepository.findModuleBySlug(slug);
    if (!moduleRecord) {
      throw new NotFoundException(`Module "${slug}" not found`);
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
        'Module is not configured yet; provide config to create a user module record',
      );
    }

    if (!existing && dto.isEnabled === false && dto.config === undefined) {
      throw new BadRequestException(
        'Module is not configured yet; cannot disable before initial configuration',
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
      throw new NotFoundException('User not found');
    }

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

  async assertFinanceEmailSyncEnabled(userId: string): Promise<void> {
    await this.assertModuleEnabled(userId, 'finance');
    const row = await this.usersRepository.findUserModuleBySlug(
      userId,
      'finance',
    );
    const config = (row?.config ?? {}) as {
      emailSync?: { enabled?: boolean };
    };
    const enabled =
      config.emailSync?.enabled ??
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.emailSync.enabled;
    if (enabled !== true) {
      throw new ForbiddenException('Finance email sync is disabled');
    }
  }

  async isFinanceEmailSyncAutomatic(userId: string): Promise<boolean> {
    const row = await this.usersRepository.findUserModuleBySlug(
      userId,
      'finance',
    );
    const config = (row?.config ?? {}) as {
      emailSync?: { enabled?: boolean; automatic?: boolean };
    };
    const enabled =
      config.emailSync?.enabled ??
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.emailSync.enabled;
    const automatic =
      config.emailSync?.automatic ??
      DEFAULT_MODULE_CONFIG_BY_SLUG.finance.emailSync.automatic;
    return enabled === true && automatic === true;
  }
}
