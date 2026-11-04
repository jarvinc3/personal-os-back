import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiConversationMessage } from '@personal-os/contracts';
import { Prisma, PrismaService } from '@personal-os/database';

@Injectable()
export class AiConversationStore {
  constructor(private readonly prisma: PrismaService) {}

  create(userId: string) {
    return this.prisma.aiConversation.create({
      data: { userId },
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
