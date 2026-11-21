import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';
import { requestLogPath } from '../observability/request-log';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      method: string;
      url?: string;
      originalUrl?: string;
      baseUrl?: string;
      route?: { path?: string | string[] };
      id?: string;
      user?: { sub?: string };
    }>();
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number }>();

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startedAt;
          this.logger.info(
            {
              method: request.method,
              path: requestLogPath(request),
              statusCode: response.statusCode,
              durationMs,
              requestId: request.id,
              userId: request.user?.sub,
            },
            'HTTP request completed',
          );
        },
        error: (error: unknown) => {
          const durationMs = Date.now() - startedAt;
          this.logger.error(
            {
              method: request.method,
              path: requestLogPath(request),
              statusCode: response.statusCode,
              durationMs,
              requestId: request.id,
              userId: request.user?.sub,
              error: error instanceof Error ? error.message : String(error),
            },
            'HTTP request failed',
          );
        },
      }),
    );
  }
}
