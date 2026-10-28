import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import { AiKnowledgeService } from '../knowledge/ai-knowledge.service';

type ConsentRecord = {
  contributeToGlobalKnowledge: boolean;
  contributionConsentAt: Date;
};

type SavedConsent = {
  consent: ConsentRecord;
  revoked: boolean;
};

@Injectable()
export class AiConsentService {
  private readonly logger = new Logger(AiConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: AiKnowledgeService,
  ) {}

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
      const settings = await tx.userAiSettings.upsert({
        where: { userId },
        create: { userId, contributeToGlobalKnowledge: true },
        update: {},
      });
      if (!existing) {
        await tx.aiConsentEvent.create({
          data: {
            userId,
            contributeToGlobalKnowledge: true,
            reason: 'DEFAULT_ON',
          },
        });
      }
      return {
        contributeToGlobalKnowledge: settings.contributeToGlobalKnowledge,
        contributionConsentAt: settings.contributionConsentAt,
      };
    });
  }

  async update(userId: string, contributeToGlobalKnowledge: boolean) {
    const saved = await this.saveConsent(userId, contributeToGlobalKnowledge);
    if (saved.revoked) {
      await this.rebuildAfterRevocation(userId);
    }
    return saved.consent;
  }

  private async saveConsent(
    userId: string,
    contributeToGlobalKnowledge: boolean,
  ): Promise<SavedConsent> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.userAiSettings.findUnique({
        where: { userId },
      });
      if (
        existing?.contributeToGlobalKnowledge === contributeToGlobalKnowledge
      ) {
        return {
          consent: {
            contributeToGlobalKnowledge: existing.contributeToGlobalKnowledge,
            contributionConsentAt: existing.contributionConsentAt,
          },
          revoked: false,
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
      if (!contributeToGlobalKnowledge) {
        // Fail closed: revoked evidence must stop being usable even if the rebuild fails.
        await tx.aiKnowledge.updateMany({
          where: { scope: 'GLOBAL' },
          data: { state: 'REVIEW_REQUIRED', promotedBy: null },
        });
      }
      return {
        consent: {
          contributeToGlobalKnowledge: settings.contributeToGlobalKnowledge,
          contributionConsentAt: settings.contributionConsentAt,
        },
        revoked: !contributeToGlobalKnowledge,
      };
    });
  }

  private async rebuildAfterRevocation(userId: string): Promise<void> {
    try {
      await this.knowledge.rebuild(userId);
    } catch (error) {
      // The revocation and the fail-closed pause are already committed.
      this.logger.error(
        `AI knowledge rebuild failed after consent revocation for ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
