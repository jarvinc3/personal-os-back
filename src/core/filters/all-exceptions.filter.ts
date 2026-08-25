import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';
import { toErrorField } from '../exceptions/http-error.util';

type PrismaKnownErrorLike = Error & {
  code?: string;
  meta?: Record<string, unknown>;
};

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
    const request = ctx.getRequest<{ url: string; id?: string; method: string }>();
    const response = ctx.getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();

    const isProduction =
      this.config.get('NODE_ENV', { infer: true }) === 'production';
    const { statusCode, error, message } = this.resolveException(
      exception,
      isProduction,
    );

    this.logger.error(
      {
        requestId: request.id,
        method: request.method,
        path: request.url,
        statusCode,
        error,
        message:
          exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      },
      'Unhandled exception',
    );

    response.status(statusCode).json({
      statusCode,
      error,
      message,
      requestId: request.id,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private resolveException(
    exception: unknown,
    isProduction: boolean,
  ): {
    statusCode: number;
    error: string;
    message: string;
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
        const body = payload as Record<string, unknown>;
        return {
          statusCode,
          error: toErrorField(body.error, exception.name),
          message: toErrorField(body.message, exception.message),
        };
      }

      return {
        statusCode,
        error: exception.name,
        message: exception.message,
      };
    }

    const prisma = exception as PrismaKnownErrorLike;
    if (prisma.code === 'P2002') {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Unique constraint violation',
      };
    }

    if (prisma.code === 'P2025') {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Requested resource was not found',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: isProduction
        ? 'Internal server error'
        : exception instanceof Error
          ? exception.message
          : 'Unexpected error',
    };
  }
}
