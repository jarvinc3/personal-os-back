import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiOrchestrator } from '../application/ai.orchestrator';
import { AiConversationStore } from '../application/ai-conversation.store';
import {
  AiConversationAnswerDto,
  AiConversationCreatedDto,
  AiConversationDetailDto,
  AiConversationSummaryDto,
  SendAiConversationMessageDto,
  CreateAiConversationDto,
} from './dto/ai-conversation.dto';

@ApiTags('intelligence-conversations')
@ApiBearerAuth('access-token')
@Controller('intelligence/conversations')
export class AiConversationController {
  constructor(
    private readonly conversations: AiConversationStore,
    private readonly orchestrator: AiOrchestrator,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Crear una conversación privada del agente' })
  @ApiCreatedResponse({ type: AiConversationCreatedDto })
  @ApiBadRequestResponse({
    description: 'Contexto inválido o entidad no accesible',
  })
  create(
    @CurrentUser('sub') userId: string,
    @Body() body?: CreateAiConversationDto,
  ) {
    return this.orchestrator.createConversation(userId, body?.context);
  }

  @Get()
  @ApiOperation({ summary: 'Listar las conversaciones propias' })
  @ApiOkResponse({ type: [AiConversationSummaryDto] })
  async list(@CurrentUser('sub') userId: string) {
    const rows = await this.conversations.list(userId);
    return rows.map(({ _count, ...conversation }) => ({
      ...conversation,
      messageCount: _count.messages,
    }));
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Recuperar una conversación propia' })
  @ApiOkResponse({ type: AiConversationDetailDto })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  async get(
    @CurrentUser('sub') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.conversations.findOwned(
      userId,
      conversationId,
    );
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      context: conversation.invocationContext,
      messages: conversation.messages
        .filter(
          (message) =>
            (message.role === 'user' || message.role === 'assistant') &&
            message.content.length > 0,
        )
        .map((message) => ({
          role: message.role as 'user' | 'assistant',
          content: message.content,
          createdAt: message.createdAt,
        })),
    };
  }

  @Post(':conversationId/messages')
  @ApiOperation({
    summary: 'Enviar un mensaje y ejecutar capacidades de lectura disponibles',
  })
  @ApiCreatedResponse({ type: AiConversationAnswerDto })
  @ApiBadRequestResponse({ description: 'Mensaje vacío o demasiado largo' })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  @ApiServiceUnavailableResponse({ description: 'Inferencia no disponible' })
  sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendAiConversationMessageDto,
  ) {
    return this.orchestrator.sendMessage(
      userId,
      conversationId,
      dto.content.trim(),
      dto.context,
    );
  }

  @Delete(':conversationId')
  @ApiOperation({ summary: 'Borrar una conversación propia y sus mensajes' })
  @ApiOkResponse({
    schema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
  })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  async remove(
    @CurrentUser('sub') userId: string,
    @Param('conversationId') conversationId: string,
  ) {
    await this.conversations.deleteOwned(userId, conversationId);
    return { deleted: true };
  }
}
