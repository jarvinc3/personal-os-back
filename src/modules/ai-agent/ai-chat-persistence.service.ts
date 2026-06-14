import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../prisma/generated/client';
import { parseUserPreferences } from '../users/lib/parse-user-preferences';
import { UsersRepository } from '../users/users.repository';
import { AiSessionsRepository } from './ai-sessions.repository';
import { buildAgentPrompt } from './prompts/build-agent-prompt';
import type { ChatMessage, ToolCallRequest } from './utils/ai.types';

const MAX_CONTEXT_MESSAGES = 40;
const METRICS_MESSAGE_CONTENT = 'ai-metrics';

function deriveSessionTitle(content: string): string | null {
  const title = content.trim().replace(/\s+/g, ' ').slice(0, 80);
  return title.length > 0 ? title : null;
}

function parseStoredToolCalls(value: unknown): ToolCallRequest[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const parsed = value
    .filter(
      (item): item is ToolCallRequest =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ToolCallRequest).id === 'string' &&
        typeof (item as ToolCallRequest).name === 'string',
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      arguments:
        item.arguments && typeof item.arguments === 'object'
          ? (item.arguments as Record<string, unknown>)
          : {},
    }));

  return parsed.length > 0 ? parsed : undefined;
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
    await this.ensureSessionTitle(sessionId, content);
    await this.sessionsRepo.touchSession(sessionId);
    return message;
  }

  async persistAssistantMessage(
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
    toolCalls?: ToolCallRequest[] | null,
  ) {
    await this.sessionsRepo.createMessage({
      sessionId,
      role: 'assistant',
      content,
      metadata,
      toolCalls:
        toolCalls && toolCalls.length > 0
          ? (toolCalls as unknown as Prisma.InputJsonValue)
          : undefined,
    });
    await this.sessionsRepo.touchSession(sessionId);
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
      } as Prisma.InputJsonValue,
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

    const history: ChatMessage[] = [];
    for (const m of chronological) {
      if (m.role === 'user') {
        history.push({ role: 'user', content: m.content });
        continue;
      }

      if (m.role === 'assistant') {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: m.content,
        };
        const toolCalls = parseStoredToolCalls(m.toolCalls);
        if (toolCalls) {
          assistantMessage.toolCalls = toolCalls;
        }
        history.push(assistantMessage);
        continue;
      }

      if (m.role === 'tool') {
        if (m.content === METRICS_MESSAGE_CONTENT) {
          continue;
        }
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const toolCallId =
          typeof meta.toolCallId === 'string' ? meta.toolCallId : undefined;
        if (!toolCallId) {
          continue;
        }
        history.push({
          role: 'tool',
          content: m.content,
          toolCallId,
          name: typeof meta.tool === 'string' ? meta.tool : undefined,
        });
      }
    }

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
