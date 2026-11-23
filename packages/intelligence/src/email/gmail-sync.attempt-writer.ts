import type { PrismaService } from '@personal-os/database';
import { GMAIL_RATE_LIMIT_COOLDOWN_MS } from './gmail-sync.constants';
import { classifyError } from './gmail-sync.errors';
import type { GmailSyncProgressStore } from './gmail-sync.progress';
import type {
  GmailConnectionRecord,
  GmailSyncPhase,
  GmailSyncRetryResult,
} from './gmail-sync.types';
import { requiresGmailReconnect } from './gmail-reconnect.util';

type GmailSyncAttemptWriterDependencies = {
  prisma: PrismaService;
  progress: GmailSyncProgressStore;
};

/** Deja en la conexión y en el avance el resultado fallido de un intento. */
export class GmailSyncAttemptWriter {
  private readonly prisma: PrismaService;
  private readonly progress: GmailSyncProgressStore;

  constructor({ prisma, progress }: GmailSyncAttemptWriterDependencies) {
    this.prisma = prisma;
    this.progress = progress;
  }

  async retryAfterRateLimit({
    connectionId,
    userId,
    phase,
    attemptStartedAt,
    code,
    scheduleRetry,
  }: {
    connectionId: string;
    userId: string;
    phase: GmailSyncPhase;
    attemptStartedAt: Date;
    code: string;
    scheduleRetry: (connectionId: string, delayMs: number) => void;
  }): Promise<GmailSyncRetryResult> {
    const rateLimitRetryCount =
      (this.progress.current(connectionId)?.rateLimitRetryCount ?? 0) + 1;
    const retryDelay = Math.min(
      GMAIL_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitRetryCount - 1),
      15 * 60_000,
    );
    const retryAt = Date.now() + retryDelay;
    const attemptFinishedAt = new Date();
    const attemptPhase = this.progress.current(connectionId)?.phase ?? phase;
    const importedThisRun =
      this.progress.current(connectionId)?.importedThisRun ?? 0;
    await this.prisma.aiEmailConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncErrorCode: null,
        lastAttemptStartedAt: attemptStartedAt,
        lastAttemptFinishedAt: attemptFinishedAt,
        lastAttemptResult: 'FAILED',
        lastAttemptErrorCode: code,
        lastAttemptErrorCategory: 'rate_limit',
        lastAttemptImportedCount: importedThisRun,
        lastAttemptPhase: attemptPhase,
        lastFailureAt: attemptFinishedAt,
        lastFailureErrorCode: code,
        lastFailureErrorCategory: 'rate_limit',
        lastFailureImportedCount: importedThisRun,
        lastFailurePhase: attemptPhase,
      },
    });
    await this.progress.update({
      connectionId,
      userId,
      patch: {
        status: 'waiting',
        errorCode: 'rate_limit_retry_scheduled',
        providerErrorCode: code,
        errorCategory: 'rate_limit',
        rateLimitRetryCount,
        retryAt,
        nextRunAt: undefined,
      },
    });
    scheduleRetry(connectionId, retryAt - Date.now());
    return { connected: true, imported: 0, retryScheduled: true };
  }

  async recordFailure({
    connection,
    phase,
    attemptStartedAt,
    code,
  }: {
    connection: GmailConnectionRecord;
    phase: GmailSyncPhase;
    attemptStartedAt: Date;
    code: string;
  }): Promise<void> {
    const category = classifyError(code);
    const attemptFinishedAt = new Date();
    const attemptPhase = this.progress.current(connection.id)?.phase ?? phase;
    const importedThisRun =
      this.progress.current(connection.id)?.importedThisRun ?? 0;
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncErrorCode: code,
        ...(requiresGmailReconnect(code)
          ? { reconnectRequiredAt: attemptFinishedAt }
          : {}),
        lastAttemptStartedAt: attemptStartedAt,
        lastAttemptFinishedAt: attemptFinishedAt,
        lastAttemptResult: 'FAILED',
        lastAttemptErrorCode: code,
        lastAttemptErrorCategory: category,
        lastAttemptImportedCount: importedThisRun,
        lastAttemptPhase: attemptPhase,
        lastFailureAt: attemptFinishedAt,
        lastFailureErrorCode: code,
        lastFailureErrorCategory: category,
        lastFailureImportedCount: importedThisRun,
        lastFailurePhase: attemptPhase,
      },
    });
    await this.progress.update({
      connectionId: connection.id,
      userId: connection.userId,
      patch: {
        status: 'failed',
        errorCode: code,
        errorCategory: category,
        retryAt: undefined,
        nextRunAt: undefined,
      },
    });
  }
}
