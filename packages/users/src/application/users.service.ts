import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MODULE_SETTINGS_REGISTRY,
  type ModuleSettingsRegistry,
} from '@personal-os/contracts';
import { AppEvents } from '@personal-os/core';
import { moduleDisabledMessage } from '@personal-os/core';
import { SupabaseAdminService } from '@personal-os/auth';
import { GLOBAL_USER_PREFERENCES_DEFAULTS } from '../domain/defaults/global-preferences-defaults';
import { UpdateModuleConfigDto } from '../presentation/dto/update-module-config.dto';
import { UpdateProfileDto } from '../presentation/dto/update-profile.dto';
import { mergeWithDefaults } from '../domain/settings-merge';
import {
  readWeekStartsOnInput,
  validateWeekStartsOn,
} from '../domain/week-starts-on';
import {
  USERS_REPOSITORY,
  type UserModuleRecord,
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
    @Inject(MODULE_SETTINGS_REGISTRY)
    private readonly settingsRegistry: ModuleSettingsRegistry,
  ) {
    if (!settingsRegistry) {
      throw new Error(
        'MODULE_SETTINGS_REGISTRY is required to validate module settings',
      );
    }
  }

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
        slug: row.module.slug,
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
    const { moduleId, existing } = await this.loadModuleForConfigUpdate({
      userId,
      slug,
      dto,
    });

    // The stored config is untyped JSON; each descriptor validates its patch.
    const currentConfig = (existing?.config ?? {}) as Record<string, unknown>;
    const normalizedConfig = this.settingsRegistry.applyPatch(
      slug,
      currentConfig,
      dto.config ?? {},
    );
    const isEnabled = dto.isEnabled ?? existing?.isEnabled ?? true;

    await this.usersRepository.upsertUserModule({
      userId,
      moduleId,
      config: normalizedConfig,
      isEnabled,
    });

    this.emitModuleConfigEvents({
      userId,
      slug,
      wasEnabled: existing?.isEnabled ?? false,
      isEnabled,
      requestedEnabled: dto.isEnabled,
      hasConfigPatch: dto.config !== undefined,
    });

    return this.findById(userId);
  }

  /** Validates the patch before it touches the database and returns the rows it needs. */
  private async loadModuleForConfigUpdate({
    userId,
    slug,
    dto,
  }: {
    userId: string;
    slug: string;
    dto: UpdateModuleConfigDto;
  }): Promise<{ moduleId: string; existing: UserModuleRecord | null }> {
    if (!this.settingsRegistry.has(slug)) {
      throw new BadRequestException(`Módulo desconocido "${slug}"`);
    }

    if (dto.config === undefined && dto.isEnabled === undefined) {
      throw new BadRequestException('Debes indicar config o isEnabled');
    }

    const moduleRecord = await this.usersRepository.findModuleBySlug(slug);
    if (!moduleRecord) {
      throw new NotFoundException(`Módulo "${slug}" no encontrado`);
    }

    const existing = await this.usersRepository.findUserModule(
      userId,
      moduleRecord.id,
    );

    if (!existing && dto.config === undefined) {
      throw new BadRequestException(
        'El módulo aún no está configurado; indica config para crear el registro',
      );
    }

    if (!existing && dto.isEnabled === false) {
      throw new BadRequestException(
        'El módulo aún no está configurado; no se puede desactivar antes de configurarlo',
      );
    }

    return { moduleId: moduleRecord.id, existing };
  }

  private emitModuleConfigEvents({
    userId,
    slug,
    wasEnabled,
    isEnabled,
    requestedEnabled,
    hasConfigPatch,
  }: {
    userId: string;
    slug: string;
    wasEnabled: boolean;
    isEnabled: boolean;
    requestedEnabled: boolean | undefined;
    hasConfigPatch: boolean;
  }): void {
    if (!wasEnabled && isEnabled) {
      this.eventEmitter.emit(AppEvents.MODULE_ENABLED, { userId, slug });
    } else if (wasEnabled && requestedEnabled === false) {
      this.eventEmitter.emit(AppEvents.MODULE_DISABLED, { userId, slug });
    }

    if (hasConfigPatch) {
      this.eventEmitter.emit(AppEvents.MODULE_CONFIG_UPDATED, {
        userId,
        slug,
      });
    }
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

  /** Enabled module configs with the user's timezone; the module interprets them. */
  async listEnabledModuleConfigs(slug: string) {
    return this.usersRepository.findEnabledModuleConfigs(slug);
  }
}
