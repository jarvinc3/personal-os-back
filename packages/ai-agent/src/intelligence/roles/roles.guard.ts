import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@personal-os/database';
import { AI_ROLES_KEY, type AiRole } from './ai-role.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<AiRole[]>(
      AI_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { sub?: string };
    }>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new ForbiddenException('No hay un usuario autenticado');
    }

    const assignment = await this.prisma.userRole.findUnique({
      where: { userId },
      select: { role: true },
    });
    const role = assignment?.role ?? 'USER';
    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException('No tienes permisos para esta operación');
    }
    return true;
  }
}
