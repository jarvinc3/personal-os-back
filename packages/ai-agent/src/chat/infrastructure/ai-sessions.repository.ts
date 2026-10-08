import { Injectable } from '@nestjs/common';
import type { PaginationQueryDto } from '@personal-os/core';
import { paginationArgs } from '@personal-os/core';
import type { AiRole, Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';

@Injectable()
export class AiSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createSession(userId: string, contextType = 'general') {
    return this.prisma.aiAgentSession.create({
      data: {
        userId,
        contextType,
      },
    });
  }

  findSessionsByUser(userId: string, query: PaginationQueryDto) {
    const { skip, take } = paginationArgs(query);
    const where: Prisma.AiAgentSessionWhereInput = { userId };

    return this.prisma.$transaction([
      this.prisma.aiAgentSession.findMany({
        where,
        orderBy: { lastActiveAt: 'desc' },
        skip,
        take,
        include: {
          module: true,
          messages: {
            where: { role: 'user' },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      }),
      this.prisma.aiAgentSession.count({ where }),
    ]);
  }

  findSessionById(sessionId: string, userId: string) {
    return this.prisma.aiAgentSession.findFirst({
      where: { id: sessionId, userId },
      include: {
        module: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  findSessionByIdOnly(sessionId: string) {
    return this.prisma.aiAgentSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        memorySnapshot: true,
      },
    });
  }

  touchSession(sessionId: string) {
    return this.prisma.aiAgentSession.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
  }

  deleteSession(sessionId: string, userId: string) {
    return this.prisma.aiAgentSession.deleteMany({
      where: { id: sessionId, userId },
    });
  }

  deleteAllForUser(userId: string) {
    return this.prisma.aiAgentSession.deleteMany({ where: { userId } });
  }

  createMessage(data: {
    sessionId: string;
    role: AiRole;
    content: string;
    clientMessageId?: string | null;
    metadata?: Record<string, unknown>;
    toolCalls?: Prisma.InputJsonValue;
  }) {
    return this.prisma.aiMessage.create({
      data: {
        sessionId: data.sessionId,
        role: data.role,
        content: data.content,
        clientMessageId: data.clientMessageId ?? null,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        toolCalls: data.toolCalls,
      },
    });
  }

  findRecentMessages(sessionId: string, limit = 40) {
    return this.prisma.aiMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  findUserMessageByClientId(sessionId: string, clientMessageId: string) {
    return this.prisma.aiMessage.findFirst({
      where: {
        sessionId,
        role: 'user',
        OR: [
          { clientMessageId },
          {
            metadata: {
              path: ['clientMessageId'],
              equals: clientMessageId,
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findAssistantByClientMessageId(sessionId: string, clientMessageId: string) {
    return this.prisma.aiMessage.findFirst({
      where: {
        sessionId,
        role: 'assistant',
        OR: [
          { clientMessageId },
          {
            metadata: {
              path: ['clientMessageId'],
              equals: clientMessageId,
            },
          },
        ],
        NOT: {
          metadata: {
            path: ['phase'],
            equals: 'tool_request',
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAssistantAfterUserMessage(
    sessionId: string,
    userMessageId: string,
  ) {
    const userMsg = await this.prisma.aiMessage.findUnique({
      where: { id: userMessageId },
    });
    if (!userMsg) {
      return null;
    }
    return this.prisma.aiMessage.findFirst({
      where: {
        sessionId,
        role: 'assistant',
        createdAt: { gt: userMsg.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  updateSession(
    sessionId: string,
    data: {
      memorySnapshot?: Prisma.InputJsonValue;
      contextType?: string;
      moduleId?: string | null;
    },
  ) {
    return this.prisma.aiAgentSession.update({
      where: { id: sessionId },
      data,
    });
  }

  createSessionWithModule(
    userId: string,
    contextType = 'general',
    moduleId?: string | null,
  ) {
    return this.prisma.aiAgentSession.create({
      data: {
        userId,
        contextType,
        moduleId: moduleId ?? null,
      },
    });
  }

  findLatestInsightSession(userId: string) {
    return this.prisma.aiAgentSession.findFirst({
      where: { userId, contextType: 'insight' },
      orderBy: { lastActiveAt: 'desc' },
    });
  }

  countInsightMessagesSince(userId: string, since: Date) {
    return this.prisma.aiMessage.count({
      where: {
        role: 'assistant',
        createdAt: { gte: since },
        session: { userId, contextType: 'insight' },
        metadata: {
          path: ['source'],
          equals: 'insight',
        },
      },
    });
  }

  findModuleBySlug(slug: string) {
    return this.prisma.module.findFirst({ where: { slug } });
  }
}
