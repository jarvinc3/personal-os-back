import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MODULE_SETTINGS_READER,
  type ModuleSettingsReader,
} from '@personal-os/contracts';
import { ENABLED_MODULE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { moduleDisabledMessage } from '../exceptions/module-disabled';

@Injectable()
export class EnabledModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(MODULE_SETTINGS_READER)
    private readonly settings: ModuleSettingsReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const slug = this.reflector.getAllAndOverride<string>(ENABLED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!slug) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { sub?: string };
    }>();
    const userId = request.user?.sub;
    if (!userId) {
      return false;
    }

    if (!this.settings.hasDescriptor(slug)) {
      throw new ForbiddenException(moduleDisabledMessage(slug));
    }

    const module = await this.settings.read(userId, slug);
    if (!module.enabled) {
      throw new ForbiddenException(moduleDisabledMessage(slug));
    }
    return true;
  }
}
