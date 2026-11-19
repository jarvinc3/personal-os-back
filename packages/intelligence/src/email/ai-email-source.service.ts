import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import type { AiEmailMessageStatus } from './dto/list-email-messages-query.dto';
import { decryptToken, encryptToken } from './token-encryption.util';
import { requiresGmailReconnect } from './gmail-reconnect.util';
import {
  isSenderFilter,
  normalizeSenderFilter,
  resolveImportStartAt,
  type GmailImportPeriod,
} from './gmail-import-scope';

const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GMAIL_API_MAX_RETRIES = 3;
const GMAIL_API_BASE_RETRY_MS = 1_000;
const GMAIL_API_RATE_LIMIT_RETRY_MS = 5_000;
const GMAIL_API_TIMEOUT_MS = 30_000;
const GMAIL_TOKEN_TIMEOUT_MS = 15_000;
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
const STATE_TTL_MS = 10 * 60 * 1000;

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GmailProfile = { emailAddress: string; historyId?: string };

type RetryStateListener = (state: {
  status: 'waiting' | 'retrying';
  retryAt?: number;
  attempt: number;
  errorCategory: 'rate_limit' | 'temporary';
}) => void | Promise<void>;

/** `AbortSignal.timeout()` rechaza con un `DOMException` que no hereda de `Error`. */
function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

type AttemptFields = {
  lastAttemptStartedAt: Date | null;
  lastAttemptFinishedAt: Date | null;
  lastAttemptResult: string | null;
  lastAttemptErrorCode: string | null;
  lastAttemptErrorCategory: string | null;
  lastAttemptImportedCount: number | null;
  lastAttemptPhase: string | null;
};

type ListMessagesInput = {
  userId: string;
  cursor?: string;
  q?: string;
  status?: AiEmailMessageStatus;
};

type MessageCursorPoint = { receivedAt: Date; id: string };

type FailureFields = {
  lastFailureAt: Date | null;
  lastFailureErrorCode: string | null;
  lastFailureErrorCategory: string | null;
  lastFailureImportedCount: number | null;
  lastFailurePhase: string | null;
};

function mapLastAttempt(connection: AttemptFields) {
  if (
    !connection.lastAttemptStartedAt &&
    !connection.lastAttemptFinishedAt &&
    !connection.lastAttemptResult
  ) {
    return null;
  }
  return {
    startedAt: connection.lastAttemptStartedAt,
    finishedAt: connection.lastAttemptFinishedAt,
    result: connection.lastAttemptResult,
    errorCode: connection.lastAttemptErrorCode,
    errorCategory: connection.lastAttemptErrorCategory,
    importedCount: connection.lastAttemptImportedCount,
    phase: connection.lastAttemptPhase,
  };
}

function mapLastFailure(connection: FailureFields) {
  if (!connection.lastFailureAt) {
    return null;
  }
  return {
    finishedAt: connection.lastFailureAt,
    errorCode: connection.lastFailureErrorCode,
    errorCategory: connection.lastFailureErrorCategory,
    importedCount: connection.lastFailureImportedCount,
    phase: connection.lastFailurePhase,
  };
}

@Injectable()
export class AiEmailSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async dashboard(userId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: {
        id: true,
        emailAddress: true,
        isActive: true,
        importStartAt: true,
        senderFilter: true,
        initialSyncCompletedAt: true,
        lastSyncedAt: true,
        lastRecoverySyncAt: true,
        importedMessageCount: true,
        lastSyncErrorCode: true,
        lastAttemptStartedAt: true,
        lastAttemptFinishedAt: true,
        lastAttemptResult: true,
        lastAttemptErrorCode: true,
        lastAttemptErrorCategory: true,
        lastAttemptImportedCount: true,
        lastAttemptPhase: true,
        lastFailureAt: true,
        lastFailureErrorCode: true,
        lastFailureErrorCategory: true,
        lastFailureImportedCount: true,
        lastFailurePhase: true,
        reconnectRequiredAt: true,
      },
    });
    const [messageCount, recentCount, receivedRange] = connection
      ? await Promise.all([
          this.prisma.aiEmailMessage.count({ where: { userId } }),
          this.prisma.aiEmailMessage.count({
            where: {
              userId,
              receivedAt: { gte: new Date(Date.now() - 30 * 86400_000) },
            },
          }),
          this.prisma.aiEmailMessage.aggregate({
            where: { userId },
            _min: { receivedAt: true },
            _max: { receivedAt: true },
          }),
        ])
      : [0, 0, { _min: { receivedAt: null }, _max: { receivedAt: null } }];
    const role = await this.prisma.userRole.findUnique({
      where: { userId },
      select: { role: true },
    });

    return {
      connection: connection
        ? {
            connected: connection.isActive,
            emailAddress: connection.emailAddress,
            importStartAt: connection.importStartAt,
            senderFilter: connection.senderFilter,
            initialSyncCompletedAt: connection.initialSyncCompletedAt,
            lastSyncedAt: connection.lastSyncedAt,
            lastRecoverySyncAt: connection.lastRecoverySyncAt,
            lastSyncErrorCode: connection.lastSyncErrorCode,
            lastAttempt: mapLastAttempt(connection),
            lastFailure: mapLastFailure(connection),
            requiresReconnect: Boolean(connection.reconnectRequiredAt),
          }
        : { connected: false },
      counters: {
        importedMessages: messageCount,
        recentMessages: recentCount,
        bootstrapImportedMessages: connection?.importedMessageCount ?? 0,
      },
      receivedRange: {
        firstMessageAt: receivedRange._min.receivedAt,
        latestMessageAt: receivedRange._max.receivedAt,
      },
      role: role?.role ?? 'USER',
    };
  }

  async listMessages({ userId, cursor, q, status }: ListMessagesInput) {
    const cursorPoint = this.parseMessageCursor(cursor);
    const rows = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        ...(status ? { processingStatus: status } : {}),
        ...(cursorPoint
          ? {
              OR: [
                { receivedAt: { gt: cursorPoint.receivedAt } },
                {
                  receivedAt: cursorPoint.receivedAt,
                  id: { gt: cursorPoint.id },
                },
              ],
            }
          : {}),
        // El cursor ya ocupa `OR`; la búsqueda va en `AND` para no pisarlo.
        ...(q
          ? {
              AND: {
                OR: [
                  { subject: { contains: q, mode: 'insensitive' } },
                  { fromAddress: { contains: q, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 51,
      select: {
        id: true,
        receivedAt: true,
        fromAddress: true,
        fromDomain: true,
        subject: true,
        processingStatus: true,
        contentFingerprint: true,
      },
    });
    const hasMore = rows.length > 50;
    const items = hasMore ? rows.slice(0, 50) : rows;
    const last = items.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                receivedAt: last.receivedAt.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }

  private parseMessageCursor(cursor?: string): MessageCursorPoint | undefined {
    if (!cursor) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { receivedAt?: unknown; id?: unknown };
      if (
        typeof parsed.id !== 'string' ||
        !parsed.id ||
        typeof parsed.receivedAt !== 'string' ||
        !Number.isFinite(Date.parse(parsed.receivedAt))
      ) {
        throw new Error('invalid cursor');
      }
      return { receivedAt: new Date(parsed.receivedAt), id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor inválido');
    }
  }

  async getMessage(userId: string, messageId: string) {
    const message = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      include: {
        content: true,
        classifications: { orderBy: { route: 'asc' } },
      },
    });
    if (!message) {
      // Avoid confirming that another user's message exists.
      throw new NotFoundException('Mensaje no encontrado');
    }
    const [observations, verifications] = await Promise.all([
      this.prisma.aiKnowledgeObservation.findMany({
        where: { userId, sourceType: 'EMAIL_MESSAGE', sourceId: messageId },
        orderBy: { sequence: 'asc' },
        select: {
          sequence: true,
          runId: true,
          knowledgeType: true,
          knowledgeKey: true,
          proposedScope: true,
          payload: true,
          createdAt: true,
        },
      }),
      this.prisma.aiHumanVerification.findMany({
        where: { userId, targetType: 'EMAIL_MESSAGE', targetId: messageId },
        orderBy: { sequence: 'asc' },
        select: {
          sequence: true,
          verifierRole: true,
          verdict: true,
          correctedPayload: true,
          notes: true,
          isGroundTruth: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      ...message,
      provenance: {
        observations: observations.map((item) => ({
          ...item,
          sequence: item.sequence.toString(),
        })),
        verifications: verifications.map((item) => ({
          ...item,
          sequence: item.sequence.toString(),
        })),
      },
    };
  }

  createAuthorizationUrl({
    userId,
    period,
    senderFilter,
  }: {
    userId: string;
    period?: GmailImportPeriod;
    senderFilter?: string | null;
  }): string {
    const { clientId, redirectUri } = this.requireOAuthConfig();
    const state = this.createState({
      userId,
      importStartAt: period
        ? resolveImportStartAt({ period, now: new Date() })
        : null,
      senderFilter:
        senderFilter === undefined
          ? undefined
          : normalizeSenderFilter(senderFilter),
    });
    const url = new URL(GMAIL_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    return url.toString();
  }

  async completeAuthorization(code: string, state: string) {
    const { userId, importStartAt, senderFilter } = this.verifyState(state);
    const { clientId, clientSecret, redirectUri } = this.requireOAuthConfig();
    const tokenResponse = await this.requestGoogleToken(
      new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    );
    const token = (await tokenResponse.json()) as OAuthTokenResponse;
    if (!tokenResponse.ok || !token.access_token) {
      const errorCode = token.error || `http_${tokenResponse.status}`;
      throw new BadRequestException({
        code: 'gmail_oauth_exchange_failed',
        providerCode: errorCode,
        diagnostic: this.oauthDiagnostic(errorCode),
      });
    }

    const profile = await this.gmailApiRequest<GmailProfile>(
      token.access_token,
      '/users/me/profile',
    );
    const existing = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: {
        refreshTokenEncrypted: true,
        providerCursor: true,
        emailAddress: true,
      },
    });
    const encryptionKey = this.config.getOrThrow(
      'AI_GMAIL_TOKEN_ENCRYPTION_KEY',
      {
        infer: true,
      },
    );
    const refreshTokenEncrypted = token.refresh_token
      ? encryptToken(token.refresh_token, encryptionKey)
      : existing?.refreshTokenEncrypted;
    if (!refreshTokenEncrypted) {
      throw new BadRequestException({
        code: 'gmail_refresh_token_missing',
        diagnostic: this.oauthDiagnostic('refresh_token_missing'),
      });
    }
    const expiresAt = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;
    // Reconectar no puede saltarse el correo del periodo desconectado: se
    // conserva el cursor anterior y la próxima sincronización lee la historia
    // desde ahí; si Google ya no la tiene, cae en la ventana de recuperación
    // desde `lastSyncedAt`. El `historyId` nuevo solo se toma al conectar por
    // primera vez o una cuenta distinta.
    const keepsPreviousCursor =
      Boolean(existing?.providerCursor) &&
      existing?.emailAddress === profile.emailAddress;
    const connection = await this.prisma.aiEmailConnection.upsert({
      where: { userId },
      create: {
        userId,
        emailAddress: profile.emailAddress,
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        refreshTokenEncrypted,
        tokenExpiresAt: expiresAt,
        providerCursor: profile.historyId,
        initialBudgetRemaining: this.config.get('AI_EMAIL_INITIAL_BUDGET', {
          infer: true,
        }),
        importStartAt,
        senderFilter,
      },
      update: {
        emailAddress: profile.emailAddress,
        isActive: true,
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        refreshTokenEncrypted,
        tokenExpiresAt: expiresAt,
        ...(keepsPreviousCursor ? {} : { providerCursor: profile.historyId }),
        ...(importStartAt ? { importStartAt } : {}),
        ...(senderFilter !== undefined ? { senderFilter } : {}),
        lastSyncErrorCode: null,
        reconnectRequiredAt: null,
      },
      select: { id: true, userId: true, emailAddress: true },
    });
    return connection;
  }

  oauthDiagnostics() {
    const configured = Boolean(
      this.config.get('AI_GMAIL_CLIENT_ID', { infer: true }) &&
      this.config.get('AI_GMAIL_CLIENT_SECRET', { infer: true }) &&
      this.config.get('AI_GMAIL_REDIRECT_URI', { infer: true }) &&
      this.config.get('AI_GMAIL_TOKEN_ENCRYPTION_KEY', { infer: true }),
    );
    return {
      configured,
      provider: 'GMAIL',
      scopes: GMAIL_SCOPES,
      status: configured ? 'ready' : 'missing_oauth_configuration',
    };
  }

  async getAccessToken(connectionId: string) {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection?.isActive) {
      throw new ServiceUnavailableException('Conexión de Gmail inactiva');
    }
    const encryptionKey = this.config.getOrThrow(
      'AI_GMAIL_TOKEN_ENCRYPTION_KEY',
      {
        infer: true,
      },
    );
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() > Date.now() + 60_000
    ) {
      return decryptToken(connection.accessTokenEncrypted, encryptionKey);
    }
    if (!connection.refreshTokenEncrypted) {
      throw new ServiceUnavailableException('gmail_refresh_token_missing');
    }

    const { clientId, clientSecret } = this.requireOAuthConfig();
    const refreshToken = decryptToken(
      connection.refreshTokenEncrypted,
      encryptionKey,
    );
    const response = await this.requestGoogleToken(
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    );
    const token = (await response.json()) as OAuthTokenResponse;
    if (!response.ok || !token.access_token) {
      const providerCode = token.error || `http_${response.status}`;
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: {
          lastSyncErrorCode: providerCode,
          ...(requiresGmailReconnect(providerCode)
            ? { reconnectRequiredAt: new Date() }
            : {}),
        },
      });
      throw new ServiceUnavailableException({
        code: 'gmail_token_refresh_failed',
        providerCode,
        diagnostic: this.oauthDiagnostic(providerCode),
      });
    }
    const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
    await this.prisma.aiEmailConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        tokenExpiresAt: expiresAt,
        lastSyncErrorCode: null,
        reconnectRequiredAt: null,
      },
    });
    return token.access_token;
  }

  async gmailApiRequest<T>(
    accessToken: string,
    path: string,
    onRetryState?: RetryStateListener,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${GMAIL_API}${path}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(GMAIL_API_TIMEOUT_MS),
        });
      } catch (error) {
        if (!isTimeoutError(error)) {
          throw error;
        }
        if (attempt >= GMAIL_API_MAX_RETRIES) {
          throw new BadRequestException({
            code: 'gmail_api_request_failed',
            providerCode: 'timeout',
            diagnostic: this.oauthDiagnostic('timeout'),
          });
        }
        await this.waitBeforeRetry({
          onRetryState,
          attempt,
          delayMs: GMAIL_API_BASE_RETRY_MS * 2 ** attempt,
          errorCategory: 'temporary',
        });
        continue;
      }
      const body = (await response.json().catch(() => ({}))) as {
        error?: {
          code?: number;
          status?: string;
          errors?: Array<{ reason?: string }>;
          details?: Array<{
            reason?: string;
            metadata?: { reason?: string };
          }>;
        };
      };
      if (response.ok) {
        return body as T;
      }
      const providerCode =
        body.error?.errors?.find((entry) => entry.reason)?.reason ??
        body.error?.details
          ?.map((entry) => entry.reason ?? entry.metadata?.reason)
          .find(Boolean) ??
        body.error?.status ??
        `http_${response.status}`;
      const isRateLimit =
        response.status === 429 ||
        providerCode === 'rateLimitExceeded' ||
        providerCode === 'userRateLimitExceeded';
      if (
        attempt < GMAIL_API_MAX_RETRIES &&
        this.isRetryableGmailError(response.status, providerCode)
      ) {
        const retryAfter = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
        const retryDelay = Number.isFinite(retryAfterSeconds)
          ? Math.min(30_000, Math.max(1_000, retryAfterSeconds * 1_000))
          : (isRateLimit
              ? GMAIL_API_RATE_LIMIT_RETRY_MS
              : GMAIL_API_BASE_RETRY_MS) *
            2 ** attempt;
        await this.waitBeforeRetry({
          onRetryState,
          attempt,
          delayMs: retryDelay,
          errorCategory: isRateLimit ? 'rate_limit' : 'temporary',
        });
        continue;
      }
      throw new BadRequestException({
        code: 'gmail_api_request_failed',
        providerCode,
        diagnostic: this.oauthDiagnostic(providerCode),
      });
    }
  }

  private async waitBeforeRetry({
    onRetryState,
    attempt,
    delayMs,
    errorCategory,
  }: {
    onRetryState?: RetryStateListener;
    attempt: number;
    delayMs: number;
    errorCategory: 'rate_limit' | 'temporary';
  }): Promise<void> {
    await onRetryState?.({
      status: 'waiting',
      retryAt: Date.now() + delayMs,
      attempt: attempt + 1,
      errorCategory,
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await onRetryState?.({
      status: 'retrying',
      attempt: attempt + 1,
      errorCategory,
    });
  }

  /** Llamada al endpoint de token con su propio límite de tiempo. */
  private async requestGoogleToken(form: URLSearchParams): Promise<Response> {
    try {
      return await fetch(GMAIL_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(GMAIL_TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      if (!isTimeoutError(error)) {
        throw error;
      }
      throw new ServiceUnavailableException({
        code: 'gmail_token_timeout',
        providerCode: 'timeout',
        diagnostic: this.oauthDiagnostic('timeout'),
      });
    }
  }

  private isRetryableGmailError(status: number, providerCode: string) {
    return (
      status === 429 ||
      status >= 500 ||
      providerCode === 'rateLimitExceeded' ||
      providerCode === 'userRateLimitExceeded'
    );
  }

  private requireOAuthConfig() {
    const clientId = this.config.get('AI_GMAIL_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('AI_GMAIL_CLIENT_SECRET', {
      infer: true,
    });
    const redirectUri = this.config.get('AI_GMAIL_REDIRECT_URI', {
      infer: true,
    });
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException({
        code: 'gmail_oauth_not_configured',
        diagnostic: this.oauthDiagnostic('missing_configuration'),
      });
    }
    return { clientId, clientSecret, redirectUri };
  }

  private createState({
    userId,
    importStartAt,
    senderFilter,
  }: {
    userId: string;
    importStartAt: Date | null;
    /** `undefined` conserva el filtro anterior; `null` lo borra. */
    senderFilter?: string | null;
  }): string {
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        importStartAt: importStartAt?.toISOString() ?? null,
        senderFilter,
        expiresAt: Date.now() + STATE_TTL_MS,
        nonce: randomBytes(16).toString('base64url'),
      }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private verifyState(state: string): {
    userId: string;
    importStartAt: Date | null;
    senderFilter?: string | null;
  } {
    const [payload, signature, extra] = state.split('.');
    if (!payload || !signature || extra) {
      throw new BadRequestException('OAuth state inválido');
    }
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      throw new BadRequestException('OAuth state inválido');
    }
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        userId?: string;
        importStartAt?: string | null;
        senderFilter?: string | null;
        expiresAt?: number;
      };
      if (
        !data.userId ||
        typeof data.expiresAt !== 'number' ||
        data.expiresAt < Date.now()
      ) {
        throw new Error('expired');
      }
      const importStartAt = data.importStartAt
        ? new Date(data.importStartAt)
        : null;
      if (importStartAt && Number.isNaN(importStartAt.getTime())) {
        throw new Error('invalid import start');
      }
      if (
        data.senderFilter !== undefined &&
        data.senderFilter !== null &&
        !isSenderFilter(data.senderFilter)
      ) {
        throw new Error('invalid sender filter');
      }
      return {
        userId: data.userId,
        importStartAt,
        senderFilter: data.senderFilter,
      };
    } catch {
      throw new BadRequestException('OAuth state vencido o inválido');
    }
  }

  private sign(payload: string): string {
    return createHmac(
      'sha256',
      this.config.getOrThrow('AI_GMAIL_TOKEN_ENCRYPTION_KEY', { infer: true }),
    )
      .update(payload)
      .digest('base64url');
  }

  private oauthDiagnostic(providerCode: string) {
    const diagnostics: Record<string, string> = {
      access_denied: 'El usuario canceló el consentimiento de Gmail.',
      invalid_grant:
        'El código venció o Google revocó el refresh token; vuelve a conectar Gmail.',
      redirect_uri_mismatch:
        'La URL de callback configurada no coincide con la registrada en Google Cloud.',
      refresh_token_missing:
        'Google no devolvió refresh token; vuelve a autorizar con consentimiento explícito.',
      insufficientPermissions: 'La autorización no incluye gmail.readonly.',
      missing_configuration:
        'Falta AI_GMAIL_CLIENT_ID, AI_GMAIL_CLIENT_SECRET o AI_GMAIL_REDIRECT_URI.',
      timeout:
        'Google no respondió dentro del tiempo límite; se reintenta en la próxima corrida.',
    };
    return (
      diagnostics[providerCode] ?? 'Revisa la configuración OAuth de Gmail.'
    );
  }
}
