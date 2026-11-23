import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

/** Reads the owner profile data that planning dates depend on. */
@Injectable()
export class PlanningUserTimezoneRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserTimezone(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return user?.timezone ?? null;
  }
}
