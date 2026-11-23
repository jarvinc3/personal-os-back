import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import type { GmailSyncAttemptWriter } from './gmail-sync.attempt-writer';
import type { GmailClassificationBacklog } from './gmail-sync.backlog';
import type { GmailBootstrapSync } from './gmail-sync.bootstrap';
import { classifyError, safeErrorCode } from './gmail-sync.errors';
import type { GmailIncrementalSync } from './gmail-sync.incremental';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type {
  GmailConnectionRecord,
  GmailSyncPhase,
  GmailSyncRetryResult,
} from './gmail-sync.types';

type GmailPhaseResult = {
  imported: number;
  bootstrapComplete: boolean;
  recovered?: true;
};

export type GmailSyncRunResult =
  | { connected: false; imported: 0 }
  | ({ connected: true } & GmailPhaseResult)
  | GmailSyncRetryResult;

type GmailSyncRunnerDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  config: ConfigService<Env, true>;
  progress: GmailSyncProgressStore;
  bootstrap: GmailBootstrapSync;
  incremental: GmailIncrementalSync;
  backlog: GmailClassificationBacklog;
  attemptWriter: GmailSyncAttemptWriter;
  logger: Logger;
};

/** Ejecuta un intento de sincronización y deja su resultado y su fallo. */
export class GmailSyncRunner {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly config: ConfigService<Env, true>;
  private readonly progress: GmailSyncProgressStore;
  private readonly bootstrap: GmailBootstrapSync;
  private readonly incremental: GmailIncrementalSync;
  private readonly backlog: GmailClassificationBacklog;
  private readonly attemptWriter: GmailSyncAttemptWriter;
  private readonly logger: Logger;

  constructor({
    prisma,
    source,
    config,
    progress,
    bootstrap,
    incremental,
    backlog,
    attemptWriter,
    logger,
  }: GmailSyncRunnerDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.config = config;
    this.progress = progress;
    this.bootstrap = bootstrap;
    this.incremental = incremental;
    this.backlog = backlog;
    this.attemptWriter = attemptWriter;
    this.logger = logger;
  }

  async run({
    connectionId,
    scheduleRetry,
  }: {
    connectionId: string;
    scheduleRetry: (connectionId: string, delayMs: number) => void;
  }): Promise<GmailSyncRunResult> {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection?.isActive) {
      return { connected: false, imported: 0 };
    }
    const phase: GmailSyncPhase = connection.initialSyncCompletedAt
      ? 'incremental'
      : 'bootstrap';
    const attemptStartedAt = new Date();
    await this.startProgress({
      connection,
      phase,
      attemptStartedAt,
    });
    try {
      await this.markAttemptStarted({ connection, phase, attemptStartedAt });
      const accessToken = await this.source.getAccessToken(connectionId);
      const phaseResult = connection.initialSyncCompletedAt
        ? await this.incremental.run(connection, accessToken)
        : await this.bootstrap.run(connection, accessToken);
      return await this.finishAttempt({
        connection,
        phase,
        attemptStartedAt,
        phaseResult,
      });
    } catch (error) {
      const code = safeErrorCode(error);
      if (classifyError(code) === 'rate_limit') {
        return this.attemptWriter.retryAfterRateLimit({
          connectionId,
          userId: connection.userId,
          phase,
          attemptStartedAt,
          code,
          scheduleRetry,
        });
      }
      await this.attemptWriter.recordFailure({
        connection,
        phase,
        attemptStartedAt,
        code,
      });
      throw error;
    }
  }

  private async startProgress({
    connection,
    phase,
    attemptStartedAt,
  }: {
    connection: GmailConnectionRecord;
    phase: GmailSyncPhase;
    attemptStartedAt: Date;
  }): Promise<void> {
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: 'running',
        phase,
        attempt: 0,
        processedThisRun: 0,
        importedThisRun: 0,
        batchSize: 0,
        totalEstimate: undefined,
        retryAt: undefined,
        nextRunAt: undefined,
        errorCode: undefined,
        providerErrorCode: undefined,
        recoveryRange: undefined,
        errorCategory: undefined,
        startedAt: attemptStartedAt.toISOString(),
      },
    });
  }

  private async markAttemptStarted({
    connection,
    phase,
    attemptStartedAt,
  }: {
    connection: GmailConnectionRecord;
    phase: GmailSyncPhase;
    attemptStartedAt: Date;
  }): Promise<void> {
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncErrorCode: null,
        lastAttemptStartedAt: attemptStartedAt,
        lastAttemptFinishedAt: null,
        lastAttemptResult: null,
        lastAttemptErrorCode: null,
        lastAttemptErrorCategory: null,
        lastAttemptImportedCount: 0,
        lastAttemptPhase: phase,
      },
    });
  }

  private async finishAttempt({
    connection,
    phase,
    attemptStartedAt,
    phaseResult,
  }: {
    connection: GmailConnectionRecord;
    phase: GmailSyncPhase;
    attemptStartedAt: Date;
    phaseResult: GmailPhaseResult;
  }): Promise<GmailSyncRunResult> {
    // El intento y su fase describen la sincronización; el atraso de
    // clasificación corre después, con su propio estado y su propio tope.
    const syncPhase = this.progress.current(connection.id)?.phase ?? phase;
    const classification = await this.backlog.classify({
      connectionId: connection.id,
      userId: connection.userId,
    });
    const attemptFinishedAt = new Date();
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncedAt: attemptFinishedAt,
        lastSyncErrorCode: null,
        reconnectRequiredAt: null,
        lastAttemptStartedAt: attemptStartedAt,
        lastAttemptFinishedAt: attemptFinishedAt,
        lastAttemptResult: 'SUCCEEDED',
        lastAttemptErrorCode: null,
        lastAttemptErrorCategory: null,
        lastAttemptImportedCount: phaseResult.imported,
        lastAttemptPhase: syncPhase,
      },
    });
    const intervalMinutes = this.config.get('AI_EMAIL_SYNC_INTERVAL_MINUTES', {
      infer: true,
    });
    const backlogRemaining = classification.remaining > 0;
    const finished = phaseResult.bootstrapComplete && !backlogRemaining;
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: finished ? 'completed' : 'scheduled',
        phase: backlogRemaining ? 'classifying' : syncPhase,
        errorCode: classification.errorCode,
        rateLimitRetryCount: 0,
        nextRunAt: finished ? undefined : Date.now() + intervalMinutes * 60_000,
        retryAt: undefined,
        recoveryRange: undefined,
      },
    });
    return { connected: true, ...phaseResult };
  }
}
