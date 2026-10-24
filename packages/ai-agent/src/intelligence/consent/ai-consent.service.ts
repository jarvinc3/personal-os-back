import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiConsentService {
  constructor(private readonly prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.userAiSettings.upsert({
      where: { userId },
      create: { userId, contributeToGlobalKnowledge: true },
      update: {},
      select: {
        contributeToGlobalKnowledge: true,
        contributionConsentAt: true,
      },
    });
  }

  async update(userId: string, contributeToGlobalKnowledge: boolean) {
    const existing = await this.prisma.userAiSettings.findUnique({
      where: { userId },
      select: { contributeToGlobalKnowledge: true },
    });
    if (existing?.contributeToGlobalKnowledge === contributeToGlobalKnowledge) {
      return this.get(userId);
    }

    return this.prisma.userAiSettings.upsert({
      where: { userId },
      create: { userId, contributeToGlobalKnowledge },
      update: {
        contributeToGlobalKnowledge,
        contributionConsentAt: new Date(),
      },
      select: {
        contributeToGlobalKnowledge: true,
        contributionConsentAt: true,
      },
    });
  }
}
