import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiConsentService {
  constructor(private readonly prisma: PrismaService) {}

  get(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.userAiSettings.findUnique({
        where: { userId },
      });
      if (existing) {
        return {
          contributeToGlobalKnowledge: existing.contributeToGlobalKnowledge,
          contributionConsentAt: existing.contributionConsentAt,
        };
      }
      const settings = await tx.userAiSettings.create({
        data: { userId, contributeToGlobalKnowledge: true },
      });
      await tx.aiConsentEvent.create({
        data: {
          userId,
          contributeToGlobalKnowledge: true,
          reason: 'DEFAULT_ON',
        },
      });
      return {
        contributeToGlobalKnowledge: settings.contributeToGlobalKnowledge,
        contributionConsentAt: settings.contributionConsentAt,
      };
    });
  }

  async update(userId: string, contributeToGlobalKnowledge: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.userAiSettings.findUnique({
        where: { userId },
      });
      if (
        existing?.contributeToGlobalKnowledge === contributeToGlobalKnowledge
      ) {
        return {
          contributeToGlobalKnowledge: existing.contributeToGlobalKnowledge,
          contributionConsentAt: existing.contributionConsentAt,
        };
      }
      const now = new Date();
      const settings = await tx.userAiSettings.upsert({
        where: { userId },
        create: {
          userId,
          contributeToGlobalKnowledge,
          contributionConsentAt: now,
        },
        update: { contributeToGlobalKnowledge, contributionConsentAt: now },
      });
      await tx.aiConsentEvent.create({
        data: {
          userId,
          contributeToGlobalKnowledge,
          reason: existing ? 'USER_CHANGE' : 'INITIAL_CHOICE',
        },
      });
      return {
        contributeToGlobalKnowledge: settings.contributeToGlobalKnowledge,
        contributionConsentAt: settings.contributionConsentAt,
      };
    });
  }
}
