import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChatMessage } from './utils/ai.types';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { buildSystemPrompt } from './lib/build-system-prompt';
import { AiSessionsRepository } from './ai-sessions.repository';

const MAX_CONTEXT_MESSAGES = 40;

@Injectable()
export class AiChatPersistenceService {
  constructor(
    private readonly sessionsRepo: AiSessionsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async resolveSession(userId: string, sessionId?: string) {
    if (sessionId) {
      const existing = await this.sessionsRepo.findSessionById(sessionId, userId);
      if (!existing) {
        throw new NotFoundException('AI session not found');
      }
      return existing;
    }

    return this.sessionsRepo.createSession(userId);
  }

  async persistUserMessage(sessionId: string, content: string) {
    await this.sessionsRepo.createMessage({
      sessionId,
      role: 'user',
      content,
    });
    await this.sessionsRepo.touchSession(sessionId);
  }

  async persistAssistantMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
  ) {
    await this.sessionsRepo.createMessage({
      sessionId,
      role: 'assistant',
      content,
      metadata,
    });
    await this.sessionsRepo.touchSession(sessionId);
  }

  async buildMessagesForProvider(
    userId: string,
    sessionId: string,
    latestUserContent: string,
  ): Promise<{
    messages: ChatMessage[];
    prefs: ReturnType<typeof parseUserPreferences>;
    requiresConfirmation: boolean;
  }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const prefs = parseUserPreferences(user.preferences, user.timezone);
    const systemContent = buildSystemPrompt({
      tone: prefs.ai.tone,
      locale: user.locale,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
    });

    const stored = await this.sessionsRepo.findRecentMessages(
      sessionId,
      MAX_CONTEXT_MESSAGES,
    );
    const chronological = [...stored].reverse();

    const history: ChatMessage[] = chronological
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const withoutDuplicateLatest =
      history.length > 0 &&
      history[history.length - 1]?.role === 'user' &&
      history[history.length - 1]?.content === latestUserContent
        ? history.slice(0, -1)
        : history;

    return {
      messages: [
        { role: 'system', content: systemContent },
        ...withoutDuplicateLatest,
        { role: 'user', content: latestUserContent },
      ],
      prefs,
      requiresConfirmation: prefs.ai.confirmBeforeActions,
    };
  }
}
