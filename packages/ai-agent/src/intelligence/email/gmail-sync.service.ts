import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import { createHash } from 'node:crypto';
import { AiEmailSourceService } from './ai-email-source.service';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const BOOTSTRAP_START = Math.floor(Date.UTC(2026, 0, 1) / 1000);
const RECOVERY_WINDOW_MS = 7 * 86400_000;
const RAW_RETENTION_DEV_DAYS = 30;
const RAW_RETENTION_PROD_DAYS = 7;
const GMAIL_MESSAGE_FETCH_CONCURRENCY = 3;

type GmailMessageList = {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly source: AiEmailSourceService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (
      this.config.get('NODE_ENV', { infer: true }) === 'test' ||
      !this.source.oauthDiagnostics().configured
    ) {
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
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { id: true },
    });
    return connection
      ? this.activeSyncConnections.has(connection.id)
      : false;
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
    if (this.activeSyncConnections.has(connectionId)) {
      return {
        connected: true,
        imported: 0,
        bootstrapComplete: false,
        alreadyRunning: true,
      };
    }
    this.activeSyncConnections.add(connectionId);
    try {
      return await this.runSyncConnection(connectionId);
    } finally {
      this.activeSyncConnections.delete(connectionId);
    }
  }

  private startSyncConnection(connectionId: string) {
    if (this.activeSyncConnections.has(connectionId)) {
      return false;
    }
    this.activeSyncConnections.add(connectionId);
    void this.runSyncConnection(connectionId)
      .catch((error: unknown) => {
        this.logger.warn(
          `Gmail sync failed for connection ${connectionId}: ${this.safeErrorCode(error)}`,
        );
      })
      .finally(() => this.activeSyncConnections.delete(connectionId));
    return true;
  }

  private async runSyncConnection(connectionId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection?.isActive) {
      return { connected: false, imported: 0 };
    }
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
      return { connected: true, ...result };
    } catch (error) {
      const code = this.safeErrorCode(error);
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { lastSyncErrorCode: code },
      });
      throw error;
    }
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
    );
    const imported = await this.importMessageBatch(
      connection.id,
      connection.userId,
      accessToken,
      page.messages ?? [],
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
      );
      imported += await this.importMessageBatch(
        connection.id,
        connection.userId,
        accessToken,
        page.messages ?? [],
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
  ) {
    let imported = 0;
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
      imported += counts.reduce((sum, count) => sum + count, 0 as number);
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
