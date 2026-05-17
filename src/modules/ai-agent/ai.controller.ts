import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AiService } from './ai.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { AiProviderInfoDto } from './dto/ai-provider-info.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@ApiTags('ai-agent')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

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
  @ApiOperation({
    summary: 'Chat with AI agent pool (aggregated JSON response)',
  })
  @ApiOkResponse({ type: ChatResponseDto })
  async chat(@Body() dto: ChatRequestDto): Promise<ChatResponseDto> {
    const { provider, model, stream } = await this.aiService.chat(dto.messages);

    let content = '';
    for await (const chunk of stream) {
      content += chunk;
    }

    return { provider, model, content };
  }

  @Post('chat/stream')
  @ApiOperation({ summary: 'Chat with AI agent pool (SSE stream)' })
  @ApiProduces('text/event-stream')
  async chatStream(
    @Body() dto: ChatRequestDto,
    @Res() res: Response,
  ): Promise<void> {
    const { provider, model, stream } = await this.aiService.chat(dto.messages);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeEvent = (payload: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      writeEvent({ type: 'start', provider, model });

      for await (const chunk of stream) {
        if (chunk) {
          writeEvent({ type: 'chunk', content: chunk });
        }
      }

      writeEvent({ type: 'done', provider, model });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      writeEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  }
}
