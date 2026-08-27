import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ENABLED_MODULE_KEY, IS_PUBLIC_KEY } from '../decorators';
import { moduleDisabledMessage } from '../exceptions/module-disabled';

@Injectable()
export class EnabledModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    const enabled = await this.prisma.userModule.findFirst({
      where: { userId, isEnabled: true, module: { slug } },
      select: { id: true },
    });
    if (!enabled) {
      throw new ForbiddenException(moduleDisabledMessage(slug));
    }
    return true;
  }
}
