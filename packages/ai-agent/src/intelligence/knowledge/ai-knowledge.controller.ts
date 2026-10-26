import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
import { CurrentUser } from '@personal-os/core';
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

@ApiTags('intelligence-knowledge')
@ApiBearerAuth('access-token')
@Controller('intelligence/knowledge')
export class AiKnowledgeController {
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
  export(@CurrentUser() user: { sub: string }) {
    return this.deletion.exportForUser(user.sub);
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
