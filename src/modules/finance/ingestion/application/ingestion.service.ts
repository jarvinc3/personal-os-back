import { InjectQueue } from '@nestjs/bullmq';
import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { Env } from '../../../../config';
import { AppEvents } from '../../../../core/events/event.constants';
import type { GmailSyncJob } from '../../../../core/queues/queue-jobs';
import { QueueNames } from '../../../../core/queues/queue.constants';
import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { FinanceOutboxDispatcher } from '../../events/infrastructure/finance-outbox.dispatcher';
import { DOMAIN_EVENT_PUBLISHER } from '../../shared/application/tokens';
import { EmailSourceRepository } from '../infrastructure/email-source.repository';
import {
    exchangeGoogleAuthCode,
    fetchGoogleUserEmail,
    refreshGoogleAccessToken,
} from '../infrastructure/gmail-api.util';
import { decryptToken, encryptToken } from '../infrastructure/token-encryption.util';
import type { ConnectEmailSourceDto } from '../presentation/dto/connect-email-source.dto';
import type { GoogleOAuthUrlQueryDto } from '../presentation/dto/oauth-callback-query.dto';
import type { UpdateEmailSourceDto } from '../presentation/dto/update-email-source.dto';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly repo: EmailSourceRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisherPort,
    private readonly outboxDispatcher: FinanceOutboxDispatcher,
    @Optional()
    @InjectQueue(QueueNames.GMAIL_SYNC)
    private readonly gmailSyncQueue?: Queue<GmailSyncJob>,
  ) {}

  listEmailSources(userId: string) {
    return this.repo
      .listEmailSources(userId)
      .then((sources) => sources.map((s) => this.mapEmailSourceResponse(s)));
  }

  createEmailSource(userId: string, dto: ConnectEmailSourceDto) {
    if (dto.accountId && dto.cardId) {
      throw new BadRequestException(
        'Provide at most one of accountId or cardId',
      );
    }
    return this.repo.createEmailSource(userId, {
      provider: 'gmail',
      emailAddress: dto.emailAddress,
      bankDomain: dto.bankDomain,
      label: dto.label,
      accountId: dto.accountId,
      cardId: dto.cardId,
      isActive: true,
    });
  }

  async updateEmailSource(
    userId: string,
    id: string,
    dto: UpdateEmailSourceDto,
  ) {
    if (dto.accountId && dto.cardId) {
      throw new BadRequestException(
        'Provide at most one of accountId or cardId',
      );
    }
    if (dto.accountId) {
      const account = await this.repo.findAccountById(dto.accountId, userId);
      if (!account) throw new BadRequestException('Account not found');
    }
    if (dto.cardId) {
      const card = await this.repo.findCardById(userId, dto.cardId);
      if (!card) throw new BadRequestException('Card not found');
    }

    const data: Record<string, unknown> = {};
    if (dto.accountId !== undefined) {
      data.accountId = dto.accountId;
      if (dto.accountId) data.cardId = null;
    }
    if (dto.cardId !== undefined) {
      data.cardId = dto.cardId;
      if (dto.cardId) data.accountId = null;
    }
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.bankDomain !== undefined) data.bankDomain = dto.bankDomain.trim();

    const updated = await this.repo.updateEmailSource(userId, id, data);
    if (!updated) throw new NotFoundException('Email source not found');
    return this.mapEmailSourceResponse(updated);
  }

  async deactivateEmailSource(userId: string, id: string) {
    const updated = await this.repo.updateEmailSource(userId, id, {
      isActive: false,
    });
    if (!updated) throw new NotFoundException('Email source not found');
    return { success: true };
  }

  async triggerEmailSync(
    userId: string,
    sourceId: string,
    forceFullSync = false,
  ) {
    const source = await this.repo.findEmailSource(userId, sourceId);
    if (!source) throw new NotFoundException('Email source not found');
    if (!this.gmailSyncQueue) {
      return {
        queued: false,
        reason:
          'gmail-sync queue is unavailable. Verify REDIS_ENABLED=true and REDIS_URL, then restart the API.',
      };
    }

    await this.gmailSyncQueue.add(
      'gmail-sync-source',
      { userId, sourceId, forceFullSync },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1500 },
        removeOnComplete: 100,
        removeOnFail: 300,
      },
    );

    return { queued: true as const };
  }

  async completeEmailSyncSuccessWithEvent(params: {
    logId: string;
    userId: string;
    sourceId: string;
    emailsScanned: number;
    transactionsNew: number;
    transactionIds: string[];
    countsByStatus: Record<string, number>;
  }) {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    await this.repo.completeEmailSyncSuccessWithOutbox(
      params.logId,
      {
        status: 'SUCCESS',
        emailsScanned: params.emailsScanned,
        transactionsNew: params.transactionsNew,
      },
      {
        eventId,
        eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
        aggregateType: 'FinEmailSource',
        aggregateId: params.sourceId,
        userId: params.userId,
        payload: {
          sourceId: params.sourceId,
          emailsScanned: params.emailsScanned,
          transactionsNew: params.transactionsNew,
          transactionIds: params.transactionIds,
          countsByStatus: params.countsByStatus,
          occurredAt,
          version: 1,
        },
      },
    );
    void this.outboxDispatcher.processBatch();
  }

  /** @deprecated Prefer completeEmailSyncSuccessWithEvent (same TX). */
  async publishEmailSyncCompleted(event: {
    userId: string;
    sourceId: string;
    emailsScanned: number;
    transactionsNew: number;
    transactionIds: string[];
    countsByStatus: Record<string, number>;
  }) {
    await this.events.enqueue({
      eventName: AppEvents.FINANCE_EMAIL_SYNC_COMPLETED,
      aggregateType: 'FinEmailSource',
      aggregateId: event.sourceId,
      userId: event.userId,
      payload: {
        sourceId: event.sourceId,
        emailsScanned: event.emailsScanned,
        transactionsNew: event.transactionsNew,
        transactionIds: event.transactionIds,
        countsByStatus: event.countsByStatus,
      },
    });
    void this.outboxDispatcher.processBatch();
  }

  getGoogleOAuthUrl(
    userId: string,
    query: GoogleOAuthUrlQueryDto = {},
  ): { url: string } {
    const bankDomain = query.bankDomain?.trim() || 'bhd.com.do';
    const state = jwt.sign(
      {
        sub: userId,
        bankDomain,
        label: query.label?.trim() || undefined,
        accountId: query.accountId?.trim() || undefined,
      },
      this.oauthStateSecret,
      { expiresIn: '15m' },
    );

    const params = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      redirect_uri: this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
      response_type: 'code',
      scope:
        'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  }

  async handleGoogleOAuthCallback(code: string, state: string) {
    let payload: {
      sub: string;
      bankDomain: string;
      label?: string;
      accountId?: string;
    };
    try {
      payload = jwt.verify(state, this.oauthStateSecret) as typeof payload;
    } catch {
      throw new BadRequestException('Invalid or expired OAuth state');
    }

    if (payload.accountId) {
      const account = await this.repo.findAccountById(
        payload.accountId,
        payload.sub,
      );
      if (!account) throw new BadRequestException('Account not found');
    }

    const tokenResponse = await exchangeGoogleAuthCode(
      code,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      this.config.get('GOOGLE_REDIRECT_URI', { infer: true }),
    );

    const emailAddress = await fetchGoogleUserEmail(tokenResponse.access_token);
    const encryptedAccess = encryptToken(
      tokenResponse.access_token,
      this.encryptionKey,
    );
    const refreshToken = tokenResponse.refresh_token;
    if (!refreshToken) {
      throw new BadRequestException('Google did not return a refresh token');
    }
    const encryptedRefresh = encryptToken(refreshToken, this.encryptionKey);
    const tokenExpiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    );

    const existing = await this.repo.findEmailSourceByUserEmailAndDomain(
      payload.sub,
      emailAddress,
      payload.bankDomain,
    );

    if (existing) {
      return this.repo.updateEmailSourceTokens(existing.id, {
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiresAt,
        emailAddress,
        ...(payload.accountId ? { accountId: payload.accountId } : {}),
      });
    }

    return this.repo.createEmailSource(payload.sub, {
      provider: 'gmail',
      emailAddress,
      bankDomain: payload.bankDomain,
      label: payload.label,
      accountId: payload.accountId,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      tokenExpiresAt,
      isActive: true,
    });
  }

  async getValidGmailAccessToken(sourceId: string): Promise<string> {
    const source = await this.repo.findEmailSourceForRefresh(sourceId);
    if (!source?.accessToken) {
      throw new NotFoundException('Email source tokens not found');
    }

    const expiresSoon =
      !source.tokenExpiresAt ||
      source.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

    if (expiresSoon) {
      return this.refreshGmailToken(sourceId);
    }

    return decryptToken(source.accessToken, this.encryptionKey);
  }

  private async refreshGmailToken(sourceId: string): Promise<string> {
    const source = await this.repo.findEmailSourceForRefresh(sourceId);
    if (!source?.refreshToken || !source.accessToken) {
      throw new NotFoundException('Email source tokens not found');
    }

    const refreshToken = decryptToken(source.refreshToken, this.encryptionKey);
    const tokenResponse = await refreshGoogleAccessToken(
      refreshToken,
      this.config.get('GOOGLE_CLIENT_ID', { infer: true }),
      this.config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
    );

    const encryptedAccess = encryptToken(
      tokenResponse.access_token,
      this.encryptionKey,
    );
    const tokenExpiresAt = new Date(
      Date.now() + tokenResponse.expires_in * 1000,
    );

    await this.repo.updateEmailSourceTokens(sourceId, {
      accessToken: encryptedAccess,
      refreshToken: source.refreshToken,
      tokenExpiresAt,
    });

    return tokenResponse.access_token;
  }

  private get encryptionKey(): string {
    return this.config.get('ENCRYPTION_KEY', { infer: true });
  }

  private get oauthStateSecret(): string {
    const secret = this.config.get('OAUTH_STATE_SECRET', { infer: true });
    if (secret) return secret;

    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error('OAUTH_STATE_SECRET is required in production');
    }

    this.logger.warn(
      'OAUTH_STATE_SECRET is not set; falling back to ENCRYPTION_KEY (non-production only)',
    );
    return this.encryptionKey;
  }

  private mapEmailSourceResponse(source: {
    id: string;
    emailAddress: string;
    bankDomain: string;
    label: string | null;
    accountId: string | null;
    cardId?: string | null;
    provider: string;
    isActive: boolean;
    lastSyncedAt: Date | null;
    createdAt: Date;
    logs?: Array<{
      id: string;
      status: string;
      error: string | null;
      emailsScanned: number;
      transactionsNew: number;
      startedAt: Date;
      completedAt: Date | null;
    }>;
  }) {
    return {
      id: source.id,
      emailAddress: source.emailAddress,
      bankDomain: source.bankDomain,
      label: source.label,
      accountId: source.accountId,
      cardId: source.cardId ?? null,
      provider: source.provider,
      isActive: source.isActive,
      lastSyncedAt: source.lastSyncedAt?.toISOString() ?? null,
      createdAt: source.createdAt.toISOString(),
      logs: (source.logs ?? []).map((log) => ({
        id: log.id,
        status: log.status,
        error: log.error,
        emailsScanned: log.emailsScanned,
        transactionsNew: log.transactionsNew,
        startedAt: log.startedAt.toISOString(),
        completedAt: log.completedAt?.toISOString() ?? null,
      })),
    };
  }
}
