import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginationQueryDto } from '../../core/pagination/pagination.dto';
import { AiSessionsRepository } from './ai-sessions.repository';
import { CreateAiSessionDto } from './dto/create-ai-session.dto';

@Injectable()
export class AiSessionsService {
  constructor(private readonly sessionsRepo: AiSessionsRepository) { }

  private mapSession(session: {
    id: string;
    contextType: string;
    moduleId: string | null;
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
        : session.messages?.[0]?.content?.slice(0, 80) ?? null;

    return {
      id: session.id,
      contextType: session.contextType,
      moduleId: session.moduleId,
      moduleSlug: session.module?.slug ?? null,
      title,
      memorySnapshot: memory,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      preview: session.messages?.[0]?.content?.slice(0, 120) ?? null,
    };
  }

  async list(userId: string, query: PaginationQueryDto) {
    const [items, total] = await this.sessionsRepo.findSessionsByUser(userId, query);
    const mapped = items.map((session) => this.mapSession(session));
    return paginate(mapped, total, query);
  }

  async create(userId: string, dto: CreateAiSessionDto) {
    let moduleId: string | null = null;
    let contextType = dto.contextType ?? 'general';

    if (dto.moduleSlug) {
      const mod = await this.sessionsRepo.findModuleBySlug(dto.moduleSlug);
      if (!mod) {
        throw new NotFoundException(`Module "${dto.moduleSlug}" not found`);
      }
      moduleId = mod.id;
      contextType = dto.moduleSlug;
    }

    const session = await this.sessionsRepo.createSessionWithModule(
      userId,
      contextType,
      moduleId,
    );

    return {
      ...this.mapSession({ ...session, module: null, messages: [] }),
      messages: [],
    };
  }

  async getById(sessionId: string, userId: string) {
    const session = await this.sessionsRepo.findSessionById(sessionId, userId);
    if (!session) {
      throw new NotFoundException('AI session not found');
    }

    return {
      ...this.mapSession(session),
      messages: session.messages
        .filter(
          (message) =>
            message.role === 'tool' ||
            message.content.trim().length > 0,
        )
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          metadata: message.metadata,
          createdAt: message.createdAt.toISOString(),
        })),
    };
  }

  async delete(sessionId: string, userId: string) {
    const result = await this.sessionsRepo.deleteSession(sessionId, userId);
    if (result.count === 0) {
      throw new NotFoundException('AI session not found');
    }
    return { success: true };
  }
}
