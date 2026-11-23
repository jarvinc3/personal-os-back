import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import {
  GMAIL_RATE_LIMIT_COOLDOWN_MS,
  SYNC_STALLED_ERROR_CODE,
} from './gmail-sync.constants';
import type { GmailSyncConnectionRegistry } from './gmail-sync.connection-registry';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type { GmailSyncProgress } from './gmail-sync.types';

type StoredConnectionState = {
  id: string;
  userId: string;
  syncState: unknown;
};

type GmailSyncWatchdogDependencies = {
  prisma: PrismaService;
  config: ConfigService<Env, true>;
  progress: GmailSyncProgressStore;
  registry: GmailSyncConnectionRegistry;
  logger: Logger;
};

/** Recupera estados interrumpidos y libera corridas detenidas. */
export class GmailSyncWatchdog {
  private readonly prisma: PrismaService;
  private readonly config: ConfigService<Env, true>;
  private readonly progress: GmailSyncProgressStore;
  private readonly registry: GmailSyncConnectionRegistry;
  private readonly logger: Logger;

  constructor({
    prisma,
    config,
    progress,
    registry,
    logger,
  }: GmailSyncWatchdogDependencies) {
    this.prisma = prisma;
    this.config = config;
    this.progress = progress;
    this.registry = registry;
    this.logger = logger;
  }

  async recoverStates({
    scheduleRetry,
  }: {
    scheduleRetry: (connectionId: string, delayMs: number) => void;
  }): Promise<void> {
    const connections = await this.prisma.aiEmailConnection.findMany({
      where: { isActive: true },
      select: { id: true, userId: true, syncState: true },
    });
    for (const connection of connections) {
      const state = connection.syncState as GmailSyncProgress | null;
      if (state?.status === 'failed' && state.errorCategory === 'rate_limit') {
        await this.recoverRateLimitFailure({
          connection,
          state,
          scheduleRetry,
        });
        continue;
      }
      if (
        state?.status === 'waiting' &&
        state.errorCode === 'rate_limit_retry_scheduled' &&
        state.retryAt
      ) {
        this.progress.set(connection.id, state);
        scheduleRetry(connection.id, Math.max(0, state.retryAt - Date.now()));
        continue;
      }
      if (
        !state ||
        !['running', 'waiting', 'retrying'].includes(state.status)
      ) {
        continue;
      }
      await this.markInterrupted({ connection, state });
    }
  }

  async markStalled(): Promise<void> {
    const stallMs =
      this.config.get('AI_EMAIL_SYNC_STALL_MINUTES', { infer: true }) * 60_000;
    const connections = await this.prisma.aiEmailConnection.findMany({
      where: { isActive: true },
      select: { id: true, userId: true, syncState: true },
    });
    const now = Date.now();
    for (const connection of connections) {
      if (this.registry.isActive(connection.id)) {
        continue;
      }
      const state = connection.syncState as GmailSyncProgress | null;
      if (state?.status !== 'running') {
        continue;
      }
      const updatedAt = Date.parse(state.updatedAt);
      if (!Number.isFinite(updatedAt) || now - updatedAt < stallMs) {
        continue;
      }
      this.progress.set(connection.id, state);
      await this.progress.update({
        connectionId: connection.id,
        userId: connection.userId,
        patch: {
          status: 'failed',
          errorCode: SYNC_STALLED_ERROR_CODE,
          errorCategory: 'temporary',
          retryAt: undefined,
          nextRunAt: undefined,
        },
      });
      await this.prisma.aiEmailConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncErrorCode: SYNC_STALLED_ERROR_CODE,
          lastFailureAt: new Date(now),
          lastFailureErrorCode: SYNC_STALLED_ERROR_CODE,
          lastFailureErrorCategory: 'temporary',
          lastFailureImportedCount: state.importedThisRun ?? 0,
          lastFailurePhase: state.phase,
        },
      });
      this.logger.warn(
        `Gmail sync stalled for connection ${connection.id}; marked as failed`,
      );
    }
  }

  private async recoverRateLimitFailure({
    connection,
    state,
    scheduleRetry,
  }: {
    connection: StoredConnectionState;
    state: GmailSyncProgress;
    scheduleRetry: (connectionId: string, delayMs: number) => void;
  }): Promise<void> {
    const rateLimitRetryCount = (state.rateLimitRetryCount ?? 0) + 1;
    const retryDelay = Math.min(
      GMAIL_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitRetryCount - 1),
      15 * 60_000,
    );
    const retryAt = Date.now() + retryDelay;
    this.progress.set(connection.id, state);
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: { lastSyncErrorCode: null },
    });
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: 'waiting',
        errorCode: 'rate_limit_retry_scheduled',
        providerErrorCode: state.providerErrorCode ?? state.errorCode,
        errorCategory: 'rate_limit',
        rateLimitRetryCount,
        retryAt,
        nextRunAt: undefined,
      },
    });
    scheduleRetry(connection.id, retryDelay);
  }

  private async markInterrupted({
    connection,
    state,
  }: {
    connection: StoredConnectionState;
    state: GmailSyncProgress;
  }): Promise<void> {
    this.progress.set(connection.id, state);
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: 'failed',
        errorCode: 'worker_interrupted',
        errorCategory: 'temporary',
        retryAt: undefined,
        nextRunAt: undefined,
      },
    });
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        lastAttemptStartedAt: state.startedAt
          ? new Date(state.startedAt)
          : undefined,
        lastAttemptFinishedAt: new Date(),
        lastAttemptResult: 'INTERRUPTED',
        lastAttemptErrorCode: 'worker_interrupted',
        lastAttemptErrorCategory: null,
        lastAttemptImportedCount: state.importedThisRun ?? 0,
        lastAttemptPhase: state.phase,
      },
    });
  }
}
