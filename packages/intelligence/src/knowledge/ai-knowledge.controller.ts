import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, Timeout } from '@personal-os/core';
import type { Request, Response } from 'express';
import { Roles } from '../roles/ai-role.decorator';
import { AiDataDeletionService } from './ai-data-deletion.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import {
  ConfirmAiDataDeletionDto,
  KnowledgeDeletionDto,
  KnowledgeExplorerDto,
  KnowledgeItemDto,
  KnowledgeRebuildDto,
} from './dto/knowledge.dto';

const EXPORT_TIMEOUT_MS = 120_000;

@ApiTags('intelligence-knowledge')
@ApiBearerAuth('access-token')
@Controller('intelligence/knowledge')
export class AiKnowledgeController {
  private readonly logger = new Logger(AiKnowledgeController.name);

  constructor(
    private readonly knowledge: AiKnowledgeService,
    private readonly deletion: AiDataDeletionService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Explorar conocimiento USER propio y GLOBAL estable',
  })
  @ApiOkResponse({ type: KnowledgeExplorerDto })
  list(@CurrentUser() user: { sub: string }) {
    return this.knowledge.listForUser(user.sub);
  }

  @Get('admin/queue')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cola administrativa de conocimiento GLOBAL' })
  @ApiOkResponse({ type: [KnowledgeItemDto] })
  adminQueue() {
    return this.knowledge.adminQueue();
  }

  @Post('admin/rebuild')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Reconstruir la proyección desde un corte REPEATABLE READ',
  })
  @ApiCreatedResponse({ type: KnowledgeRebuildDto })
  rebuild(@CurrentUser() user: { sub: string }) {
    return this.knowledge.rebuild(user.sub);
  }

  @Post('admin/:knowledgeId/promote')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Promover manualmente conocimiento GLOBAL en revisión',
  })
  @ApiCreatedResponse({ type: KnowledgeItemDto })
  @ApiNotFoundResponse({ description: 'Conocimiento GLOBAL no encontrado' })
  promote(
    @CurrentUser() user: { sub: string },
    @Param('knowledgeId') knowledgeId: string,
  ) {
    return this.knowledge.promote(user.sub, knowledgeId);
  }

  @Post('admin/:knowledgeId/revert')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Revertir una promoción GLOBAL con evidencia ADMIN',
  })
  @ApiCreatedResponse({ type: KnowledgeItemDto })
  @ApiNotFoundResponse({ description: 'Conocimiento GLOBAL no encontrado' })
  revert(
    @CurrentUser() user: { sub: string },
    @Param('knowledgeId') knowledgeId: string,
  ) {
    return this.knowledge.revert(user.sub, knowledgeId);
  }

  @Get('me/export')
  @Timeout(EXPORT_TIMEOUT_MS)
  @ApiOperation({ summary: 'Exportar los datos AI y correo propios en JSON' })
  @ApiOkResponse({
    description: 'Exportación JSON de los datos AI y correo propios.',
    schema: {
      type: 'object',
      properties: {
        exportedAt: { type: 'string', format: 'date-time' },
        connection: { type: 'object', nullable: true },
        messages: { type: 'array', items: { type: 'object' } },
        datasetItems: { type: 'array', items: { type: 'object' } },
        runs: { type: 'array', items: { type: 'object' } },
        observations: { type: 'array', items: { type: 'object' } },
        verifications: { type: 'array', items: { type: 'object' } },
        knowledge: { type: 'array', items: { type: 'object' } },
        consent: { type: 'array', items: { type: 'object' } },
        settings: { type: 'object', nullable: true },
        inferences: { type: 'array', items: { type: 'object' } },
      },
    },
  })
  async export(
    @CurrentUser() user: { sub: string },
    @Req() request: Request & { id?: string },
    @Res() response: Response,
  ): Promise<void> {
    const write = async (chunk: string): Promise<void> => {
      if (response.writableEnded || response.destroyed) {
        return;
      }
      if (!response.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          response.once('drain', resolve);
          response.once('error', reject);
        });
      }
    };

    try {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      await write('{"data":');
      await this.deletion.streamExportForUser(user.sub, write);
      await write(
        `,"meta":${JSON.stringify({
          timestamp: new Date().toISOString(),
          path: request.url,
          requestId: request.id,
        })}}`,
      );
      response.end();
    } catch (error) {
      if (!response.headersSent) {
        throw error;
      }
      this.logger.error(
        `AI data export failed after headers: ${error instanceof Error ? error.message : String(error)}`,
      );
      response.destroy(error instanceof Error ? error : undefined);
    }
  }

  @Delete('me')
  @ApiBody({ type: ConfirmAiDataDeletionDto })
  @ApiOperation({
    summary:
      'Borrar inmediatamente los datos AI propios y dejar lápidas estructurales elegibles',
  })
  @ApiOkResponse({ type: KnowledgeDeletionDto })
  @ApiBadRequestResponse({ description: 'Falta confirmed: true' })
  remove(
    @CurrentUser() user: { sub: string },
    @Body() dto: ConfirmAiDataDeletionDto,
  ) {
    if (dto.confirmed !== true) {
      throw new BadRequestException('Confirma el borrado de datos AI');
    }
    return this.deletion.deleteMyData(user.sub);
  }
}
