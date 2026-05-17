import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
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
    });
  }
}
