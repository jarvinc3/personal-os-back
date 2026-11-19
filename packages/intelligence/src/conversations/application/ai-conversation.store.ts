import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiConversationMessage } from '@personal-os/contracts';
import type { AiInvocationContext } from '@personal-os/core';
import { Prisma, PrismaService } from '@personal-os/database';
import { aiInvocationContextKey } from './ai-invocation-context-key';

const LEGACY_CONTEXT_BATCH_SIZE = 50;

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

  async append(
    userId: string,
    conversationId: string,
    message: AiConversationMessage,
  ): Promise<void> {
    const role = message.role.toUpperCase() as 'USER' | 'ASSISTANT' | 'TOOL';
    await this.prisma.aiConversationMessage.create({
      data: {
        userId,
        conversationId,
        role,
        content: message.content,
        name: message.name,
        toolCallId: message.toolCallId,
        toolCalls: message.toolCalls
          ? (message.toolCalls as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });
    await this.prisma.aiConversation.updateMany({
      where: { id: conversationId, userId },
      data: { updatedAt: new Date() },
    });
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
