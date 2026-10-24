import { Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { AiSessionsRepository } from '../../chat/infrastructure/ai-sessions.repository';
import { AiService } from '../../inference/application/ai.service';

@Injectable()
export class AiMemoryService {
  constructor(
    private readonly sessionsRepo: AiSessionsRepository,
    private readonly aiService: AiService,
  ) {}

  async maybeSummarizeSession(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const session = await this.sessionsRepo.findSessionById(sessionId, userId);
    if (!session || session.messages.length < 30) {
      return;
    }

    const transcript = session.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-30)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const { content } = await this.aiService.chatComplete([
      {
        role: 'system',
        content:
          'Summarize this chat session into stable facts for long-term memory (preferences, recurring topics, module context). Return JSON: { "title": string, "summary": string, "facts": string[] }',
      },
      { role: 'user', content: transcript },
    ]);

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      await this.sessionsRepo.updateSession(sessionId, {
        memorySnapshot: parsed as Prisma.InputJsonValue,
      });
    } catch {
      await this.sessionsRepo.updateSession(sessionId, {
        memorySnapshot: { summary: content.slice(0, 2000) },
      });
    }
  }
}
