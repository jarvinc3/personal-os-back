import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import type { AiRole } from './ai-role.decorator';

@Injectable()
export class AiRolesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) !== 'development') {
      return;
    }
    const adminEmail = this.config.get('AI_DEV_ADMIN_EMAIL', { infer: true });
    if (!adminEmail) {
      return;
    }
    const owner = await this.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });
    if (!owner) {
      return;
    }
    await this.prisma.userRole.upsert({
      where: { userId: owner.id },
      create: { userId: owner.id, role: 'ADMIN' },
      update: { role: 'ADMIN', grantedBy: null },
    });
  }

  async list() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        aiRole: { select: { role: true, grantedAt: true, updatedAt: true } },
      },
      orderBy: { email: 'asc' },
    });

    return users.map(({ aiRole, ...user }) => ({
      ...user,
      role: aiRole?.role ?? 'USER',
      grantedAt: aiRole?.grantedAt ?? null,
      updatedAt: aiRole?.updatedAt ?? null,
    }));
  }

  async setRole(userId: string, role: AiRole, grantedBy: string) {
    const [target, existing] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      this.prisma.userRole.findUnique({
        where: { userId },
        select: { role: true },
      }),
    ]);
    if (!target) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (existing?.role === 'ADMIN' && role !== 'ADMIN') {
      const adminCount = await this.prisma.userRole.count({
        where: { role: 'ADMIN' },
      });
      if (adminCount <= 1) {
        throw new ConflictException('Debe permanecer al menos un ADMIN');
      }
    }

    const assignment = await this.prisma.userRole.upsert({
      where: { userId },
      create: { userId, role, grantedBy },
      update: { role, grantedBy, grantedAt: new Date() },
      select: { userId: true, role: true, grantedBy: true, grantedAt: true },
    });

    return assignment;
  }
}
