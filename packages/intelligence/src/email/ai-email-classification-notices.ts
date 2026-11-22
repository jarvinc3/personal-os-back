import type { Logger } from '@nestjs/common';
import type { NotificationIntentSink } from '@personal-os/contracts';
import type { PrismaService } from '@personal-os/database';
import {
  startOfUtcDay,
  type EmailClassificationLimits,
} from './email-classification-limits';

type EmailClassificationNoticesDependencies = {
  prisma: PrismaService;
  limits: EmailClassificationLimits;
  logger: Logger;
  notifications?: NotificationIntentSink;
};

/** Los avisos internos que salen cuando se agota un cupo de clasificación. */
export class EmailClassificationNotices {
  private readonly prisma: PrismaService;
  private readonly limits: EmailClassificationLimits;
  private readonly logger: Logger;
  private readonly notifications?: NotificationIntentSink;

  constructor({
    prisma,
    limits,
    logger,
    notifications,
  }: EmailClassificationNoticesDependencies) {
    this.prisma = prisma;
    this.limits = limits;
    this.logger = logger;
    this.notifications = notifications;
  }

  async initialBudgetDepleted(userId: string): Promise<void> {
    const pending = await this.countUnclassified(userId);
    await this.limit({
      userId,
      key: 'INITIAL_BUDGET',
      title: 'Carga inicial agotada',
      body: `Se agotó la carga inicial de ${this.limits.initialBudget} clasificaciones; quedan ${pending} correos en cola y siguen en el próximo día UTC.`,
    });
  }

  async dailyBudgetExhausted(userId: string): Promise<void> {
    const pending = await this.countUnclassified(userId);
    await this.limit({
      userId,
      key: 'DAILY_BUDGET',
      title: 'Tope diario de clasificación',
      body: `Se agotó el tope diario de ${this.limits.dailyTokenBudget} tokens; quedan ${pending} correos en cola y siguen en el próximo día UTC.`,
    });
  }

  async costPaused(userId: string): Promise<void> {
    const pending = await this.countUnclassified(userId);
    await this.limit({
      userId,
      key: 'COST_PAUSED',
      title: 'Clasificación en pausa',
      body: `Se alcanzó el tope diario de ${this.limits.dailyCostLimitUsd} USD; quedan ${pending} correos en cola y siguen en el próximo día UTC.`,
    });
  }

  async costAlert(userId: string): Promise<void> {
    const pending = await this.countUnclassified(userId);
    await this.limit({
      userId,
      key: 'COST_ALERT',
      title: `Uso de clasificación al ${this.limits.costAlertRatio * 100} %`,
      body: `El piloto alcanzó el ${this.limits.costAlertRatio * 100} % del tope diario de ${this.limits.dailyCostLimitUsd} USD; quedan ${pending} correos en cola.`,
    });
  }

  private async limit({
    userId,
    key,
    title,
    body,
  }: {
    userId: string;
    key: string;
    title: string;
    body: string;
  }): Promise<void> {
    if (!this.notifications) {
      return;
    }
    try {
      await this.notifications.submit({
        schemaVersion: 1,
        userId,
        sourceDomain: 'INTELLIGENCE',
        type: 'AI_EMAIL_CLASSIFICATION_LIMIT',
        preferenceKey: `ai.email.${key.toLowerCase()}`,
        title,
        body,
        requestedChannels: ['IN_APP'],
        deduplicationKey: `ai-email-limit:${userId}:${key}:${startOfUtcDay(new Date()).toISOString()}`,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `Email classification notice failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Correos sin clasificar para el aviso de tope, incluido el que se está
   * procesando en este momento, que de otro modo descuenta uno.
   */
  private async countUnclassified(userId: string): Promise<number> {
    return this.prisma.aiEmailMessage.count({
      where: {
        userId,
        processingStatus: { in: ['INGESTED', 'QUEUED', 'CLASSIFYING'] },
      },
    });
  }
}
