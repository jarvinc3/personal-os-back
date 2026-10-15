import { Injectable, NotFoundException } from '@nestjs/common';
import {
  clampPageLimit,
  toCursorPage,
  type CursorQueryDto,
} from '@personal-os/core';
import type { Prisma as PrismaTypes } from '@personal-os/database';
import { AiActionsService } from '../../actions/application/ai-actions.service';
import { AiSessionsRepository } from '../infrastructure/ai-sessions.repository';
import { CreateAiSessionDto } from '../presentation/dto/create-ai-session.dto';
import {
  enrichMessageMetadata,
  isInternalToolRequestMessage,
} from '../../shared/enrich-session-messages';

@Injectable()
export class AiSessionsService {
  constructor(
    private readonly sessionsRepo: AiSessionsRepository,
    private readonly actionsService: AiActionsService,
  ) {}

  private mapSession(session: {
    id: string;
    contextType: string;
    moduleId: string | null;
    chatContext: unknown;
    memorySnapshot: unknown;
    lastActiveAt: Date;
    createdAt: Date;
    module?: { slug: string } | null;
    messages?: Array<{ content: string }>;
  }) {
    const memory = (session.memorySnapshot ?? {}) as Record<string, unknown>;
    const title =
      typeof memory.title === 'string'
        ? memory.title
        : (session.messages?.[0]?.content?.slice(0, 80) ?? null);

    return {
      id: session.id,
      contextType: session.contextType,
      moduleId: session.moduleId,
      moduleSlug: session.module?.slug ?? null,
      chatContext: session.chatContext ?? null,
      title,
      memorySnapshot: memory,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      preview: session.messages?.[0]?.content?.slice(0, 120) ?? null,
    };
  }

  async list(userId: string, query: CursorQueryDto) {
    const rows = await this.sessionsRepo.findSessionsByUser(userId, query);
    const page = toCursorPage(rows, clampPageLimit(query.limit), (row) =>
      row.lastActiveAt.toISOString(),
    );
    return {
      ...page,
      items: page.items.map((session) => this.mapSession(session)),
    };
  }

  async create(userId: string, dto: CreateAiSessionDto) {
    let moduleId: string | null = null;
    const requestedModuleSlug = dto.context?.moduleSlug ?? dto.moduleSlug;
    let contextType = dto.contextType ?? 'general';

    if (requestedModuleSlug) {
      const mod = await this.sessionsRepo.findModuleBySlug(requestedModuleSlug);
      if (!mod) {
        throw new NotFoundException(
          `Módulo "${requestedModuleSlug}" no encontrado`,
        );
      }
      moduleId = mod.id;
      contextType = requestedModuleSlug;
    }

    const session = await this.sessionsRepo.createSessionWithModule(
      userId,
      contextType,
      moduleId,
      dto.context as unknown as PrismaTypes.InputJsonValue | undefined,
    );

    return {
      ...this.mapSession({ ...session, module: null, messages: [] }),
      messages: [],
    };
  }

  async getById(sessionId: string, userId: string) {
    const session = await this.sessionsRepo.findSessionById(sessionId, userId);
    if (!session) {
      throw new NotFoundException('Sesión de IA no encontrada');
    }

    const liveActions = await this.actionsService.listBySession(
      sessionId,
      userId,
    );
    const actionsById = new Map(
      liveActions.map((action) => [action.id, action]),
    );

    return {
      ...this.mapSession(session),
      messages: session.messages
        .filter((message) => !isInternalToolRequestMessage(message))
        .filter(
          (message) =>
            message.role === 'tool' || message.content.trim().length > 0,
        )
        .map((message) => {
          const metadata = (message.metadata ?? {}) as Record<string, unknown>;
          return {
            id: message.id,
            role: message.role,
            content: message.content,
            clientMessageId:
              message.clientMessageId ??
              (typeof metadata.clientMessageId === 'string'
                ? metadata.clientMessageId
                : null),
            metadata: enrichMessageMetadata(metadata, actionsById),
            createdAt: message.createdAt.toISOString(),
          };
        }),
    };
  }

  async delete(sessionId: string, userId: string) {
    const deleted = await this.sessionsRepo.deleteSession(sessionId, userId);
    if (deleted.count === 0) {
      throw new NotFoundException('Sesión de IA no encontrada');
    }
    return { success: true };
  }

  async wipeAllForUser(userId: string) {
    const deletedSessions = await this.sessionsRepo.deleteAllForUser(userId);
    return { sessions: deletedSessions.count };
  }
}
