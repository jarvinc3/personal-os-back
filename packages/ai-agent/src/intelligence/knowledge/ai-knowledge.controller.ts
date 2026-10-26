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
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '@personal-os/core';
import { Roles } from '../roles/ai-role.decorator';
import { AiDataDeletionService } from './ai-data-deletion.service';
import { AiKnowledgeService } from './ai-knowledge.service';

class ConfirmAiDataDeletionDto {
  @IsBoolean()
  confirmed!: boolean;
}

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
  @ApiOkResponse({
    description: '{ personal: AiKnowledge[], global: AiKnowledge[] }',
  })
  list(@CurrentUser() user: { sub: string }) {
    return this.knowledge.listForUser(user.sub);
  }

  @Get('admin/queue')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Cola administrativa de conocimiento GLOBAL' })
  @ApiOkResponse({ description: 'AiKnowledge[] de alcance GLOBAL' })
  adminQueue() {
    return this.knowledge.adminQueue();
  }

  @Post('admin/rebuild')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Reconstruir la proyección desde un corte REPEATABLE READ',
  })
  @ApiCreatedResponse({
    description:
      '{ runId, observationSequence, verificationSequence, consentRevision, items }',
  })
  rebuild(@CurrentUser() user: { sub: string }) {
    return this.knowledge.rebuild(user.sub);
  }

  @Post('admin/:knowledgeId/revert')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Revertir una promoción GLOBAL con evidencia ADMIN',
  })
  @ApiCreatedResponse({ description: 'AiKnowledge GLOBAL con state BLOCKED' })
  revert(
    @CurrentUser() user: { sub: string },
    @Param('knowledgeId') knowledgeId: string,
  ) {
    return this.knowledge.revert(user.sub, knowledgeId);
  }

  @Get('me/export')
  @ApiOperation({ summary: 'Exportar los datos AI y correo propios en JSON' })
  @ApiOkResponse({
    description:
      '{ exportedAt, connection, messages, datasetItems, runs, observations, verifications, knowledge, consent, settings, inferences }',
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
  @ApiOkResponse({
    description:
      '{ deleted, deletedMessages, detachedVerifications, detachedObservations }',
  })
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
