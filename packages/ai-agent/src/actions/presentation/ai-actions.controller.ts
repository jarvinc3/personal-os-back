import { Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Timeout } from '@personal-os/core';
import { AiActionsService } from '../application/ai-actions.service';

@ApiTags('ai-agent')
@Controller('ai/actions')
@Timeout(30_000)
export class AiActionsController {
  constructor(private readonly aiActionsService: AiActionsService) {}

  @Post(':id/execute')
  @ApiOperation({ summary: 'Ejecuta una acción pendiente de la IA' })
  execute(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiActionsService.execute(id, userId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancela una acción pendiente de la IA' })
  cancel(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiActionsService.cancel(id, userId);
  }
}
