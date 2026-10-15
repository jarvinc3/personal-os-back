import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Timeout } from '@personal-os/core';
import { CursorQueryDto } from '@personal-os/core';
import { CreateAiSessionDto } from './dto/create-ai-session.dto';
import { AiActionsService } from '../../actions/application/ai-actions.service';
import { AiSessionsService } from '../application/ai-sessions.service';

@ApiTags('ai-agent')
@ApiBearerAuth('access-token')
@Controller('ai/sessions')
@Timeout(30_000)
export class AiSessionsController {
  constructor(
    private readonly aiSessionsService: AiSessionsService,
    private readonly aiActionsService: AiActionsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista las sesiones de chat de IA del usuario' })
  list(@CurrentUser('sub') userId: string, @Query() query: CursorQueryDto) {
    return this.aiSessionsService.list(userId, query);
  }

  @Get(':id/actions')
  @ApiOperation({ summary: 'Lista las acciones de una sesión de IA' })
  listActions(
    @Param('id') sessionId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.aiActionsService.listBySession(sessionId, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Crea una sesión de chat de IA' })
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateAiSessionDto) {
    return this.aiSessionsService.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtiene una sesión de IA con sus mensajes' })
  getById(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiSessionsService.getById(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Borra una sesión de IA' })
  delete(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiSessionsService.delete(id, userId);
  }
}
