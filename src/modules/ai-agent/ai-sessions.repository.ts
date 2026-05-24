import { Injectable } from '@nestjs/common';
import type { AiRole, Prisma } from '../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs } from '../../core/pagination/pagination.dto';
import type { PaginationQueryDto } from '../../core/pagination/pagination.dto';

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
            orderBy: { createdAt: 'desc' },
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

  createMessage(data: {
    sessionId: string;
    role: AiRole;
    content: string;
    metadata?: Record<string, unknown>;
    toolCalls?: Record<string, unknown>;
  }) {
    return this.prisma.aiMessage.create({
      data: {
        sessionId: data.sessionId,
        role: data.role,
        content: data.content,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        toolCalls: data.toolCalls
          ? (data.toolCalls as Prisma.InputJsonValue)
          : undefined,
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
        metadata: {
          path: ['clientMessageId'],
          equals: clientMessageId,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAssistantAfterUserMessage(sessionId: string, userMessageId: string) {
    const userMsg = await this.prisma.aiMessage.findUnique({
      where: { id: userMessageId },
    });
    if (!userMsg) return null;
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

  findModuleBySlug(slug: string) {
    return this.prisma.module.findFirst({ where: { slug } });
  }
}
