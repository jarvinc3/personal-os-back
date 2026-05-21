import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginationQueryDto } from '../../core/pagination/pagination.dto';
import { CreateAiSessionDto } from './dto/create-ai-session.dto';
import { AiSessionsRepository } from './ai-sessions.repository';

@Injectable()
export class AiSessionsService {
  constructor(private readonly sessionsRepo: AiSessionsRepository) {}

  async list(userId: string, query: PaginationQueryDto) {
    const [items, total] = await this.sessionsRepo.findSessionsByUser(userId, query);
    const mapped = items.map((session) => ({
      id: session.id,
      contextType: session.contextType,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      preview: session.messages[0]?.content?.slice(0, 120) ?? null,
    }));
    return paginate(mapped, total, query);
  }

  async create(userId: string, dto: CreateAiSessionDto) {
    const session = await this.sessionsRepo.createSession(
      userId,
      dto.contextType ?? 'general',
    );
    return {
      id: session.id,
      contextType: session.contextType,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      messages: [],
    };
  }

  async getById(sessionId: string, userId: string) {
    const session = await this.sessionsRepo.findSessionById(sessionId, userId);
    if (!session) {
      throw new NotFoundException('AI session not found');
    }

    return {
      id: session.id,
      contextType: session.contextType,
      lastActiveAt: session.lastActiveAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      messages: session.messages.map((message) => ({
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
