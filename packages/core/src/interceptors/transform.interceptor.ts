import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

type ApiEnvelope<T> = {
  data: T;
  meta: {
    timestamp: string;
    path: string;
    requestId?: string;
  };
};

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiEnvelope<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T>> {
    const request = context.switchToHttp().getRequest<{
      url: string;
      id?: string;
    }>();

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: {
          timestamp: new Date().toISOString(),
          path: request.url,
          requestId: request.id,
        },
      })),
    );
  }
}
