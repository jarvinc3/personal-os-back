import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Observable, tap } from 'rxjs';
import {
  TimedRequest,
  requestDurationMs,
  requestLogPath,
} from '../observability/request-log';

/**
 * Logs one line per request that the handler answers. Failures are logged by
 * `AllExceptionsFilter`, which also sees rejections from guards and middleware:
 * those run before this interceptor, so logging both places duplicates them.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LoggingInterceptor.name);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<
      TimedRequest & {
        method: string;
        url?: string;
        originalUrl?: string;
        baseUrl?: string;
        route?: { path?: string | string[] };
        id?: string;
        user?: { sub?: string };
      }
    >();
    const response = context
      .switchToHttp()
      .getResponse<{ statusCode: number }>();

    request.startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.info(
          {
            method: request.method,
            path: requestLogPath(request),
            statusCode: response.statusCode,
            durationMs: requestDurationMs(request, Date.now()),
            requestId: request.id,
            userId: request.user?.sub,
          },
          'HTTP request completed',
        );
      }),
    );
  }
}
