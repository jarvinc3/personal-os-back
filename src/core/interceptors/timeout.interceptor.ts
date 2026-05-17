import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

export const TIMEOUT_MS_KEY = 'timeoutMs';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ url: string }>();

    const configuredTimeout = this.reflector.getAllAndOverride<number>(
      TIMEOUT_MS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const timeoutMs = configuredTimeout ?? (request.url.startsWith('/api/ai') ? 30_000 : 5_000);

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) => {
        if (error instanceof TimeoutError) {
          return throwError(
            () =>
              new RequestTimeoutException(
                `Request timed out after ${timeoutMs}ms`,
              ),
          );
        }
        return throwError(() => error);
      }),
    );
  }
}
