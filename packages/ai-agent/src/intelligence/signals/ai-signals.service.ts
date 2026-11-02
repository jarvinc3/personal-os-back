import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import {
  assertAiSignalTransition,
  type AiSignalStatus,
} from './ai-signal-lifecycle';
import type { SignalConsumer } from '@personal-os/contracts';

@Injectable()
export class AiSignalsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const signals = await this.prisma.aiSignal.findMany({
      where: { userId },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return { data: signals };
  }

  async getForUser(userId: string, signalId: string) {
    const signal = await this.prisma.aiSignal.findFirst({
      where: { id: signalId, userId },
      include: { evidence: { orderBy: { createdAt: 'asc' } } },
    });
    if (!signal) {
      throw new NotFoundException('Señal no encontrada');
    }
    return signal;
  }

  async transition(
    userId: string,
    signalId: string,
    nextStatus: AiSignalStatus,
  ) {
    const current = await this.prisma.aiSignal.findFirst({
      where: { id: signalId, userId },
      select: { status: true },
    });
    if (!current) {
      throw new NotFoundException('Señal no encontrada');
    }
    assertAiSignalTransition(current.status, nextStatus);
    const updated = await this.prisma.aiSignal.updateMany({
      where: { id: signalId, userId, status: current.status },
      data: { status: nextStatus },
    });
    if (updated.count !== 1) {
      throw new ConflictException('La señal cambió durante la transición');
    }
    return this.getForUser(userId, signalId);
  }

  async recordConsumerOutcome(
    userId: string,
    signalId: string,
    result: Awaited<ReturnType<SignalConsumer['consume']>>,
  ) {
    const current = await this.prisma.aiSignal.findFirst({
      where: { id: signalId, userId, status: 'ROUTED' },
      select: { payload: true },
    });
    if (!current) {
      return;
    }
    const payload = current.payload as Record<string, unknown>;
    const status =
      result.outcome === 'REJECTED'
        ? 'FAILED'
        : result.outcome === 'REVIEW_REQUIRED'
          ? 'ROUTED'
          : 'CONSUMED';
    await this.prisma.aiSignal.updateMany({
      where: { id: signalId, userId, status: 'ROUTED' },
      data: {
        status,
        payload: {
          ...payload,
          consumption: {
            outcome: result.outcome,
            reason: result.reason ?? null,
            domainReferences: result.domainReferences,
            processedAt: new Date().toISOString(),
          },
        },
      },
    });
  }
}
