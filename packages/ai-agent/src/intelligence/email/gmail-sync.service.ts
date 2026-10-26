import {
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
import { AiDataDeletionService } from '../knowledge/ai-data-deletion.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const BOOTSTRAP_START = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const RECOVERY_WINDOW_MS = 7 * 86400_000;
const RAW_RETENTION_DEV_DAYS = 30;
const RAW_RETENTION_PROD_DAYS = 7;
const GMAIL_MESSAGE_FETCH_CONCURRENCY = 3;
const GMAIL_RATE_LIMIT_COOLDOWN_MS = 60_000;

type GmailSyncProgress = {
  status:
    'running' | 'waiting' | 'retrying' | 'scheduled' | 'completed' | 'failed';
  phase: 'bootstrap' | 'incremental' | 'recovery';
  attempt: number;
  rateLimitRetryCount?: number;
  processedThisRun: number;
  importedThisRun: number;
  batchSize?: number;
  totalEstimate?: number;
  retryAt?: number;
  nextRunAt?: number;
  errorCode?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: AiEmailSourceService,
    private readonly config: ConfigService<Env, true>,
    private readonly eventEmitter: EventEmitter2,
    private readonly deletion: AiDataDeletionService,
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
    if (!this.source.oauthDiagnostics().configured) {
      return;
    }
    const intervalMinutes = this.config.get('AI_EMAIL_SYNC_INTERVAL_MINUTES', {
      infer: true,
    });
    this.timer = setInterval(
      () => void this.syncAllActiveConnections(),
      intervalMinutes * 60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
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
      return { connected: false, deletedMessages: 0 };
    }
    if (this.activeSyncConnections.has(connection.id)) {
      throw new ConflictException(
        'Espera a que termine la sincronización antes de reiniciar el correo.',
      );
    }
    const existingState = connection.syncState as GmailSyncProgress | null;
    if (
      existingState &&
      ['running', 'waiting', 'retrying'].includes(existingState.status) &&
      existingState.errorCode !== 'rate_limit_retry_scheduled'
    ) {
      throw new ConflictException(
        'La sincronización sigue activa. Actualiza el estado e inténtalo de nuevo.',
      );
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
      const connections = await this.prisma.aiEmailConnection.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
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
      errorCategory: undefined,
      startedAt: new Date().toISOString(),
    });
    try {
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { lastSyncErrorCode: null },
      });
      const accessToken = await this.source.getAccessToken(connectionId);
      const result = connection.initialSyncCompletedAt
        ? await this.syncIncremental(connection, accessToken)
        : await this.bootstrapPage(connection, accessToken);
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncedAt: new Date(),
          lastSyncErrorCode: null,
        },
      });
      const intervalMinutes = this.config.get(
        'AI_EMAIL_SYNC_INTERVAL_MINUTES',
        { infer: true },
      );
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: result.bootstrapComplete ? 'completed' : 'scheduled',
        phase: this.syncProgress.get(connection.id)?.phase ?? phase,
        rateLimitRetryCount: 0,
        nextRunAt: result.bootstrapComplete
          ? undefined
          : Date.now() + intervalMinutes * 60_000,
        retryAt: undefined,
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
        await this.prisma.aiEmailConnection.update({
          where: { id: connectionId },
          data: { lastSyncErrorCode: null },
        });
        await this.updateSyncProgress(connection.id, connection.userId, {
          status: 'waiting',
          errorCode: 'rate_limit_retry_scheduled',
          errorCategory: 'rate_limit',
          rateLimitRetryCount,
          retryAt,
          nextRunAt: undefined,
        });
        this.scheduleRateLimitRetry(connection.id, retryAt - Date.now());
        return { connected: true, imported: 0, retryScheduled: true };
      }
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { lastSyncErrorCode: code },
      });
      await this.updateSyncProgress(connection.id, connection.userId, {
        status: 'failed',
        errorCode: code,
        errorCategory: this.classifyError(code),
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
    if (
      /invalid_grant|token_refresh|refresh_token|unauthorized|http_401/i.test(
        code,
      )
    ) {
      return 'authorization';
    }
    if (
      /not_configured|missing_configuration|redirect_uri_mismatch/i.test(code)
    ) {
      return 'configuration';
    }
    if (/rateLimit|quota|userRateLimit|http_429/i.test(code)) {
      return 'rate_limit';
    }
    if (/timeout|network|fetch|http_5\d\d|unavailable/i.test(code)) {
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

  private async bootstrapPage(
    connection: NonNullable<
      Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
    >,
    accessToken: string,
  ) {
    const query = new URLSearchParams({
      q: `after:${BOOTSTRAP_START}`,
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
    const imported = await this.importMessageBatch(
      connection.id,
      connection.userId,
      accessToken,
      page.messages ?? [],
      async (processed, importedCount) => {
        await this.updateSyncProgress(
          connection.id,
          connection.userId,
          { status: 'running' },
          { processed, imported: importedCount },
        );
      },
    );
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

    let pageToken: string | undefined;
    let cursor = connection.providerCursor;
    let imported = 0;
    do {
      const query = new URLSearchParams({
        startHistoryId: connection.providerCursor,
        historyTypes: 'messageAdded',
        maxResults: '500',
      });
      if (pageToken) {
        query.set('pageToken', pageToken);
      }
      const response = await fetch(`${GMAIL_API}/users/me/history?${query}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (response.status === 404) {
        return this.recoverFromCursor(connection, accessToken);
      }
      const page = (await response.json()) as GmailHistoryPage & {
        error?: { status?: string };
      };
      if (!response.ok) {
        throw new Error(
          page.error?.status ?? `gmail_history_http_${response.status}`,
        );
      }
      cursor = this.maxHistoryId(cursor, page.historyId);
      const ids = (page.history ?? [])
        .flatMap((entry) => entry.messagesAdded ?? [])
        .flatMap((entry) =>
          entry.message?.id ? [{ id: entry.message.id }] : [],
        );
      imported += await this.importMessageBatch(
        connection.id,
        connection.userId,
        accessToken,
        ids,
        async (processed, importedCount) => {
          await this.updateSyncProgress(
            connection.id,
            connection.userId,
            { status: 'running', batchSize: ids.length },
            { processed, imported: importedCount },
          );
        },
      );
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

  private async recoverFromCursor(
    connection: NonNullable<
      Awaited<ReturnType<PrismaService['aiEmailConnection']['findUnique']>>
    >,
    accessToken: string,
  ) {
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
    const nowSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = Math.floor(
      (connection.lastSyncedAt?.getTime() ?? Date.now() - RECOVERY_WINDOW_MS) /
        1000,
    );
    const boundedStart = Math.max(
      startSeconds,
      Math.floor((Date.now() - RECOVERY_WINDOW_MS) / 1000),
    );
    const query = new URLSearchParams({
      q: `after:${boundedStart} before:${nowSeconds}`,
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
      imported += await this.importMessageBatch(
        connection.id,
        connection.userId,
        accessToken,
        page.messages ?? [],
        async (processed, importedCount) => {
          await this.updateSyncProgress(
            connection.id,
            connection.userId,
            { status: 'running', phase: 'recovery' },
            { processed, imported: importedCount },
          );
        },
      );
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

  private async importMessageBatch(
    connectionId: string,
    userId: string,
    accessToken: string,
    refs: Array<{ id: string; threadId?: string }>,
    onBatchProgress?: (processed: number, imported: number) => Promise<void>,
  ) {
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
            const message = await this.source.gmailApiRequest<GmailMessage>(
              accessToken,
              `/users/me/messages/${encodeURIComponent(ref.id)}?format=full`,
              (state) =>
                this.updateSyncProgress(connectionId, userId, {
                  ...state,
                  retryAt: state.retryAt,
                }),
            );
            return this.persistMessage(connectionId, userId, message);
          } catch (error) {
            if (this.isMissingGmailMessage(error)) {
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

  private async persistMessage(
    connectionId: string,
    userId: string,
    message: GmailMessage,
  ) {
    const payload = message.payload ?? {};
    const headers = new Map(
      (payload.headers ?? []).map((header) => [
        header.name.toLowerCase(),
        header.value,
      ]),
    );
    const fromHeader = headers.get('from') ?? '';
    const fromAddress =
      fromHeader.match(/<([^>]+)>/)?.[1]?.trim() ?? fromHeader.trim();
    const fromDomain = fromAddress.split('@').at(-1)?.toLowerCase() ?? '';
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
    const receivedAt = message.internalDate
      ? new Date(Number(message.internalDate))
      : new Date(headers.get('date') ?? Date.now());
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
    const providerCode = this.providerErrorCode(error);
    if (providerCode) {
      return providerCode.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, '_');
    }
    if (error instanceof Error) {
      return error.message.slice(0, 120).replace(/[^a-zA-Z0-9_.:-]/g, '_');
    }
    return 'gmail_sync_failed';
  }

  private isMissingGmailMessage(error: unknown) {
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
