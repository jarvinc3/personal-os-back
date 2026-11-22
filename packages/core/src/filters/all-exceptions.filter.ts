import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '@personal-os/config';
import {
  httpExceptionDetails,
  toErrorField,
} from '../exceptions/http-error.util';
import { PRISMA_ERROR_CODE } from '../exceptions/prisma-error-code';
import {
  requestDurationMs,
  requestLogPath,
  type TimedRequest,
} from '../observability/request-log';

type PrismaKnownErrorLike = Error & {
  code?: string;
  meta?: Record<string, unknown>;
};

/** 5xx: the failures Sentry should see, unlike expected 4xx client flow. */
const SERVER_ERROR_MIN_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<
      TimedRequest & {
        url: string;
        originalUrl?: string;
        baseUrl?: string;
        route?: { path?: string | string[] };
        id?: string;
        method: string;
        user?: { sub?: string };
      }
    >();
    const response = ctx.getResponse<{
      headersSent: boolean;
      status: (code: number) => { json: (body: unknown) => void };
      destroy: (error?: Error) => void;
    }>();

    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    const { statusCode, error, message, details } = this.resolveException(
      exception,
      isProduction,
    );

    const durationMs = requestDurationMs(request, Date.now());
    const isServerError = statusCode >= SERVER_ERROR_MIN_STATUS;
    const failureLog = {
      requestId: request.id,
      method: request.method,
      path: requestLogPath(request),
      statusCode,
      error,
      responseStarted: response.headersSent,
      ...(durationMs === undefined ? {} : { durationMs }),
      message:
        exception instanceof Error ? exception.message : String(exception),
      ...(isServerError && exception instanceof Error
        ? { stack: exception.stack }
        : {}),
    };

    // One line per failed request: 4xx are expected client flow and only 5xx
    // are incidents, so both the level and Sentry follow the real status.
    if (isServerError) {
      this.logger.error(failureLog, 'HTTP request failed');
      this.reportToSentry({ exception, request, statusCode });
    } else {
      this.logger.warn(failureLog, 'HTTP request failed');
    }

    const errorCode =
      typeof details?.code === 'string' ? details.code : undefined;
    if (response.headersSent) {
      // SSE and streamed exports already wrote a body: another status or JSON
      // would throw ERR_HTTP_HEADERS_SENT. Cut the socket instead.
      response.destroy(
        exception instanceof Error
          ? exception
          : new Error(`Response already started: ${message}`),
      );
      return;
    }
    response.status(statusCode).json({
      statusCode,
      error,
      ...(errorCode ? { code: errorCode } : {}),
      message,
      ...(details ? { details } : {}),
      requestId: request.id,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  /**
   * 4xx are expected client flow and would only add noise; only 5xx reach
   * Sentry. The query string and path parameters are replaced by the matched
   * route template so a token never travels with the event.
   */
  private reportToSentry({
    exception,
    request,
    statusCode,
  }: {
    exception: unknown;
    request: {
      url: string;
      originalUrl?: string;
      baseUrl?: string;
      route?: { path?: string | string[] };
      method: string;
      user?: { sub?: string };
    };
    statusCode: number;
  }): void {
    const userId = request.user?.sub;
    Sentry.captureException(exception, {
      ...(userId ? { user: { id: userId } } : {}),
      extra: {
        method: request.method,
        path: requestLogPath(request),
        statusCode,
      },
    });
  }

  private resolveException(
    exception: unknown,
    isProduction: boolean,
  ): {
    statusCode: number;
    error: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          statusCode,
          error: exception.name,
          message: payload,
        };
      }

      if (typeof payload === 'object' && payload !== null) {
        // `getResponse()` is typed as the base object; only envelope keys are
        // read from it here.
        const body = payload as Record<string, unknown>;
        const details = httpExceptionDetails(body);
        return {
          statusCode,
          error: toErrorField(body.error, exception.name),
          message: toErrorField(body.message, exception.message),
          ...(details ? { details } : {}),
        };
      }

      return {
        statusCode,
        error: exception.name,
        message: exception.message,
      };
    }

    // A rejection that is not an HttpException may still be a Prisma client
    // error; only its `code` is read.
    const prisma = exception as PrismaKnownErrorLike;
    if (prisma.code === PRISMA_ERROR_CODE.UNIQUE_VIOLATION) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Ya existe un registro con esos datos',
      };
    }

    if (prisma.code === PRISMA_ERROR_CODE.RECORD_NOT_FOUND) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'No se encontró el recurso solicitado',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: serverErrorMessage(exception, isProduction),
    };
  }
}

/** Production hides the detail; elsewhere the real message helps the developer. */
function serverErrorMessage(exception: unknown, isProduction: boolean): string {
  if (isProduction) {
    return 'Internal server error';
  }
  if (exception instanceof Error) {
    return exception.message;
  }
  return 'Unexpected error';
}
