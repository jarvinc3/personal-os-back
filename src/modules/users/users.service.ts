import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '../../core/events/event.constants';
import { SupabaseAdminService } from '../auth/supabase-admin.service';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from './defaults/global-preferences-defaults';
import {
    DEFAULT_MODULE_CONFIG_BY_SLUG,
    isModuleSlug,
    type ModuleSlug,
} from './defaults/user-settings-defaults';
import { UpdateModuleConfigDto } from './dto/update-module-config.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { mergeWithDefaults } from './lib/settings-merge';
import { UserWithModules, UsersRepository } from './users.repository';

export type DeleteAccountResult = {
  success: true;
  authCleanupPending: boolean;
};

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly eventEmitter: EventEmitter2,
    private readonly supabaseAdminService: SupabaseAdminService,
  ) {}

  private mapUser(user: UserWithModules) {
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

    if (dto.config === undefined && dto.isEnabled === undefined) {
      throw new BadRequestException(
        'Either config or isEnabled must be provided',
      );
    }

    const before = await this.findById(userId);

    const moduleRecord = await this.usersRepository.findModuleBySlug(slug);
    if (!moduleRecord) {
      throw new NotFoundException(`Module "${slug}" not found`);
    }

    const defaults = DEFAULT_MODULE_CONFIG_BY_SLUG[
      slug
    ] as unknown as Record<string, unknown>;
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
      ? mergeWithDefaults(mergeWithDefaults(dto.config, currentConfig), defaults)
      : mergeWithDefaults(currentConfig, defaults);

    const isEnabled = dto.isEnabled ?? existing?.isEnabled ?? true;

    await this.usersRepository.upsertUserModule(
      userId,
      moduleRecord.id,
      mergedConfig,
      isEnabled,
    );

    const wasEnabled = existing?.isEnabled ?? false;
    if (dto.isEnabled !== undefined && dto.isEnabled !== wasEnabled) {
      this.eventEmitter.emit(
        dto.isEnabled ? AppEvents.MODULE_ENABLED : AppEvents.MODULE_DISABLED,
        { userId, slug },
      );
    }

    if (dto.config !== undefined) {
      this.eventEmitter.emit(AppEvents.MODULE_CONFIG_UPDATED, {
        userId,
        slug,
      });
    }

    void before;
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

    const authResult = await this.supabaseAdminService.tryDeleteAuthUser(userId);
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
}
