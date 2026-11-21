import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Env } from '@personal-os/config';
import { AppEvents } from '@personal-os/core';
import { PrismaService } from '@personal-os/database';
import { createHash } from 'node:crypto';
import { AiEmailSourceService } from './ai-email-source.service';
import { requiresGmailReconnect } from './gmail-reconnect.util';
import { AiDataDeletionService } from '../knowledge/ai-data-deletion.service';
import { AiEmailClassificationService } from './ai-email-classification.service';
import {
  matchesSenderFilter,
  narrowerSenderFilter,
} from './gmail-import-scope';

const BOOTSTRAP_START = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const SCOPED_BHD_SENDER = 'bhd.com.do';
const RECOVERY_WINDOW_MS = 7 * 86400_000;
const RAW_RETENTION_DEV_DAYS = 30;
const RAW_RETENTION_PROD_DAYS = 7;
const GMAIL_MESSAGE_FETCH_CONCURRENCY = 3;
const GMAIL_RATE_LIMIT_COOLDOWN_MS = 60_000;
const GMAIL_NOT_CONNECTED = 'GMAIL_NOT_CONNECTED';
const GMAIL_SYNC_IN_PROGRESS = 'GMAIL_SYNC_IN_PROGRESS';
const SYNC_STALLED_ERROR_CODE = 'sync_stalled';
const CLASSIFICATION_FAILED_ERROR_CODE = 'classification_failed';
const SYNC_WATCHDOG_INTERVAL_MS = 60_000;

type MessageImportFilters = {
  importStartAt: Date | null;
  senderFilter: string | null;
};

/** Consulta de Gmail con el corte de fecha y el remitente de la conexión. */
function gmailScopeQuery({
  afterSeconds,
  beforeSeconds,
  senderFilter,
}: {
  afterSeconds: number;
  beforeSeconds?: number;
  senderFilter: string | null;
}): string {
  const parts = [`after:${afterSeconds}`];
  if (beforeSeconds) {
    parts.push(`before:${beforeSeconds}`);
  }
  if (senderFilter) {
    parts.push(`from:${senderFilter}`);
  }
  return parts.join(' ');
}

function importFiltersOf(connection: {
  importStartAt: Date | null;
  senderFilter: string | null;
}): MessageImportFilters {
  return {
    importStartAt: connection.importStartAt,
    senderFilter: connection.senderFilter,
  };
}

type MessageEnvelope = {
  headers: Map<string, string>;
  fromAddress: string;
  fromDomain: string;
  receivedAt: Date;
};

function readMessageEnvelope(message: GmailMessage): MessageEnvelope {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name.toLowerCase(),
      header.value,
    ]),
  );
  const fromHeader = headers.get('from') ?? '';
  const fromAddress =
    fromHeader.match(/<([^>]+)>/)?.[1]?.trim() ?? fromHeader.trim();
  const fromDomain = fromAddress.split('@').at(-1)?.toLowerCase() ?? '';
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate))
    : new Date(headers.get('date') ?? Date.now());
  return { headers, fromAddress, fromDomain, receivedAt };
}

function isWithinImportScope({
  envelope,
  filters,
}: {
  envelope: MessageEnvelope;
  filters: MessageImportFilters;
}): boolean {
  if (filters.importStartAt && envelope.receivedAt < filters.importStartAt) {
    return false;
  }
  if (
    filters.senderFilter &&
    !matchesSenderFilter({
      fromDomain: envelope.fromDomain,
      senderFilter: filters.senderFilter,
    })
  ) {
    return false;
  }
  return true;
}

type ScopedBhdSyncScope = {
  dateFrom: Date;
  dateTo: Date;
  maxMessages: number;
  pageToken?: string;
};

type ScopedBhdSyncResult = {
  connected: true;
  query: string;
  found: number;
  imported: number;
  skipped: number;
  nextPageToken: string | null;
  estimatedTotal: number | null;
};

type GmailSyncProgress = {
  status:
    'running' | 'waiting' | 'retrying' | 'scheduled' | 'completed' | 'failed';
  phase: 'bootstrap' | 'incremental' | 'recovery' | 'classifying';
  attempt: number;
  rateLimitRetryCount?: number;
  processedThisRun: number;
  importedThisRun: number;
  batchSize?: number;
  totalEstimate?: number;
  retryAt?: number;
  nextRunAt?: number;
  errorCode?: string;
  providerErrorCode?: string;
  recoveryRange?: { from: string; to: string };
  errorCategory?:
    'authorization' | 'configuration' | 'rate_limit' | 'temporary' | 'unknown';
  startedAt: string;
  updatedAt: string;
};

type GmailSyncProgressPatch = Partial<GmailSyncProgress>;

type GmailMessageList = {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type GmailHistoryPage = {
  historyId?: string;
  nextPageToken?: string;
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
};

type GmailPart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

@Injectable()
export class GmailSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GmailSyncService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly activeSyncConnections = new Set<string>();
  private readonly resettingConnections = new Set<string>();
  private readonly syncProgress = new Map<string, GmailSyncProgress>();
  private readonly syncStateWrites = new Map<string, Promise<void>>();
  private readonly rateLimitRetryTimers = new Map<string, NodeJS.Timeout>();
  private watchdogTimer?: NodeJS.Timeout;
  private watchdogRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: AiEmailSourceService,
    private readonly config: ConfigService<Env, true>,
    private readonly eventEmitter: EventEmitter2,
    private readonly deletion: AiDataDeletionService,
    private readonly classification: AiEmailClassificationService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      return;
    }
    void this.recoverSyncStates().catch((error: unknown) => {
      this.logger.warn(
        `Unable to recover Gmail sync state: ${this.safeErrorCode(error)}`,
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
          this.logger.warn(
            `Gmail sync cycle failed: ${this.safeErrorCode(error)}`,
          );
        }),
      intervalMinutes * 60_000,
    );
    this.timer.unref();
    this.watchdogTimer = setInterval(
      () =>
        void this.markStalledSyncs().catch((error: unknown) => {
          this.logger.warn(
            `Gmail sync watchdog failed: ${this.safeErrorCode(error)}`,
          );
        }),
      SYNC_WATCHDOG_INTERVAL_MS,
    );
    this.watchdogTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
    }
    for (const retryTimer of this.rateLimitRetryTimers.values()) {
      clearTimeout(retryTimer);
    }
    this.rateLimitRetryTimers.clear();
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

  async isSyncingForUser(userId: string) {
    return (await this.getSyncSnapshotForUser(userId)).syncInProgress;
  }

  /**
   * Sync acotada del piloto: solo BHD y con un tope por página. No cambia el
   * cursor del bootstrap ni el estado de la sync normal.
   */
  async syncScopedBhdForUser(
    userId: string,
    scope: ScopedBhdSyncScope,
  ): Promise<ScopedBhdSyncResult> {
    if (scope.dateFrom > scope.dateTo) {
      throw new BadRequestException('dateFrom no puede ser posterior a dateTo');
    }
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: {
        id: true,
        userId: true,
        isActive: true,
        importStartAt: true,
        senderFilter: true,
      },
    });
    if (!connection?.isActive) {
      throw new ConflictException({
        code: GMAIL_NOT_CONNECTED,
        message: 'No hay una cuenta de Gmail conectada.',
      });
    }
    if (this.activeSyncConnections.has(connection.id)) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message: 'Ya hay una sincronización en curso. Espera a que termine.',
      });
    }
    this.activeSyncConnections.add(connection.id);
    try {
      const senderScope = connection.senderFilter
        ? narrowerSenderFilter({
            first: SCOPED_BHD_SENDER,
            second: connection.senderFilter,
          })
        : SCOPED_BHD_SENDER;
      if (!senderScope) {
        throw new BadRequestException(
          `La conexión importa solo correo de ${connection.senderFilter}; la sync acotada es de BHD.`,
        );
      }
      const effectiveFrom =
        connection.importStartAt && connection.importStartAt > scope.dateFrom
          ? connection.importStartAt
          : scope.dateFrom;
      const accessToken = await this.source.getAccessToken(connection.id);
      const query = `from:${senderScope} after:${Math.floor(effectiveFrom.getTime() / 1000)} before:${gmailQueryDate(scope.dateTo)}`;
      if (effectiveFrom > scope.dateTo) {
        return {
          connected: true,
          query,
          found: 0,
          imported: 0,
          skipped: 0,
          nextPageToken: null,
          estimatedTotal: 0,
        };
      }
      const params = new URLSearchParams({
        q: query,
        maxResults: String(scope.maxMessages),
      });
      if (scope.pageToken) {
        params.set('pageToken', scope.pageToken);
      }
      const page = await this.source.gmailApiRequest<GmailMessageList>(
        accessToken,
        `/users/me/messages?${params}`,
        (state) =>
          this.updateSyncProgress(connection.id, connection.userId, {
            ...state,
            retryAt: state.retryAt,
          }),
      );
      const refs = page.messages ?? [];
      const imported = await this.importMessageBatch({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        refs,
        filters: importFiltersOf(connection),
        scopeAppliedInQuery: !(
          connection.importStartAt || connection.senderFilter
        ),
      });
      return {
        connected: true,
        query,
        found: refs.length,
        imported,
        skipped: refs.length - imported,
        nextPageToken: page.nextPageToken ?? null,
        estimatedTotal: page.resultSizeEstimate ?? null,
      };
    } finally {
      this.activeSyncConnections.delete(connection.id);
    }
  }

  async getProgressForUser(userId: string) {
    return (await this.getSyncSnapshotForUser(userId)).syncProgress;
  }

  async getSyncSnapshotForUser(userId: string) {
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
        Boolean(connection && this.activeSyncConnections.has(connection.id)) ||
        syncProgress?.status === 'running' ||
        syncProgress?.status === 'waiting' ||
        syncProgress?.status === 'retrying',
    };
  }

  async resetEmailCorpus(userId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { id: true, syncState: true },
    });
    if (!connection) {
      throw new ConflictException({
        code: GMAIL_NOT_CONNECTED,
        message:
          'No hay una cuenta de Gmail conectada; no hay corpus que reiniciar.',
      });
    }
    if (this.activeSyncConnections.has(connection.id)) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message:
          'Espera a que termine la sincronización antes de reiniciar el correo.',
      });
    }
    const existingState = connection.syncState as GmailSyncProgress | null;
    if (
      existingState &&
      ['running', 'waiting', 'retrying'].includes(existingState.status)
    ) {
      throw new ConflictException({
        code: GMAIL_SYNC_IN_PROGRESS,
        message:
          'La sincronización sigue activa. Actualiza el estado e inténtalo de nuevo.',
      });
    }
    this.resettingConnections.add(connection.id);
    const retryTimer = this.rateLimitRetryTimers.get(connection.id);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.rateLimitRetryTimers.delete(connection.id);
    }
    try {
      const { deletedMessages } = await this.deletion.removeEmailData({
        userId,
      });
      this.syncProgress.delete(connection.id);
      return { connected: true, deletedMessages };
    } finally {
      this.resettingConnections.delete(connection.id);
    }
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
            `Gmail sync failed for connection ${connection.id}: ${this.safeErrorCode(error)}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Libera conexiones que quedaron en `running` sin avance. Solo actúa cuando
   * ninguna corrida de este proceso tiene la conexión tomada: las llamadas
   * colgadas de una corrida viva las cortan los timeouts de fetch.
   */
  async markStalledSyncs(): Promise<void> {
    if (this.watchdogRunning) {
      return;
    }
    this.watchdogRunning = true;
    try {
      const stallMs =
        this.config.get('AI_EMAIL_SYNC_STALL_MINUTES', { infer: true }) *
        60_000;
      const connections = await this.prisma.aiEmailConnection.findMany({
        where: { isActive: true },
        select: { id: true, userId: true, syncState: true },
      });
      const now = Date.now();
      for (const connection of connections) {
        if (this.activeSyncConnections.has(connection.id)) {
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
        this.syncProgress.set(connection.id, state);
        await this.updateSyncProgress(connection.id, connection.userId, {
          status: 'failed',
          errorCode: SYNC_STALLED_ERROR_CODE,
          errorCategory: 'temporary',
          retryAt: undefined,
          nextRunAt: undefined,
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
    } finally {
      this.watchdogRunning = false;
    }
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
        `Unable to list Gmail connections: ${this.safeErrorCode(error)}`,
      );
      return [];
    }
  }

  async syncConnection(connectionId: string) {
    if (this.resettingConnections.has(connectionId)) {
      return { connected: false, imported: 0, resetInProgress: true };
    }
    if (this.activeSyncConnections.has(connectionId)) {
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
    const retryTimer = this.rateLimitRetryTimers.get(connectionId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.rateLimitRetryTimers.delete(connectionId);
    }
    this.activeSyncConnections.add(connectionId);
    try {
      return await this.runSyncConnection(connectionId);
    } finally {
      this.activeSyncConnections.delete(connectionId);
    }
  }

  private startSyncConnection(connectionId: string) {
    if (
      this.activeSyncConnections.has(connectionId) ||
      this.resettingConnections.has(connectionId)
    ) {
      return false;
    }
    const retryTimer = this.rateLimitRetryTimers.get(connectionId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.rateLimitRetryTimers.delete(connectionId);
    }
    this.activeSyncConnections.add(connectionId);
    void this.runSyncConnection(connectionId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Gmail sync failed for connection ${connectionId}: ${this.safeErrorCode(error)}`,
        );
      })
      .finally(() => {
        this.activeSyncConnections.delete(connectionId);
      });
    return true;
  }

  private async runSyncConnection(connectionId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection?.isActive) {
      return { connected: false, imported: 0 };
    }
    const phase = connection.initialSyncCompletedAt
      ? 'incremental'
      : 'bootstrap';
    const attemptStartedAt = new Date();
    await this.updateSyncProgress(connection.id, connection.userId, {
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
    });
    try {
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
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
      const accessToken = await this.source.getAccessToken(connectionId);
      const result = connection.initialSyncCompletedAt
        ? await this.syncIncremental(connection, accessToken)
        : await this.bootstrapPage(connection, accessToken);
      // El intento y su fase describen la sincronización; el atraso de
      // clasificación corre después, con su propio estado y su propio tope.
      const syncPhase = this.syncProgress.get(connection.id)?.phase ?? phase;
      const classification = await this.classifyPendingBacklog({
        connectionId: connection.id,
        userId: connection.userId,
      });
      const attemptFinishedAt = new Date();
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncedAt: attemptFinishedAt,
          lastSyncErrorCode: null,
          reconnectRequiredAt: null,
          lastAttemptStartedAt: attemptStartedAt,
          lastAttemptFinishedAt: attemptFinishedAt,
          lastAttemptResult: 'SUCCEEDED',
          lastAttemptErrorCode: null,
          lastAttemptErrorCategory: null,
          lastAttemptImportedCount: result.imported,
          lastAttemptPhase: syncPhase,
        },
      });
      const intervalMinutes = this.config.get(
        'AI_EMAIL_SYNC_INTERVAL_MINUTES',
        { infer: true },
      );
      const backlogRemaining = classification.remaining > 0;
      const finished = result.bootstrapComplete && !backlogRemaining;
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: finished ? 'completed' : 'scheduled',
        phase: backlogRemaining ? 'classifying' : syncPhase,
        errorCode: classification.errorCode,
        rateLimitRetryCount: 0,
        nextRunAt: finished ? undefined : Date.now() + intervalMinutes * 60_000,
        retryAt: undefined,
        recoveryRange: undefined,
      });
      return { connected: true, ...result };
    } catch (error) {
      const code = this.safeErrorCode(error);
      if (this.classifyError(code) === 'rate_limit') {
        const rateLimitRetryCount =
          (this.syncProgress.get(connectionId)?.rateLimitRetryCount ?? 0) + 1;
        const retryDelay = Math.min(
          GMAIL_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitRetryCount - 1),
          15 * 60_000,
        );
        const retryAt = Date.now() + retryDelay;
        const attemptFinishedAt = new Date();
        const attemptPhase =
          this.syncProgress.get(connectionId)?.phase ?? phase;
        const importedThisRun =
          this.syncProgress.get(connectionId)?.importedThisRun ?? 0;
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
        await this.updateSyncProgress(connection.id, connection.userId, {
          status: 'waiting',
          errorCode: 'rate_limit_retry_scheduled',
          providerErrorCode: code,
          errorCategory: 'rate_limit',
          rateLimitRetryCount,
          retryAt,
          nextRunAt: undefined,
        });
        this.scheduleRateLimitRetry(connection.id, retryAt - Date.now());
        return { connected: true, imported: 0, retryScheduled: true };
      }
      const category = this.classifyError(code);
      const attemptFinishedAt = new Date();
      const attemptPhase = this.syncProgress.get(connectionId)?.phase ?? phase;
      const importedThisRun =
        this.syncProgress.get(connectionId)?.importedThisRun ?? 0;
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
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
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: 'failed',
        errorCode: code,
        errorCategory: category,
        retryAt: undefined,
        nextRunAt: undefined,
      });
      throw error;
    }
  }

  private async updateSyncProgress(
    connectionId: string,
    userId: string,
    patch: GmailSyncProgressPatch,
    delta?: { processed: number; imported: number },
  ) {
    const previousWrite =
      this.syncStateWrites.get(connectionId) ?? Promise.resolve();
    const nextWrite = previousWrite.then(async () => {
      const current = this.syncProgress.get(connectionId) ?? {
        status: 'running' as const,
        phase: 'bootstrap' as const,
        attempt: 0,
        processedThisRun: 0,
        importedThisRun: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const state: GmailSyncProgress = {
        ...current,
        ...patch,
        processedThisRun:
          (patch.processedThisRun ?? current.processedThisRun) +
          (delta?.processed ?? 0),
        importedThisRun:
          (patch.importedThisRun ?? current.importedThisRun) +
          (delta?.imported ?? 0),
        updatedAt: new Date().toISOString(),
      };
      this.syncProgress.set(connectionId, state);
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { syncState: JSON.parse(JSON.stringify(state)) },
      });
      this.eventEmitter.emit(AppEvents.AI_EMAIL_SYNC_UPDATED, {
        userId,
        state,
      });
    });
    this.syncStateWrites.set(
      connectionId,
      nextWrite.catch(() => undefined),
    );
    await nextWrite;
  }

  private classifyError(code: string): GmailSyncProgress['errorCategory'] {
    const normalized = code.toLowerCase();
    if (
      /invalid_grant|token_refresh|refresh_token|unauthorized|unauthenticated|autherror|http_401|http_403|forbidden|insufficientpermissions|permission_denied|access_denied/.test(
        normalized,
      )
    ) {
      return 'authorization';
    }
    if (
      /not_configured|missing_configuration|redirect_uri_mismatch|invalid_client/.test(
        normalized,
      )
    ) {
      return 'configuration';
    }
    if (
      /ratelimit|quota|userratelimit|http_429|resource_exhausted/.test(
        normalized,
      )
    ) {
      return 'rate_limit';
    }
    if (
      /timeout|network|fetch|http_5\d\d|unavailable|internalerror|backenderror/.test(
        normalized,
      )
    ) {
      return 'temporary';
    }
    return 'unknown';
  }

  private async recoverSyncStates() {
    const connections = await this.prisma.aiEmailConnection.findMany({
      where: { isActive: true },
      select: { id: true, userId: true, syncState: true },
    });
    for (const connection of connections) {
      const state = connection.syncState as GmailSyncProgress | null;
      if (state?.status === 'failed' && state.errorCategory === 'rate_limit') {
        const rateLimitRetryCount = (state.rateLimitRetryCount ?? 0) + 1;
        const retryDelay = Math.min(
          GMAIL_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitRetryCount - 1),
          15 * 60_000,
        );
        const retryAt = Date.now() + retryDelay;
        this.syncProgress.set(connection.id, state);
        await this.prisma.aiEmailConnection.update({
          where: { id: connection.id },
          data: { lastSyncErrorCode: null },
        });
        await this.updateSyncProgress(connection.id, connection.userId, {
          status: 'waiting',
          errorCode: 'rate_limit_retry_scheduled',
          providerErrorCode: state.providerErrorCode ?? state.errorCode,
          errorCategory: 'rate_limit',
          rateLimitRetryCount,
          retryAt,
          nextRunAt: undefined,
        });
        this.scheduleRateLimitRetry(connection.id, retryDelay);
        continue;
      }
      if (
        state?.status === 'waiting' &&
        state.errorCode === 'rate_limit_retry_scheduled' &&
        state.retryAt
      ) {
        this.syncProgress.set(connection.id, state);
        this.scheduleRateLimitRetry(
          connection.id,
          Math.max(0, state.retryAt - Date.now()),
        );
        continue;
      }
      if (
        !state ||
        !['running', 'waiting', 'retrying'].includes(state.status)
      ) {
        continue;
      }
      this.syncProgress.set(connection.id, state);
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: 'failed',
        errorCode: 'worker_interrupted',
        errorCategory: 'temporary',
        retryAt: undefined,
        nextRunAt: undefined,
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

  private scheduleRateLimitRetry(connectionId: string, delayMs: number) {
    const previousTimer = this.rateLimitRetryTimers.get(connectionId);
    if (previousTimer) {
      clearTimeout(previousTimer);
    }
    const retryTimer = setTimeout(
      () => {
        this.rateLimitRetryTimers.delete(connectionId);
        this.startSyncConnection(connectionId);
      },
      Math.max(0, delayMs),
    );
    retryTimer.unref();
    this.rateLimitRetryTimers.set(connectionId, retryTimer);
  }

  /**
   * Clasifica el atraso en lotes y escribe la fase `classifying` con su avance.
   * Corta al agotar el tope por corrida para no retener el ciclo de sync: lo
   * que falte queda pendiente y sigue en la próxima corrida.
   */
  private async classifyPendingBacklog({
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
    await this.updateSyncProgress(connectionId, userId, {
      status: 'running',
      phase: 'classifying',
      totalEstimate: pending,
      processedThisRun: 0,
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
        await this.updateSyncProgress(
          connectionId,
          userId,
          { phase: 'classifying' },
          { processed: batch.processed, imported: 0 },
        );
      }
    } catch (error) {
      this.logger.warn(
        `Gmail classification failed for connection ${connectionId}: ${this.safeErrorCode(error)}`,
      );
      errorCode = CLASSIFICATION_FAILED_ERROR_CODE;
    }
    return {
      processed,
      remaining: Math.max(0, pending - processed),
      errorCode,
    };
  }

  private async bootstrapPage(
    connection: NonNullable<
      Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
    >,
    accessToken: string,
  ) {
    const query = new URLSearchParams({
      q: gmailScopeQuery({
        afterSeconds: connection.importStartAt
          ? Math.floor(connection.importStartAt.getTime() / 1000)
          : BOOTSTRAP_START,
        senderFilter: connection.senderFilter,
      }),
      maxResults: '500',
    });
    if (connection.bootstrapPageToken) {
      query.set('pageToken', connection.bootstrapPageToken);
    }
    const page = await this.source.gmailApiRequest<GmailMessageList>(
      accessToken,
      `/users/me/messages?${query}`,
      (state) =>
        this.updateSyncProgress(connection.id, connection.userId, {
          ...state,
          retryAt: state.retryAt,
        }),
    );
    await this.updateSyncProgress(connection.id, connection.userId, {
      status: 'running',
      batchSize: page.messages?.length ?? 0,
      totalEstimate: page.resultSizeEstimate,
    });
    const imported = await this.importMessageBatch({
      connectionId: connection.id,
      userId: connection.userId,
      accessToken,
      refs: page.messages ?? [],
      filters: importFiltersOf(connection),
      scopeAppliedInQuery: true,
      onBatchProgress: async (processed, importedCount) => {
        await this.updateSyncProgress(
          connection.id,
          connection.userId,
          { status: 'running' },
          { processed, imported: importedCount },
        );
      },
    });
    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        bootstrapStartedAt: connection.bootstrapStartedAt ?? new Date(),
        bootstrapPageToken: page.nextPageToken ?? null,
        ...(page.nextPageToken
          ? {}
          : { initialSyncCompletedAt: new Date(), bootstrapPageToken: null }),
        importedMessageCount: { increment: imported },
      },
    });
    return {
      imported,
      bootstrapComplete: !page.nextPageToken,
    };
  }

  private async syncIncremental(
    connection: NonNullable<
      Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
    >,
    accessToken: string,
  ) {
    if (!connection.providerCursor) {
      await this.updateSyncProgress(connection.id, connection.userId, {
        phase: 'recovery',
      });
      return this.recoverFromCursor(connection, accessToken);
    }

    const startCursor = connection.providerCursor;
    let pageToken: string | undefined;
    let cursor = startCursor;
    let imported = 0;
    do {
      const page = await this.fetchHistoryPage({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        cursor: startCursor,
        pageToken,
      });
      if (!page) {
        return this.recoverFromCursor(connection, accessToken);
      }
      cursor = this.maxHistoryId(cursor, page.historyId);
      const ids = (page.history ?? [])
        .flatMap((entry) => entry.messagesAdded ?? [])
        .flatMap((entry) =>
          entry.message?.id ? [{ id: entry.message.id }] : [],
        );
      imported += await this.importMessageBatch({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        refs: ids,
        filters: importFiltersOf(connection),
        scopeAppliedInQuery: false,
        onBatchProgress: async (processed, importedCount) => {
          await this.updateSyncProgress(
            connection.id,
            connection.userId,
            { status: 'running', batchSize: ids.length },
            { processed, imported: importedCount },
          );
        },
      });
      pageToken = page.nextPageToken;
    } while (pageToken);

    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        providerCursor: cursor,
        importedMessageCount: { increment: imported },
      },
    });
    return { imported, bootstrapComplete: true };
  }

  private async fetchHistoryPage({
    connectionId,
    userId,
    accessToken,
    cursor,
    pageToken,
  }: {
    connectionId: string;
    userId: string;
    accessToken: string;
    cursor: string;
    pageToken?: string;
  }): Promise<GmailHistoryPage | null> {
    const query = new URLSearchParams({
      startHistoryId: cursor,
      historyTypes: 'messageAdded',
      maxResults: '500',
    });
    if (pageToken) {
      query.set('pageToken', pageToken);
    }
    try {
      return await this.source.gmailApiRequest<GmailHistoryPage>(
        accessToken,
        `/users/me/history?${query}`,
        (state) =>
          this.updateSyncProgress(connectionId, userId, {
            ...state,
            phase: 'incremental',
            retryAt: state.retryAt,
          }),
      );
    } catch (error) {
      if (this.isGmailNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  private async recoverFromCursor(
    connection: NonNullable<
      Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
    >,
    accessToken: string,
  ) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowStartMs =
      connection.lastSyncedAt?.getTime() ?? Date.now() - RECOVERY_WINDOW_MS;
    const importFloorMs = connection.importStartAt?.getTime() ?? 0;
    const startSeconds = Math.floor(
      Math.max(windowStartMs, importFloorMs) / 1000,
    );
    const recoveryRange = {
      from: new Date(startSeconds * 1000).toISOString(),
      to: new Date(nowSeconds * 1000).toISOString(),
    };
    await this.updateSyncProgress(connection.id, connection.userId, {
      phase: 'recovery',
      recoveryRange,
    });
    const profile = await this.source.gmailApiRequest<{ historyId?: string }>(
      accessToken,
      '/users/me/profile',
      (state) =>
        this.updateSyncProgress(connection.id, connection.userId, {
          ...state,
          phase: 'recovery',
          retryAt: state.retryAt,
        }),
    );
    const query = new URLSearchParams({
      q: gmailScopeQuery({
        afterSeconds: startSeconds,
        beforeSeconds: nowSeconds,
        senderFilter: connection.senderFilter,
      }),
      maxResults: '500',
    });
    let pageToken: string | undefined;
    let imported = 0;
    do {
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const page = await this.source.gmailApiRequest<GmailMessageList>(
        accessToken,
        `/users/me/messages?${query}`,
        (state) =>
          this.updateSyncProgress(connection.id, connection.userId, {
            ...state,
            status: state.status,
            phase: 'recovery',
            retryAt: state.retryAt,
          }),
      );
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: 'running',
        phase: 'recovery',
        batchSize: page.messages?.length ?? 0,
        totalEstimate: page.resultSizeEstimate,
      });
      imported += await this.importMessageBatch({
        connectionId: connection.id,
        userId: connection.userId,
        accessToken,
        refs: page.messages ?? [],
        filters: importFiltersOf(connection),
        scopeAppliedInQuery: true,
        onBatchProgress: async (processed, importedCount) => {
          await this.updateSyncProgress(
            connection.id,
            connection.userId,
            { status: 'running', phase: 'recovery' },
            { processed, imported: importedCount },
          );
        },
      });
      pageToken = page.nextPageToken;
      if (pageToken) {
        query.set('pageToken', pageToken);
      } else {
        query.delete('pageToken');
      }
    } while (pageToken);

    await this.prisma.aiEmailConnection.update({
      where: { id: connection.id },
      data: {
        providerCursor: profile.historyId ?? connection.providerCursor,
        lastRecoverySyncAt: new Date(),
        importedMessageCount: { increment: imported },
      },
    });
    return { imported, recovered: true, bootstrapComplete: true };
  }

  private async importMessageBatch({
    connectionId,
    userId,
    accessToken,
    refs,
    filters,
    scopeAppliedInQuery,
    onBatchProgress,
  }: {
    connectionId: string;
    userId: string;
    accessToken: string;
    refs: Array<{ id: string; threadId?: string }>;
    filters: MessageImportFilters;
    /** El bootstrap y la recuperación ya acotan en la consulta de Gmail. */
    scopeAppliedInQuery: boolean;
    onBatchProgress?: (processed: number, imported: number) => Promise<void>;
  }): Promise<number> {
    // El historial no acepta consulta: sin alcance en la query hay que leer la
    // metadata antes del cuerpo para no descargar correo fuera del alcance.
    const filterBeforeFetch =
      !scopeAppliedInQuery &&
      Boolean(filters.importStartAt || filters.senderFilter);
    let imported = 0;
    let unreportedProcessed = 0;
    let unreportedImported = 0;
    for (
      let offset = 0;
      offset < refs.length;
      offset += GMAIL_MESSAGE_FETCH_CONCURRENCY
    ) {
      const batch = refs.slice(
        offset,
        offset + GMAIL_MESSAGE_FETCH_CONCURRENCY,
      );
      const counts = await Promise.all(
        batch.map(async (ref) => {
          const existing = await this.prisma.aiEmailMessage.findUnique({
            where: {
              connectionId_providerMessageId: {
                connectionId,
                providerMessageId: ref.id,
              },
            },
            select: { id: true },
          });
          if (existing) {
            return 0;
          }
          try {
            if (filterBeforeFetch) {
              const metadata = await this.fetchMessage({
                accessToken,
                connectionId,
                userId,
                messageId: ref.id,
                format: 'metadata',
              });
              if (
                !isWithinImportScope({
                  envelope: readMessageEnvelope(metadata),
                  filters,
                })
              ) {
                return 0;
              }
            }
            const message = await this.fetchMessage({
              accessToken,
              connectionId,
              userId,
              messageId: ref.id,
              format: 'full',
            });
            return this.persistMessage({
              connectionId,
              userId,
              message,
              filters,
            });
          } catch (error) {
            if (this.isGmailNotFound(error)) {
              return 0;
            }
            throw error;
          }
        }),
      );
      const batchImported = counts.reduce<number>(
        (sum, count) => sum + count,
        0,
      );
      imported += batchImported;
      unreportedProcessed += batch.length;
      unreportedImported += batchImported;
      const isLastBatch = offset + batch.length >= refs.length;
      if (unreportedProcessed >= 30 || isLastBatch) {
        await onBatchProgress?.(unreportedProcessed, unreportedImported);
        unreportedProcessed = 0;
        unreportedImported = 0;
      }
    }
    return imported;
  }

  private async fetchMessage({
    accessToken,
    connectionId,
    userId,
    messageId,
    format,
  }: {
    accessToken: string;
    connectionId: string;
    userId: string;
    messageId: string;
    format: 'metadata' | 'full';
  }): Promise<GmailMessage> {
    return this.source.gmailApiRequest<GmailMessage>(
      accessToken,
      `/users/me/messages/${encodeURIComponent(messageId)}?format=${format}`,
      (state) =>
        this.updateSyncProgress(connectionId, userId, {
          ...state,
          retryAt: state.retryAt,
        }),
    );
  }

  private async persistMessage({
    connectionId,
    userId,
    message,
    filters,
  }: {
    connectionId: string;
    userId: string;
    message: GmailMessage;
    filters: MessageImportFilters;
  }) {
    const payload = message.payload ?? {};
    const envelope = readMessageEnvelope(message);
    if (!isWithinImportScope({ envelope, filters })) {
      return 0;
    }
    const { headers, fromAddress, fromDomain, receivedAt } = envelope;
    const subject = headers.get('subject')?.trim() || '(sin asunto)';
    const bodies = this.collectBodies(payload);
    const rawBody = bodies.plain || bodies.html || message.snippet || '';
    const sanitizedBody = this.sanitize(bodies.plain || bodies.html || rawBody);
    const canonicalBody = this.canonicalize(sanitizedBody);
    const fingerprint = createHash('sha256')
      .update(canonicalBody)
      .digest('hex');
    const templateFingerprint = createHash('sha256')
      .update(this.templateize(canonicalBody))
      .digest('hex');
    const retentionDays =
      this.config.get('NODE_ENV', { infer: true }) === 'production'
        ? RAW_RETENTION_PROD_DAYS
        : RAW_RETENTION_DEV_DAYS;
    const retentionExpiresAt = new Date(Date.now() + retentionDays * 86400_000);

    try {
      await this.prisma.aiEmailMessage.create({
        data: {
          userId,
          connectionId,
          providerMessageId: message.id,
          providerThreadId: message.threadId ?? null,
          receivedAt,
          fromAddress,
          fromDomain,
          subject,
          contentFingerprint: fingerprint,
          templateFingerprint,
          processingStatus: 'QUEUED',
          content: {
            create: {
              rawBody,
              sanitizedBody,
              canonicalBody,
              snippet: message.snippet ?? null,
              retentionExpiresAt,
            },
          },
        },
      });
      return 1;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return 0;
      }
      throw error;
    }
  }

  private collectBodies(part: GmailPart): { plain: string; html: string } {
    const own = part.body?.data
      ? Buffer.from(part.body.data, 'base64url').toString('utf8')
      : '';
    const children = (part.parts ?? []).map((child) =>
      this.collectBodies(child),
    );
    const plain = part.mimeType === 'text/plain' ? own : '';
    const html = part.mimeType === 'text/html' ? own : '';
    return {
      plain: [plain, ...children.map((child) => child.plain)]
        .filter(Boolean)
        .join('\n'),
      html: [html, ...children.map((child) => child.html)]
        .filter(Boolean)
        .join('\n'),
    };
  }

  private sanitize(body: string) {
    return body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/[\t\r ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private canonicalize(body: string) {
    return body
      .split('\n')
      .filter((line) => !/^\s*>/.test(line))
      .join('\n')
      .split(
        /\n(?:On .{1,200}wrote:|El .{1,200}escribi[oó]:|-{2,}\s*Original Message\s*-{2,})/i,
      )[0]
      .split(/\n--\s*\n/)[0]
      .replace(/\s+/g, ' ')
      .trim();
  }

  private templateize(body: string) {
    return body
      .replace(/\b\d[\d.,]{2,}\b/g, '{NUMBER}')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '{ID}')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '{DATE}')
      .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '{DATE}')
      .toLowerCase();
  }

  private maxHistoryId(current: string, next?: string) {
    if (!next) {
      return current;
    }
    try {
      return BigInt(next) > BigInt(current) ? next : current;
    } catch {
      return next;
    }
  }

  private safeErrorCode(error: unknown) {
    const code =
      this.providerErrorCode(error) ??
      this.exceptionErrorCode(error) ??
      (error instanceof Error ? error.message : 'gmail_sync_failed');
    return code.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, '_');
  }

  private exceptionErrorCode(error: unknown): string | undefined {
    if (!(error instanceof HttpException)) {
      return undefined;
    }
    const response = error.getResponse();
    if (typeof response === 'string') {
      return response;
    }
    if (typeof response !== 'object' || response === null) {
      return undefined;
    }
    const code = (response as Record<string, unknown>).code;
    return typeof code === 'string' ? code : undefined;
  }

  private isGmailNotFound(error: unknown) {
    const providerCode = this.providerErrorCode(error);
    return (
      providerCode === 'NOT_FOUND' ||
      providerCode === 'notFound' ||
      providerCode === 'http_404'
    );
  }

  private providerErrorCode(error: unknown): string | undefined {
    if (!(error instanceof HttpException)) {
      return undefined;
    }
    const response = error.getResponse();
    if (typeof response !== 'object' || response === null) {
      return undefined;
    }
    const providerCode = (response as Record<string, unknown>).providerCode;
    return typeof providerCode === 'string' ? providerCode : undefined;
  }
}

function gmailQueryDate(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '/');
}
