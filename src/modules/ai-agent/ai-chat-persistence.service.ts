import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChatMessage } from './utils/ai.types';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { buildAgentPrompt } from './prompts/build-agent-prompt';
import { AiSessionsRepository } from './ai-sessions.repository';

const MAX_CONTEXT_MESSAGES = 40;

export type CachedChatResponse = {
  sessionId: string;
  provider: string;
  model: string;
  content: string;
  requiresConfirmation?: boolean;
  metadata?: Record<string, unknown>;
};

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

  async tryGetCachedResponse(
    sessionId: string,
    clientMessageId?: string,
  ): Promise<CachedChatResponse | null> {
    if (!clientMessageId) {
      return null;
    }

    const userMsg = await this.sessionsRepo.findUserMessageByClientId(
      sessionId,
      clientMessageId,
    );
    if (!userMsg) {
      return null;
    }

    const assistantMsg = await this.sessionsRepo.findAssistantAfterUserMessage(
      sessionId,
      userMsg.id,
    );
    if (!assistantMsg) {
      return null;
    }

    const meta = assistantMsg.metadata as Record<string, unknown>;

    return {
      sessionId,
      provider: (meta.provider as string) ?? 'unknown',
      model: (meta.model as string) ?? 'unknown',
      content: assistantMsg.content,
      requiresConfirmation: meta.requiresConfirmation as boolean | undefined,
      metadata: meta,
    };
  }

  async persistUserMessage(
    sessionId: string,
    content: string,
    clientMessageId?: string,
  ) {
    if (clientMessageId) {
      const existing = await this.sessionsRepo.findUserMessageByClientId(
        sessionId,
        clientMessageId,
      );
      if (existing) {
        return existing;
      }
    }

    const message = await this.sessionsRepo.createMessage({
      sessionId,
      role: 'user',
      content,
      metadata: clientMessageId ? { clientMessageId } : {},
    });
    await this.sessionsRepo.touchSession(sessionId);
    return message;
  }

  async persistAssistantMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
    toolCalls?: Record<string, unknown> | null,
  ) {
    await this.sessionsRepo.createMessage({
      sessionId,
      role: 'assistant',
      content,
      metadata,
      toolCalls: toolCalls ?? undefined,
    });
    await this.sessionsRepo.touchSession(sessionId);
  }

  async persistToolMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.sessionsRepo.createMessage({
      sessionId,
      role: 'tool',
      content,
      metadata,
    });
  }

  async buildMessagesForProvider(
    userId: string,
    sessionId: string,
    latestUserContent: string,
  ): Promise<{
    messages: ChatMessage[];
    prefs: ReturnType<typeof parseUserPreferences>;
    requiresConfirmation: boolean;
    memorySnapshot: Record<string, unknown>;
    moduleSlug: string | null;
  }> {
    const user = await this.usersRepository.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const session = await this.sessionsRepo.findSessionById(sessionId, userId);
    if (!session) {
      throw new NotFoundException('AI session not found');
    }

    const prefs = parseUserPreferences(user.preferences, user.timezone);
    const memorySnapshot =
      (session.memorySnapshot as Record<string, unknown>) ?? {};
    const moduleSlug =
      session.module && typeof session.module === 'object' && 'slug' in session.module
        ? (session.module.slug as string)
        : session.contextType !== 'general'
          ? session.contextType
          : null;

    const systemContent = buildAgentPrompt({
      tone: prefs.ai.tone,
      locale: user.locale,
      confirmBeforeActions: prefs.ai.confirmBeforeActions,
      memorySnapshot,
      moduleSlug,
    });

    const stored = await this.sessionsRepo.findRecentMessages(
      sessionId,
      MAX_CONTEXT_MESSAGES,
    );
    const chronological = [...stored].reverse();

    const history: ChatMessage[] = chronological
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
      .map((m) => ({
        role: m.role as ChatMessage['role'],
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
      memorySnapshot,
      moduleSlug,
    };
  }
}
