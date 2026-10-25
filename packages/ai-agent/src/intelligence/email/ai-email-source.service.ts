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
import { decryptToken, encryptToken } from './token-encryption.util';

const GMAIL_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1';
const GMAIL_API_MAX_RETRIES = 3;
const GMAIL_API_BASE_RETRY_MS = 1_000;
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
        initialSyncCompletedAt: true,
        lastSyncedAt: true,
        lastRecoverySyncAt: true,
        importedMessageCount: true,
        lastSyncErrorCode: true,
      },
    });
    const [messageCount, recentCount] = connection
      ? await Promise.all([
          this.prisma.aiEmailMessage.count({ where: { userId } }),
          this.prisma.aiEmailMessage.count({
            where: {
              userId,
              receivedAt: { gte: new Date(Date.now() - 30 * 86400_000) },
            },
          }),
        ])
      : [0, 0];
    const role = await this.prisma.userRole.findUnique({
      where: { userId },
      select: { role: true },
    });

    return {
      connection: connection
        ? {
            connected: connection.isActive,
            emailAddress: connection.emailAddress,
            initialSyncCompletedAt: connection.initialSyncCompletedAt,
            lastSyncedAt: connection.lastSyncedAt,
            lastRecoverySyncAt: connection.lastRecoverySyncAt,
            lastSyncErrorCode: connection.lastSyncErrorCode,
          }
        : { connected: false },
      counters: {
        importedMessages: messageCount,
        recentMessages: recentCount,
        bootstrapImportedMessages: connection?.importedMessageCount ?? 0,
      },
      role: role?.role ?? 'USER',
    };
  }

  async listMessages(userId: string, cursor?: string) {
    let cursorValues: { receivedAt: string; id: string } | undefined;
    if (cursor) {
      try {
        cursorValues = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8'),
        ) as { receivedAt: string; id: string };
        if (
          !cursorValues.id ||
          !Number.isFinite(Date.parse(cursorValues.receivedAt))
        ) {
          throw new Error('invalid cursor');
        }
      } catch {
        throw new BadRequestException('Cursor inválido');
      }
    }
    const rows = await this.prisma.aiEmailMessage.findMany({
      where: {
        userId,
        ...(cursorValues
          ? {
              OR: [
                { receivedAt: { lt: new Date(cursorValues.receivedAt) } },
                {
                  receivedAt: new Date(cursorValues.receivedAt),
                  id: { lt: cursorValues.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
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

  async getMessage(userId: string, messageId: string) {
    const message = await this.prisma.aiEmailMessage.findFirst({
      where: { id: messageId, userId },
      include: { content: true },
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

  createAuthorizationUrl(userId: string): string {
    const { clientId, redirectUri } = this.requireOAuthConfig();
    const state = this.createState(userId);
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
    const userId = this.verifyState(state);
    const { clientId, clientSecret, redirectUri } = this.requireOAuthConfig();
    const tokenResponse = await fetch(GMAIL_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
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
      select: { refreshTokenEncrypted: true },
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
    const connection = await this.prisma.aiEmailConnection.upsert({
      where: { userId },
      create: {
        userId,
        emailAddress: profile.emailAddress,
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        refreshTokenEncrypted,
        tokenExpiresAt: expiresAt,
        providerCursor: profile.historyId,
      },
      update: {
        emailAddress: profile.emailAddress,
        isActive: true,
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        refreshTokenEncrypted,
        tokenExpiresAt: expiresAt,
        providerCursor: profile.historyId,
        lastSyncErrorCode: null,
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
    const response = await fetch(GMAIL_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const token = (await response.json()) as OAuthTokenResponse;
    if (!response.ok || !token.access_token) {
      await this.prisma.aiEmailConnection.update({
        where: { id: connectionId },
        data: { lastSyncErrorCode: token.error || 'token_refresh_failed' },
      });
      throw new ServiceUnavailableException('gmail_token_refresh_failed');
    }
    const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
    await this.prisma.aiEmailConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEncrypted: encryptToken(token.access_token, encryptionKey),
        tokenExpiresAt: expiresAt,
        lastSyncErrorCode: null,
      },
    });
    return token.access_token;
  }

  async gmailApiRequest<T>(
    accessToken: string,
    path: string,
    onRetryState?: (state: {
      status: 'waiting' | 'retrying';
      retryAt?: number;
      attempt: number;
    }) => void,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${GMAIL_API}${path}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
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
      if (
        attempt < GMAIL_API_MAX_RETRIES &&
        this.isRetryableGmailError(response.status, providerCode)
      ) {
        const retryAfter = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
        const retryDelay = Number.isFinite(retryAfterSeconds)
          ? Math.min(30_000, Math.max(0, retryAfterSeconds * 1_000))
          : GMAIL_API_BASE_RETRY_MS * 2 ** attempt;
        onRetryState?.({
          status: 'waiting',
          retryAt: Date.now() + retryDelay,
          attempt: attempt + 1,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        onRetryState?.({ status: 'retrying', attempt: attempt + 1 });
        continue;
      }
      throw new BadRequestException({
        code: 'gmail_api_request_failed',
        providerCode,
        diagnostic: this.oauthDiagnostic(providerCode),
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

  private createState(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        userId,
        expiresAt: Date.now() + STATE_TTL_MS,
        nonce: randomBytes(16).toString('base64url'),
      }),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  private verifyState(state: string): string {
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
        expiresAt?: number;
      };
      if (
        !data.userId ||
        typeof data.expiresAt !== 'number' ||
        data.expiresAt < Date.now()
      ) {
        throw new Error('expired');
      }
      return data.userId;
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
    };
    return (
      diagnostics[providerCode] ?? 'Revisa la configuración OAuth de Gmail.'
    );
  }
}
