import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

const userWithModulesInclude = {
  userModules: {
    include: {
      module: true,
    },
  },
} satisfies Prisma.UserInclude;

export type UserWithModules = Prisma.UserGetPayload<{
  include: typeof userWithModulesInclude;
}>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithModulesInclude,
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findModuleBySlug(slug: string) {
    return this.prisma.module.findUnique({
      where: { slug },
    });
  }

  findUserModule(userId: string, moduleId: string) {
    return this.prisma.userModule.findUnique({
      where: {
        userId_moduleId: { userId, moduleId },
      },
    });
  }

  updateProfile(
    id: string,
    data: {
      fullName?: string;
      timezone?: string;
      locale?: string;
      avatarUrl?: string;
      preferences?: Record<string, unknown>;
    },
  ) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...data,
        preferences: data.preferences as Prisma.InputJsonValue | undefined,
      },
      include: userWithModulesInclude,
    });
  }

  upsertUserModule(
    userId: string,
    moduleId: string,
    config: Record<string, unknown>,
    isEnabled = true,
  ) {
    return this.prisma.userModule.upsert({
      where: {
        userId_moduleId: { userId, moduleId },
      },
      create: {
        userId,
        moduleId,
        isEnabled,
        config: config as Prisma.InputJsonValue,
      },
      update: {
        isEnabled,
        config: config as Prisma.InputJsonValue,
      },
      include: {
        module: true,
      },
    });
  }
}
