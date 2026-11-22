import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  CursorQueryDto,
  decodeCursor,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  Timeout,
  toCursorPage,
} from '@personal-os/core';
import {
  AiOrchestrator,
  type AiConversationStreamEvent,
} from '../application/ai.orchestrator';
import {
  AiConversationStore,
  type ConversationCursorPoint,
  type ListedConversation,
} from '../application/ai-conversation.store';
import {
  AiConversationAnswerDto,
  AiConversationCreatedDto,
  AiConversationDetailDto,
  AiConversationPageDto,
  AiConversationSummaryDto,
  SendAiConversationMessageDto,
  CreateAiConversationDto,
  AiConversationLatestDto,
  LatestAiConversationQueryDto,
} from './dto/ai-conversation.dto';

/**
 * Un turno hace hasta cuatro rondas de herramientas, así que el límite global
 * de 5 s cortaría la respuesta con el trabajo a medias. Al agotarse el tope el
 * mensaje del usuario ya está guardado: repetir su `clientMessageId` devuelve
 * la respuesta si terminó o retoma el turno.
 */
const AGENT_TIMEOUT_MS = 30_000;

function isVisibleMessage(role: string): role is 'user' | 'assistant' {
  return role === 'user' || role === 'assistant';
}

function decodeConversationCursor(
  cursor: string | undefined,
): ConversationCursorPoint | null {
  if (!cursor) {
    return null;
  }
  const point = decodeCursor(cursor);
  return { updatedAt: new Date(point.key), id: point.id };
}

function toConversationSummary(
  conversation: ListedConversation,
): AiConversationSummaryDto {
  const { _count, ...summary } = conversation;
  return { ...summary, messageCount: _count.messages };
}

function toConversationDetail(
  conversation: Awaited<ReturnType<AiConversationStore['findOwned']>>,
): AiConversationDetailDto {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    context:
      conversation.invocationContext as AiConversationDetailDto['context'],
    messages: conversation.messages.flatMap((message) => {
      if (!isVisibleMessage(message.role) || message.content.length === 0) {
        return [];
      }
      return [
        {
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        },
      ];
    }),
  };
}

@ApiTags('intelligence-conversations')
@ApiBearerAuth('access-token')
@Controller('intelligence/conversations')
export class AiConversationController {
  constructor(
    private readonly conversations: AiConversationStore,
    private readonly orchestrator: AiOrchestrator,
  ) {}

  @Post()
  @Timeout(AGENT_TIMEOUT_MS)
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
  @ApiOperation({ summary: 'Listar las conversaciones propias por cursor' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor opaco de la página anterior',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Cantidad de conversaciones por página',
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_LIMIT,
      default: DEFAULT_PAGE_LIMIT,
    },
  })
  @ApiOkResponse({ type: AiConversationPageDto })
  @ApiBadRequestResponse({ description: 'Cursor o límite inválido' })
  async list(
    @CurrentUser('sub') userId: string,
    @Query() query: CursorQueryDto,
  ): Promise<AiConversationPageDto> {
    // `CursorQueryDto` ya valida el rango y aplica el tamaño por defecto.
    const limit = query.limit;
    const rows = await this.conversations.list({
      userId,
      limit,
      after: decodeConversationCursor(query.cursor),
    });
    const page = toCursorPage(rows, limit, (row) =>
      row.updatedAt.toISOString(),
    );
    return { ...page, items: page.items.map(toConversationSummary) };
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Recuperar la conversación propia más reciente de un contexto',
  })
  @ApiOkResponse({ type: AiConversationLatestDto })
  @ApiBadRequestResponse({
    description: 'La clave de contexto debe ser SHA-256 hexadecimal',
  })
  async latest(
    @CurrentUser('sub') userId: string,
    @Query() query: LatestAiConversationQueryDto,
  ) {
    const conversation = await this.conversations.findLatestByContext(
      userId,
      query.context.toLowerCase(),
    );
    return {
      conversation: conversation ? toConversationDetail(conversation) : null,
    };
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
    return toConversationDetail(conversation);
  }

  @Post(':conversationId/messages')
  @Timeout(AGENT_TIMEOUT_MS)
  @ApiOperation({
    summary:
      'Enviar un mensaje, ejecutar capacidades y responder JSON o text/event-stream',
  })
  @ApiCreatedResponse({ type: AiConversationAnswerDto })
  @ApiOkResponse({
    description:
      'Flujo text/event-stream con start, status, chunk, reset, done y error cuando stream=true',
  })
  @ApiBadRequestResponse({ description: 'Mensaje vacío o demasiado largo' })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  @ApiServiceUnavailableResponse({ description: 'Inferencia no disponible' })
  async sendMessage(
    @CurrentUser('sub') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendAiConversationMessageDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const input = {
      userId,
      conversationId,
      content: dto.content.trim(),
      context: dto.context,
      clientMessageId: dto.clientMessageId,
    };
    if (dto.stream === true) {
      await this.streamMessage({ input, response });
      return;
    }
    const answer = await this.orchestrator.sendMessage(input);
    response.status(HttpStatus.CREATED).json({
      data: answer,
      meta: {
        timestamp: new Date().toISOString(),
        path: request.url,
        requestId: (request as Request & { id?: string }).id,
      },
    });
  }

  private async streamMessage({
    input,
    response,
  }: {
    input: Parameters<AiOrchestrator['sendMessage']>[0];
    response: Response;
  }): Promise<void> {
    const abortController = new AbortController();
    let started = false;
    const write = (event: AiConversationStreamEvent) => {
      if (!started) {
        started = true;
        this.startEventStream(response);
      }
      if (response.writableEnded) {
        return;
      }
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };
    response.on('close', () => {
      if (!response.writableEnded) {
        abortController.abort();
      }
    });

    try {
      await this.orchestrator.sendMessage({
        ...input,
        onEvent: write,
        signal: abortController.signal,
      });
    } catch (error) {
      if (!started) {
        throw error;
      }
      if (!abortController.signal.aborted) {
        write({
          type: 'error',
          message: this.safeStreamErrorMessage(error),
        });
      }
    } finally {
      if (started && !response.writableEnded) {
        response.end();
      }
    }
  }

  private startEventStream(response: Response): void {
    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  private safeStreamErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      return error.message;
    }
    return 'No se pudo completar la respuesta';
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
