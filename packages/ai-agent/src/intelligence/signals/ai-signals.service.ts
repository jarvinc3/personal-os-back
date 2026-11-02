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
}
