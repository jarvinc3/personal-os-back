import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { AiEmailClassificationService } from './ai-email-classification.service';
import { CLASSIFICATION_FAILED_ERROR_CODE } from './gmail-sync.constants';
import { safeErrorCode } from './gmail-sync.errors';
import type { GmailSyncProgressStore } from './gmail-sync.progress';

type GmailClassificationBacklogDependencies = {
  classification: AiEmailClassificationService;
  config: ConfigService<Env, true>;
  progress: GmailSyncProgressStore;
  logger: Logger;
};

/** Clasifica el atraso en lotes dentro del tope de la corrida. */
export class GmailClassificationBacklog {
  private readonly classification: AiEmailClassificationService;
  private readonly config: ConfigService<Env, true>;
  private readonly progress: GmailSyncProgressStore;
  private readonly logger: Logger;

  constructor({
    classification,
    config,
    progress,
    logger,
  }: GmailClassificationBacklogDependencies) {
    this.classification = classification;
    this.config = config;
    this.progress = progress;
    this.logger = logger;
  }

  async classify({
    connectionId,
    userId,
  }: {
    connectionId: string;
    userId: string;
  }): Promise<{
    processed: number;
    remaining: number;
    errorCode?: string;
  }> {
    const pending = await this.classification.countPendingForUser(userId);
    if (pending === 0) {
      return { processed: 0, remaining: 0 };
    }
    const budgetMinutes = this.config.get(
      'AI_EMAIL_CLASSIFICATION_BUDGET_MINUTES',
      { infer: true },
    );
    const deadline = Date.now() + budgetMinutes * 60_000;
    await this.progress.update({
      connectionId,
      userId,
      patch: {
        status: 'running',
        phase: 'classifying',
        totalEstimate: pending,
        processedThisRun: 0,
      },
    });
    let processed = 0;
    let errorCode: string | undefined;
    try {
      while (processed < pending && Date.now() < deadline) {
        const batch = await this.classification.processPendingForUser(userId);
        if (batch.processed === 0) {
          break;
        }
        processed += batch.processed;
        await this.progress.update({
          connectionId,
          userId,
          patch: { phase: 'classifying' },
          delta: { processed: batch.processed, imported: 0 },
        });
      }
    } catch (error) {
      this.logger.warn(
        `Gmail classification failed for connection ${connectionId}: ${safeErrorCode(error)}`,
      );
      errorCode = CLASSIFICATION_FAILED_ERROR_CODE;
    }
    return {
      processed,
      remaining: Math.max(0, pending - processed),
      errorCode,
    };
  }
}
