import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import type { PrismaService } from '@personal-os/database';
import type { AiEmailSourceService } from './ai-email-source.service';
import { SYNC_WATCHDOG_INTERVAL_MS } from './gmail-sync.constants';
import type { GmailSyncConnectionRegistry } from './gmail-sync.connection-registry';
import { safeErrorCode } from './gmail-sync.errors';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type { GmailSyncRunner } from './gmail-sync.runner';
import type { GmailSyncProgress } from './gmail-sync.types';
import type { GmailSyncWatchdog } from './gmail-sync.watchdog';

type GmailSyncSchedulerDependencies = {
  prisma: PrismaService;
  source: AiEmailSourceService;
  config: ConfigService<Env, true>;
  progress: GmailSyncProgressStore;
  runner: GmailSyncRunner;
  watchdog: GmailSyncWatchdog;
  registry: GmailSyncConnectionRegistry;
  logger: Logger;
};

/** Ciclo automático, toma de conexiones y estados de avance. */
export class GmailSyncScheduler {
  private readonly prisma: PrismaService;
  private readonly source: AiEmailSourceService;
  private readonly config: ConfigService<Env, true>;
  private readonly progress: GmailSyncProgressStore;
  private readonly runner: GmailSyncRunner;
  private readonly watchdog: GmailSyncWatchdog;
  private readonly registry: GmailSyncConnectionRegistry;
  private readonly logger: Logger;
  private timer?: NodeJS.Timeout;
  private watchdogTimer?: NodeJS.Timeout;
  private running = false;
  private watchdogRunning = false;

  constructor({
    prisma,
    source,
    config,
    progress,
    runner,
    watchdog,
    registry,
    logger,
  }: GmailSyncSchedulerDependencies) {
    this.prisma = prisma;
    this.source = source;
    this.config = config;
    this.progress = progress;
    this.runner = runner;
    this.watchdog = watchdog;
    this.registry = registry;
    this.logger = logger;
  }

  start(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }
    void this.watchdog
      .recoverStates({
        scheduleRetry: (connectionId, delayMs) =>
          this.scheduleRateLimitRetry(connectionId, delayMs),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Unable to recover Gmail sync state: ${safeErrorCode(error)}`,
        );
      });
    const oauthDiagnostics = this.source.oauthDiagnostics();
    if (!oauthDiagnostics.configured) {
      this.logger.warn(
        `Gmail OAuth is not configured (${oauthDiagnostics.status}); automatic sync is disabled until the API restarts with AI_GMAIL_CLIENT_ID, AI_GMAIL_CLIENT_SECRET, AI_GMAIL_REDIRECT_URI, AI_GMAIL_TOKEN_ENCRYPTION_KEY and OAUTH_STATE_SECRET set.`,
      );
      return;
    }
    const intervalMinutes = this.config.get('AI_EMAIL_SYNC_INTERVAL_MINUTES', {
      infer: true,
    });
    this.timer = setInterval(
      () =>
        void this.syncAllActiveConnections().catch((error: unknown) => {
          this.logger.warn(`Gmail sync cycle failed: ${safeErrorCode(error)}`);
        }),
      intervalMinutes * 60_000,
    );
    this.timer.unref();
    this.watchdogTimer = setInterval(
      () =>
        void this.markStalledSyncs().catch((error: unknown) => {
          this.logger.warn(
            `Gmail sync watchdog failed: ${safeErrorCode(error)}`,
          );
        }),
      SYNC_WATCHDOG_INTERVAL_MS,
    );
    this.watchdogTimer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }
    this.registry.clearAllRetries();
  }

  async syncForUser(userId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!connection) {
      return { connected: false, syncStarted: false };
    }
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: { lastSyncErrorCode: null },
    });
    return {
      connected: true,
      syncStarted: this.startSyncConnection(connection.id),
    };
  }

  async syncAllActiveConnections(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const connections = await this.listSyncableConnections();
      for (const connection of connections) {
        try {
          await this.syncConnection(connection.id);
        } catch (error) {
          this.logger.warn(
            `Gmail sync failed for connection ${connection.id}: ${safeErrorCode(error)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  async markStalledSyncs(): Promise<void> {
    if (this.watchdogRunning) {
      return;
    }
    this.watchdogRunning = true;
    try {
      await this.watchdog.markStalled();
    } finally {
      this.watchdogRunning = false;
    }
  }

  async syncConnection(connectionId: string) {
    if (this.registry.isResetting(connectionId)) {
      return { connected: false, imported: 0, resetInProgress: true };
    }
    if (this.registry.isActive(connectionId)) {
      return {
        connected: true,
        imported: 0,
        bootstrapComplete: false,
        alreadyRunning: true,
      };
    }
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { id: connectionId },
      select: { isActive: true, syncState: true },
    });
    const storedState = connection?.syncState as GmailSyncProgress | null;
    if (
      connection?.isActive &&
      storedState?.status === 'waiting' &&
      storedState.errorCode === 'rate_limit_retry_scheduled' &&
      storedState.retryAt &&
      storedState.retryAt > Date.now()
    ) {
      return {
        connected: true,
        imported: 0,
        retryScheduled: true,
        nextRunAt: storedState.retryAt,
      };
    }
    this.registry.clearRetry(connectionId);
    this.registry.markActive(connectionId);
    try {
      return await this.runner.run({
        connectionId,
        scheduleRetry: (retryConnectionId, delayMs) =>
          this.scheduleRateLimitRetry(retryConnectionId, delayMs),
      });
    } finally {
      this.registry.endSync(connectionId);
    }
  }

  async snapshot(userId: string): Promise<{
    syncProgress: GmailSyncProgress | null;
    syncInProgress: boolean;
  }> {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { id: true, syncState: true },
    });
    const stored = connection?.syncState;
    const syncProgress = stored
      ? (stored as unknown as GmailSyncProgress)
      : null;
    return {
      syncProgress,
      syncInProgress:
        Boolean(connection && this.registry.isActive(connection.id)) ||
        syncProgress?.status === 'running' ||
        syncProgress?.status === 'waiting' ||
        syncProgress?.status === 'retrying',
    };
  }

  private startSyncConnection(connectionId: string): boolean {
    if (this.registry.hasActiveOrResetting(connectionId)) {
      return false;
    }
    this.registry.clearRetry(connectionId);
    this.registry.markActive(connectionId);
    void this.runner
      .run({
        connectionId,
        scheduleRetry: (retryConnectionId, delayMs) =>
          this.scheduleRateLimitRetry(retryConnectionId, delayMs),
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Gmail sync failed for connection ${connectionId}: ${safeErrorCode(error)}`,
        );
      })
      .finally(() => {
        this.registry.endSync(connectionId);
      });
    return true;
  }

  private scheduleRateLimitRetry(connectionId: string, delayMs: number): void {
    this.registry.scheduleRateLimitRetry(connectionId, delayMs, () => {
      this.startSyncConnection(connectionId);
    });
  }

  private async listSyncableConnections(): Promise<Array<{ id: string }>> {
    try {
      return await this.prisma.aiEmailConnection.findMany({
        where: { isActive: true, reconnectRequiredAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to list Gmail connections: ${safeErrorCode(error)}`,
      );
      return [];
    }
  }
}
