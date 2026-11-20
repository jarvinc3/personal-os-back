import { Injectable } from '@nestjs/common';
import { PrismaService } from '@personal-os/database';
import type { Prisma } from '@personal-os/database';
import type { ProactiveSignalSnapshot } from './proactive-relevance';

const SUGGESTION_LIMIT = 20;

const SUGGESTION_SELECT = {
  id: true,
  signalId: true,
  signalType: true,
  title: true,
  body: true,
  actionId: true,
  createdAt: true,
} satisfies Prisma.AiProactiveSuggestionSelect;

export type ProactiveSuggestionRow = Prisma.AiProactiveSuggestionGetPayload<{
  select: typeof SUGGESTION_SELECT;
}>;

export type ProactiveDiscardRow = {
  windowStartedAt: Date;
  discarded: number;
};

export type NewProactiveSuggestion = {
  userId: string;
  signalId: string;
  signalType: string;
  title: string;
  body: string;
};

@Injectable()
export class ProactiveSuggestionStore {
  constructor(private readonly prisma: PrismaService) {}

  async findSignal({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<ProactiveSignalSnapshot | null> {
    return this.prisma.aiSignal.findFirst({
      where: { id: signalId, userId },
      select: { type: true, status: true, payload: true },
    });
  }

  async findSuggestion({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<ProactiveSuggestionRow | null> {
    return this.prisma.aiProactiveSuggestion.findFirst({
      where: { userId, signalId },
      select: SUGGESTION_SELECT,
    });
  }

  async listForUser(userId: string): Promise<ProactiveSuggestionRow[]> {
    return this.prisma.aiProactiveSuggestion.findMany({
      where: { userId },
      select: SUGGESTION_SELECT,
      orderBy: { createdAt: 'desc' },
      take: SUGGESTION_LIMIT,
    });
  }

  /**
   * Guarda la sugerencia del evento. La clave única deja una sola por señal:
   * un reintento del outbox devuelve null en lugar de duplicar la fila.
   */
  async create(
    suggestion: NewProactiveSuggestion,
  ): Promise<ProactiveSuggestionRow | null> {
    const { count } = await this.prisma.aiProactiveSuggestion.createMany({
      data: [suggestion],
      skipDuplicates: true,
    });
    if (count === 0) {
      return null;
    }
    return this.findSuggestion({
      userId: suggestion.userId,
      signalId: suggestion.signalId,
    });
  }

  async setActionId({
    userId,
    suggestionId,
    actionId,
  }: {
    userId: string;
    suggestionId: string;
    actionId: string;
  }): Promise<void> {
    await this.prisma.aiProactiveSuggestion.updateMany({
      where: { id: suggestionId, userId },
      data: { actionId },
    });
  }

  /** Suma un evento omitido y reinicia la cuenta cuando cambia la ventana. */
  async recordDiscard({
    userId,
    windowStartedAt,
  }: {
    userId: string;
    windowStartedAt: Date;
  }): Promise<void> {
    const reset = await this.prisma.aiProactiveDiscard.updateMany({
      where: { userId, windowStartedAt: { lt: windowStartedAt } },
      data: { windowStartedAt, discarded: 1 },
    });
    if (reset.count > 0) {
      return;
    }
    await this.prisma.aiProactiveDiscard.upsert({
      where: { userId },
      create: { userId, windowStartedAt, discarded: 1 },
      update: { discarded: { increment: 1 } },
    });
  }

  async findDiscard(userId: string): Promise<ProactiveDiscardRow | null> {
    return this.prisma.aiProactiveDiscard.findUnique({
      where: { userId },
      select: { windowStartedAt: true, discarded: true },
    });
  }
}
