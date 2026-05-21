import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_MODULE_CONFIG_BY_SLUG,
  isModuleSlug,
  type ModuleSlug,
} from './defaults/user-settings-defaults';
import { UpdateModuleConfigDto } from './dto/update-module-config.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { mergeWithDefaults } from './lib/settings-merge';
import { UserWithModules, UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

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
    await this.findById(userId);

    const updated = await this.usersRepository.updateProfile(userId, {
      fullName: dto.fullName,
      timezone: dto.timezone,
      locale: dto.locale,
      avatarUrl: dto.avatarUrl,
      preferences: dto.preferences,
    });

    return this.mapUser(updated);
  }

  async updateModuleConfig(userId: string, slug: string, dto: UpdateModuleConfigDto) {
    if (!isModuleSlug(slug)) {
      throw new NotFoundException(`Module "${slug}" not found`);
    }

    if (dto.config === undefined && dto.isEnabled === undefined) {
      throw new BadRequestException('Either config or isEnabled must be provided');
    }

    await this.findById(userId);

    const moduleRecord = await this.usersRepository.findModuleBySlug(slug);
    if (!moduleRecord) {
      throw new NotFoundException(`Module "${slug}" not found`);
    }

    const defaults = DEFAULT_MODULE_CONFIG_BY_SLUG[slug] as unknown as Record<string, unknown>;
    const existing = await this.usersRepository.findUserModule(userId, moduleRecord.id);

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

    return this.findById(userId);
  }
}
