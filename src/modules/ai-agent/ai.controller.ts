import { BadRequestException, Body, Controller, Get, Post, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../core/decorators';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AiAgentRunner } from './ai-agent.runner';
import { AiChatPersistenceService } from './ai-chat-persistence.service';
import { AiService } from './ai.service';
import { AiProviderInfoDto } from './dto/ai-provider-info.dto';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import type { AiResponseWsPayload } from './utils/ai.types';

@ApiTags('ai-agent')
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiChatPersistence: AiChatPersistenceService,
    private readonly agentRunner: AiAgentRunner,
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

    const result = await this.agentRunner.run({
      userId,
      sessionId: session.id,
      userContent: latestUser.content,
      clientMessageId: dto.clientMessageId,
    });

    const response: ChatResponseDto = {
      sessionId: result.sessionId,
      provider: result.provider,
      model: result.model,
      moduleSlug: result.moduleSlug,
      moduleLabel: result.moduleLabel,
      content: result.content,
      requiresConfirmation: result.requiresConfirmation || undefined,
      actions: result.actions,
      sideEffects: result.sideEffects,
      blocks: result.blocks,
    };

    this.emitAiResponse(userId, {
      type: 'chat.complete',
      sessionId: result.sessionId,
      provider: result.provider,
      model: result.model,
      content: result.content,
      requiresConfirmation: result.requiresConfirmation,
      actions: result.actions,
      sideEffects: result.sideEffects,
    });

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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const cached = await this.aiChatPersistence.tryGetCachedResponse(
        session.id,
        dto.clientMessageId,
      );

      if (cached) {
        const cachedMeta = cached.metadata ?? {};
        const cachedModuleSlug =
          typeof cachedMeta.moduleSlug === 'string' ? cachedMeta.moduleSlug : 'general';
        const cachedModuleLabel =
          typeof cachedMeta.moduleLabel === 'string'
            ? cachedMeta.moduleLabel
            : 'General';
        writeEvent({
          type: 'start',
          sessionId: cached.sessionId,
          provider: cached.provider,
          model: cached.model,
          moduleSlug: cachedModuleSlug,
          moduleLabel: cachedModuleLabel,
          requiresConfirmation: cached.requiresConfirmation,
        });
        for (let i = 0; i < cached.content.length; i += 24) {
          writeEvent({
            type: 'chunk',
            content: cached.content.slice(i, i + 24),
          });
        }
        writeEvent({
          type: 'done',
          sessionId: cached.sessionId,
          provider: cached.provider,
          model: cached.model,
          moduleSlug: cachedModuleSlug,
          moduleLabel: cachedModuleLabel,
          requiresConfirmation: cached.requiresConfirmation,
        });
        res.end();
        return;
      }

      let streamProvider = '…';
      let streamModel = '…';

      const result = await this.agentRunner.run(
        {
          userId,
          sessionId: session.id,
          userContent: latestUser.content,
          clientMessageId: dto.clientMessageId,
        },
        (event) => {
          if (event.type === 'start') {
            streamProvider = event.provider;
            streamModel = event.model;
            writeEvent({
              type: 'start',
              sessionId: event.sessionId,
              provider: event.provider,
              model: event.model,
            });
          }
          if (event.type === 'chunk') {
            writeEvent({ type: 'chunk', content: event.content });
            this.emitAiResponse(userId, {
              type: 'chat.chunk',
              sessionId: session.id,
              provider: streamProvider,
              model: streamModel,
              content: event.content,
              stream: true,
            });
          }
          if (event.type === 'reset') {
            writeEvent({ type: 'reset' });
          }
          if (event.type === 'status') {
            writeEvent({ type: 'status', message: event.message });
          }
        },
      );

      writeEvent({
        type: 'done',
        sessionId: result.sessionId,
        provider: result.provider,
        model: result.model,
        moduleSlug: result.moduleSlug,
        moduleLabel: result.moduleLabel,
        requiresConfirmation: result.requiresConfirmation,
        actions: result.actions,
        sideEffects: result.sideEffects,
        blocks: result.blocks,
      });

      this.emitAiResponse(userId, {
        type: 'chat.complete',
        sessionId: result.sessionId,
        provider: result.provider,
        model: result.model,
        content: result.content,
        requiresConfirmation: result.requiresConfirmation,
        actions: result.actions,
        sideEffects: result.sideEffects,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  }

  private emitAiResponse(userId: string, payload: AiResponseWsPayload) {
    this.notificationsGateway.emitToUser(
      userId,
      'ai.response',
      payload,
    );
  }
}
