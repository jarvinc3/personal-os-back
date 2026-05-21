import { BadRequestException, Body, Controller, Get, Post, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../core/decorators';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiService } from './ai.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { AiProviderInfoDto } from './dto/ai-provider-info.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@ApiTags('ai-agent')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiChatPersistence: AiChatPersistenceService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List configured AI providers' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        providers: {
          type: 'array',
          items: { $ref: '#/components/schemas/AiProviderInfoDto' },
        },
      },
    },
  })
  listProviders(): { providers: AiProviderInfoDto[] } {
    return { providers: this.aiService.getProviders() };
  }

  @Post('chat')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Chat with AI agent pool (aggregated JSON response)',
  })
  @ApiOkResponse({ type: ChatResponseDto })
  async chat(
    @Body() dto: ChatRequestDto,
    @CurrentUser('sub') userId: string,
  ): Promise<ChatResponseDto> {
    const latestUser = [...dto.messages].reverse().find((m) => m.role === 'user');
    if (!latestUser) {
      throw new BadRequestException('At least one user message is required');
    }

    const session = await this.aiChatPersistence.resolveSession(
      userId,
      dto.sessionId,
    );
    await this.aiChatPersistence.persistUserMessage(session.id, latestUser.content);

    const { messages, prefs, requiresConfirmation } =
      await this.aiChatPersistence.buildMessagesForProvider(
        userId,
        session.id,
        latestUser.content,
      );

    const { provider, model, stream } = await this.aiService.chat(
      messages,
      prefs.ai.defaultProvider,
    );

    let content = '';
    for await (const chunk of stream) {
      content += chunk;
    }

    await this.aiChatPersistence.persistAssistantMessage(session.id, content, {
      provider,
      model,
      requiresConfirmation,
    });

    const response: ChatResponseDto = {
      sessionId: session.id,
      provider,
      model,
      content,
      requiresConfirmation: requiresConfirmation || undefined,
    };

    this.notificationsGateway.emitToUser(
      userId,
      'ai.response',
      response as unknown as Record<string, unknown>,
    );

    return response;
  }

  @Post('chat/stream')
  @Throttle({ long: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Chat with AI agent pool (SSE stream)' })
  @ApiProduces('text/event-stream')
  async chatStream(
    @Body() dto: ChatRequestDto,
    @CurrentUser('sub') userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const latestUser = [...dto.messages].reverse().find((m) => m.role === 'user');
    if (!latestUser) {
      res.status(400).json({ message: 'At least one user message is required' });
      return;
    }

    const session = await this.aiChatPersistence.resolveSession(
      userId,
      dto.sessionId,
    );
    await this.aiChatPersistence.persistUserMessage(session.id, latestUser.content);

    const { messages, prefs, requiresConfirmation } =
      await this.aiChatPersistence.buildMessagesForProvider(
        userId,
        session.id,
        latestUser.content,
      );

    const { provider, model, stream } = await this.aiService.chat(
      messages,
      prefs.ai.defaultProvider,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let fullContent = '';

    try {
      writeEvent({
        type: 'start',
        sessionId: session.id,
        provider,
        model,
        requiresConfirmation,
      });

      for await (const chunk of stream) {
        if (chunk) {
          fullContent += chunk;
          writeEvent({ type: 'chunk', content: chunk });
          this.notificationsGateway.emitToUser(userId, 'ai.response', {
            sessionId: session.id,
            provider,
            model,
            content: chunk,
            stream: true,
          });
        }
      }

      await this.aiChatPersistence.persistAssistantMessage(
        session.id,
        fullContent,
        { provider, model, requiresConfirmation },
      );

      writeEvent({
        type: 'done',
        sessionId: session.id,
        provider,
        model,
        requiresConfirmation,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  }
}
