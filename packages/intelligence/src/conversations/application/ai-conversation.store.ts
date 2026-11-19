import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiConversationMessage } from '@personal-os/contracts';
import type { AiInvocationContext } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import { aiInvocationContextKey } from './ai-invocation-context-key';

const LEGACY_CONTEXT_BATCH_SIZE = 50;

export type StoredTurnMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  clientMessageId: string | null;
  provider: string | null;
  model: string | null;
  createdAt: Date;
};

export type StoredConversationTurn = {
  user: StoredTurnMessage | null;
  assistant: StoredTurnMessage | null;
};

type AppendedMessage = {
  message: AiConversationMessage;
  clientMessageId?: string;
  provider?: string;
  model?: string;
};

type AppendTurnInput = {
  userId: string;
  conversationId: string;
  messages: readonly AppendedMessage[];
};

type AppendMessageInput = {
  userId: string;
  conversationId: string;
  message: AiConversationMessage;
  clientMessageId?: string;
};

type StoredRole = 'USER' | 'ASSISTANT' | 'TOOL';

function toStoredRole(role: AiConversationMessage['role']): StoredRole {
  return role.toUpperCase() as StoredRole;
}

function toStoredTurnMessage(
  row:
    | {
        id: string;
        role: StoredRole;
        content: string;
        clientMessageId: string | null;
        provider: string | null;
        model: string | null;
        createdAt: Date;
      }
    | undefined,
): StoredTurnMessage | null {
  if (!row || row.role === 'TOOL') {
    return null;
  }
  return {
    id: row.id,
    role: row.role === 'USER' ? 'user' : 'assistant',
    content: row.content,
    clientMessageId: row.clientMessageId,
    provider: row.provider,
    model: row.model,
    createdAt: row.createdAt,
  };
}

function isInvocationContext(value: unknown): value is AiInvocationContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { route?: unknown }).route === 'string'
  );
}

@Injectable()
export class AiConversationStore {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    invocationContext?: Prisma.InputJsonValue,
    contextKey?: string,
  ) {
    return this.prisma.aiConversation.create({
      data: {
        userId,
        ...(invocationContext ? { invocationContext, contextKey } : {}),
      },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  list(userId: string) {
    return this.prisma.aiConversation.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
  }

  async findOwned(userId: string, conversationId: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, userId },
      select: {
        id: true,
        title: true,
        summary: true,
        summaryUpdatedAt: true,
        invocationContext: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { sequence: 'asc' },
          select: {
            role: true,
            content: true,
            name: true,
            toolCallId: true,
            toolCalls: true,
            createdAt: true,
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    return {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        role: message.role.toLowerCase() as AiConversationMessage['role'],
        content: message.content,
        ...(message.name ? { name: message.name } : {}),
        ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
        ...(Array.isArray(message.toolCalls)
          ? {
              toolCalls:
                message.toolCalls as unknown as AiConversationMessage['toolCalls'],
            }
          : {}),
        createdAt: message.createdAt,
      })),
    };
  }

  async findLatestByContext(userId: string, contextKey: string) {
    await this.backfillLegacyContextKeys(userId);
    const latest = await this.prisma.aiConversation.findFirst({
      where: { userId, contextKey },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    return latest ? this.findOwned(userId, latest.id) : null;
  }

  private async touchConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId },
      data: { updatedAt: new Date() },
    });
  }

  /**
   * Completes the key of conversations stored before the column existed. Bounded
   * per query, and it writes `updatedAt` back because Prisma would otherwise
   * move every migrated row to now and break the latest-by-context order.
   */
  private async backfillLegacyContextKeys(userId: string): Promise<void> {
    const legacyConversations = await this.prisma.aiConversation.findMany({
      where: {
        userId,
        contextKey: null,
        invocationContext: { not: Prisma.DbNull },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: LEGACY_CONTEXT_BATCH_SIZE,
      select: { id: true, updatedAt: true, invocationContext: true },
    });
    for (const conversation of legacyConversations) {
      if (!isInvocationContext(conversation.invocationContext)) {
        continue;
      }
      await this.prisma.aiConversation.updateMany({
        where: { id: conversation.id, userId, contextKey: null },
        data: {
          contextKey: aiInvocationContextKey(conversation.invocationContext),
          updatedAt: conversation.updatedAt,
        },
      });
    }
  }

  async setInvocationContext(
    userId: string,
    conversationId: string,
    invocationContext: Prisma.InputJsonValue,
    contextKey: string,
  ): Promise<void> {
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId },
      data: { invocationContext, contextKey },
    });
  }

  async append({
    userId,
    conversationId,
    message,
    clientMessageId,
  }: AppendMessageInput): Promise<void> {
    await this.prisma.aiConversationMessage.create({
      data: {
        userId,
        conversationId,
        role: toStoredRole(message.role),
        content: message.content,
        name: message.name,
        toolCallId: message.toolCallId,
        toolCalls: message.toolCalls
          ? (message.toolCalls as unknown as Prisma.InputJsonValue)
          : undefined,
        clientMessageId,
      },
    });
    await this.touchConversation(userId, conversationId);
  }

  /**
   * Guarda el turno completo en una sola transacción: si algo falla, no quedan
   * llamadas ni resultados de herramientas a medias.
   */
  async appendTurn({
    userId,
    conversationId,
    messages,
  }: AppendTurnInput): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    await this.prisma.$transaction(async (transaction) => {
      for (const entry of messages) {
        await transaction.aiConversationMessage.create({
          data: {
            userId,
            conversationId,
            role: toStoredRole(entry.message.role),
            content: entry.message.content,
            name: entry.message.name,
            toolCallId: entry.message.toolCallId,
            toolCalls: entry.message.toolCalls
              ? (entry.message.toolCalls as unknown as Prisma.InputJsonValue)
              : undefined,
            clientMessageId: entry.clientMessageId,
            provider: entry.provider,
            model: entry.model,
          },
        });
      }
      await transaction.aiConversation.updateMany({
        where: { id: conversationId, userId },
        data: { updatedAt: new Date() },
      });
    });
  }

  async findTurn({
    userId,
    conversationId,
    clientMessageId,
  }: {
    userId: string;
    conversationId: string;
    clientMessageId: string;
  }): Promise<StoredConversationTurn> {
    const rows = await this.prisma.aiConversationMessage.findMany({
      where: {
        userId,
        conversationId,
        clientMessageId,
        role: { in: ['USER', 'ASSISTANT'] },
      },
      select: {
        id: true,
        role: true,
        content: true,
        clientMessageId: true,
        provider: true,
        model: true,
        createdAt: true,
      },
    });
    return {
      user: toStoredTurnMessage(rows.find((row) => row.role === 'USER')),
      assistant: toStoredTurnMessage(
        rows.find((row) => row.role === 'ASSISTANT'),
      ),
    };
  }

  async setTitleFromFirstMessage(
    userId: string,
    conversationId: string,
    content: string,
  ): Promise<void> {
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId, title: 'Nueva conversación' },
      data: { title: content.trim().replace(/\s+/g, ' ').slice(0, 80) },
    });
  }

  async saveSummary(
    userId: string,
    conversationId: string,
    summary: string,
  ): Promise<void> {
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId },
      data: { summary, summaryUpdatedAt: new Date() },
    });
  }

  async deleteOwned(userId: string, conversationId: string): Promise<void> {
    const { count } = await this.prisma.aiConversation.deleteMany({
      where: { id: conversationId, userId },
    });
    if (!count) {
      throw new NotFoundException('Conversación no encontrada');
    }
  }
}
