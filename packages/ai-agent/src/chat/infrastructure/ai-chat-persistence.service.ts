import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma as PrismaTypes } from '@personal-os/database';
import { Prisma } from '@personal-os/database';
import {
  parseUserPreferences,
  USERS_REPOSITORY,
  type UsersRepositoryPort,
} from '@personal-os/users';
import { AiSessionsRepository } from './ai-sessions.repository';
import { buildAgentPrompt } from '../../prompts/build-agent-prompt';
import type { ChatMessage, ToolCallRequest } from '../../shared/ai.types';
import { buildProviderHistoryFromStored } from '../../shared/build-provider-history';

const MAX_CONTEXT_MESSAGES = 40;

function deriveSessionTitle(content: string): string | null {
  const title = content.trim().replace(/\s+/g, ' ').slice(0, 80);
  return title.length > 0 ? title : null;
}

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
    @Inject(USERS_REPOSITORY)
    private readonly usersRepository: UsersRepositoryPort,
  ) {}

  async resolveSession(userId: string, sessionId?: string) {
    if (sessionId) {
      const existing = await this.sessionsRepo.findSessionById(
        sessionId,
        userId,
      );
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

    const assistantMsg = await this.sessionsRepo.findAssistantByClientMessageId(
      sessionId,
      clientMessageId,
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

    try {
      const message = await this.sessionsRepo.createMessage({
        sessionId,
        role: 'user',
        content,
        clientMessageId: clientMessageId ?? null,
        metadata: clientMessageId ? { clientMessageId } : {},
      });
      await this.ensureSessionTitle(sessionId, content);
      await this.sessionsRepo.touchSession(sessionId);
      return message;
    } catch (error) {
      if (
        clientMessageId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.sessionsRepo.findUserMessageByClientId(
          sessionId,
          clientMessageId,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async persistAssistantMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
    toolCalls?: ToolCallRequest[] | null,
    clientMessageId?: string,
  ) {
    const isInternalToolRequest = metadata.phase === 'tool_request';
    const turnClientMessageId = isInternalToolRequest
      ? null
      : (clientMessageId ?? null);

    if (turnClientMessageId) {
      const existing = await this.sessionsRepo.findAssistantByClientMessageId(
        sessionId,
        turnClientMessageId,
      );
      if (existing) {
        return existing;
      }
    }

    try {
      const message = await this.sessionsRepo.createMessage({
        sessionId,
        role: 'assistant',
        content,
        clientMessageId: turnClientMessageId,
        metadata: turnClientMessageId
          ? { ...metadata, clientMessageId: turnClientMessageId }
          : metadata,
        toolCalls:
          toolCalls && toolCalls.length > 0
            ? (toolCalls as unknown as PrismaTypes.InputJsonValue)
            : undefined,
      });
      await this.sessionsRepo.touchSession(sessionId);
      return message;
    } catch (error) {
      if (
        turnClientMessageId &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.sessionsRepo.findAssistantByClientMessageId(
          sessionId,
          turnClientMessageId,
        );
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async ensureSessionTitle(sessionId: string, userContent: string) {
    const title = deriveSessionTitle(userContent);
    if (!title) {
      return;
    }

    const session = await this.sessionsRepo.findSessionByIdOnly(sessionId);
    if (!session) {
      return;
    }

    const memory = (session.memorySnapshot ?? {}) as Record<string, unknown>;
    if (typeof memory.title === 'string' && memory.title.trim().length > 0) {
      return;
    }

    await this.sessionsRepo.updateSession(sessionId, {
      memorySnapshot: {
        ...memory,
        title,
      },
    });
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
    locale: string | null;
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
      session.module &&
      typeof session.module === 'object' &&
      'slug' in session.module
        ? session.module.slug
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

    const history = buildProviderHistoryFromStored(
      stored.map((message) => ({
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
        metadata: message.metadata,
      })),
    );

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
      locale: user.locale,
    };
  }
}
