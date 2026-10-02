import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AiMetricsInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{
      url: string;
      body?: { sessionId?: string };
    }>();

    if (!request.url.startsWith('/api/ai')) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        void this.recordMetrics(request.body?.sessionId, startedAt);
      }),
    );
  }

  private async recordMetrics(
    sessionId: string | undefined,
    startedAt: number,
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    const latencyMs = Date.now() - startedAt;
    const session = await this.prisma.aiAgentSession.findUnique({
      where: { id: sessionId },
      select: { memorySnapshot: true },
    });

    if (!session) {
      return;
    }

    const memory = (session.memorySnapshot ?? {}) as Record<string, unknown>;
    const previousMetrics =
      memory.metrics && typeof memory.metrics === 'object'
        ? (memory.metrics as Record<string, unknown>)
        : {};

    await this.prisma.aiAgentSession.update({
      where: { id: sessionId },
      data: {
        memorySnapshot: {
          ...memory,
          metrics: {
            ...previousMetrics,
            lastLatencyMs: latencyMs,
            lastMeasuredAt: new Date().toISOString(),
          },
        },
      },
    });
  }
}
