import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { IdempotencyStatus, PrismaService } from '@personal-os/database';

/**
 * Header the client sends to make a mutation retry-safe. It is optional: a
 * request without it keeps the previous behavior.
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Only mutations can duplicate work when retried. */
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set([
  'POST',
  'PATCH',
  'DELETE',
]);

/** Saved responses stop being reusable 24 h after the first attempt. */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;

const PRISMA_UNIQUE_VIOLATION = 'P2002';

const IN_PROGRESS_MESSAGE =
  'Ya hay una petición con esa Idempotency-Key en curso; inténtalo de nuevo.';
const MISMATCH_MESSAGE =
  'Esa Idempotency-Key ya se usó con una petición distinta; usa una clave nueva.';

type IdempotentRequest = {
  method: string;
  originalUrl: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  user?: { sub?: string };
};

type IdempotencyScope = {
  userId: string;
  key: string;
  method: string;
  path: string;
  requestHash: string;
};

type StoredIdempotency = {
  method: string;
  path: string;
  requestHash: string;
};

type ReplayResult = { replayed: true; body: unknown } | { replayed: false };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IdempotencyInterceptor.name);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<IdempotentRequest>();
    const idempotencyKey = readIdempotencyKey(request);
    const userId = request.user?.sub;
    if (!idempotencyKey || !userId || !IDEMPOTENT_METHODS.has(request.method)) {
      return next.handle();
    }

    const scope: IdempotencyScope = {
      userId,
      key: idempotencyKey,
      method: request.method,
      path: request.originalUrl,
      requestHash: hashRequestBody(request.body),
    };

    const replay = await this.replayBody(scope);
    if (replay.replayed) {
      return of(replay.body);
    }

    await this.claimKey(scope);
    return this.runOnce(context, next, scope);
  }

  /** Looks up a finished request with the same key and body. */
  private async replayBody(scope: IdempotencyScope): Promise<ReplayResult> {
    const stored = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: scope.userId, key: scope.key } },
    });
    if (!stored) {
      return { replayed: false };
    }
    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.prisma.idempotencyKey.delete({ where: { id: stored.id } });
      return { replayed: false };
    }
    if (stored.status === IdempotencyStatus.IN_PROGRESS) {
      throw new ConflictException(IN_PROGRESS_MESSAGE);
    }
    if (!sameRequest(stored, scope)) {
      throw new ConflictException(MISMATCH_MESSAGE);
    }
    return {
      replayed: true,
      body:
        stored.responseBody === null
          ? undefined
          : (JSON.parse(stored.responseBody) as unknown),
    };
  }

  private runOnce(
    context: ExecutionContext,
    next: CallHandler,
    scope: IdempotencyScope,
  ): Observable<unknown> {
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number; headersSent: boolean }>();

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        // Handlers with @Res() write the response themselves (SSE streams);
        // there is no serialized body to replay, so the key is released.
        if (response.headersSent) {
          await this.releaseKey(scope);
          return body;
        }
        await this.completeKey({
          scope,
          responseStatus: response.statusCode,
          body,
        });
        return body;
      }),
      catchError((error: unknown) =>
        from(this.releaseKey(scope)).pipe(
          catchError((releaseError: unknown) => {
            this.logger.error(
              { err: releaseError, key: scope.key, userId: scope.userId },
              'No se pudo liberar la Idempotency-Key',
            );
            return of(undefined);
          }),
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  private async claimKey(scope: IdempotencyScope): Promise<void> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          userId: scope.userId,
          key: scope.key,
          method: scope.method,
          path: scope.path,
          requestHash: scope.requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          expiresAt: new Date(Date.now() + KEY_TTL_MS),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(IN_PROGRESS_MESSAGE);
      }
      throw error;
    }
  }

  private async completeKey({
    scope,
    responseStatus,
    body,
  }: {
    scope: IdempotencyScope;
    responseStatus: number;
    body: unknown;
  }): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { userId_key: { userId: scope.userId, key: scope.key } },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseStatus,
        responseBody:
          body === undefined || body === null ? null : JSON.stringify(body),
      },
    });
  }

  /**
   * A failed attempt must not block the retry: the key is removed on any
   * error, so a 5xx (or any other failure) can be sent again.
   */
  private async releaseKey(scope: IdempotencyScope): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({
      where: { userId: scope.userId, key: scope.key },
    });
  }
}

function readIdempotencyKey(request: IdempotentRequest): string | undefined {
  const headerValue = request.headers[IDEMPOTENCY_KEY_HEADER];
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sameRequest(
  stored: StoredIdempotency,
  scope: IdempotencyScope,
): boolean {
  return (
    stored.method === scope.method &&
    stored.path === scope.path &&
    stored.requestHash === scope.requestHash
  );
}

function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/** Key order in the JSON body must not change the hash of the same payload. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return `{${entries
    .map(
      ([entryKey, entryValue]) =>
        `${JSON.stringify(entryKey)}:${stableStringify(entryValue)}`,
    )
    .join(',')}}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}
