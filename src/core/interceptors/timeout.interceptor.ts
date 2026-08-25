import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { TIMEOUT_MS_KEY } from '../decorators/timeout.decorator';

export { TIMEOUT_MS_KEY };

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const configuredTimeout = this.reflector.getAllAndOverride<number>(
      TIMEOUT_MS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const timeoutMs = configuredTimeout ?? 5_000;

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
