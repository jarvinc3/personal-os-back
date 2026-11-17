import { Inject, Injectable } from '@nestjs/common';
import {
  MODULE_SETTINGS_REGISTRY,
  type ModuleSettingsReader,
  type ModuleSettingsRegistry as ModuleSettingsRegistryContract,
} from '@personal-os/contracts';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class ModuleSettingsService implements ModuleSettingsReader {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MODULE_SETTINGS_REGISTRY)
    private readonly registry: ModuleSettingsRegistryContract,
  ) {}

  async read(userId: string, slug: string) {
    const descriptor = this.registry.get(slug);
    const userModule = await this.prisma.userModule.findFirst({
      where: { userId, module: { slug } },
      select: { isEnabled: true, config: true },
    });

    return {
      enabled: userModule?.isEnabled ?? false,
      version: descriptor.version,
      config: descriptor.normalize(userModule?.config ?? {}),
    };
  }

  hasDescriptor(slug: string): boolean {
    return this.registry.has(slug);
  }

  async notificationEnabled(
    userId: string,
    slug: string,
    key: string,
  ): Promise<boolean> {
    const [settings, descriptor] = [
      await this.read(userId, slug),
      this.registry.get(slug),
    ];
    return descriptor.notificationEnabled(settings.config, key);
  }
}
