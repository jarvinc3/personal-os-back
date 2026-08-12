import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Timeout } from '../../../../core/decorators';
import { AiActionsService } from '../application/ai-actions.service';

@ApiTags('ai-agent')
@Controller('ai')
@Timeout(30_000)
export class AiActionsController {
  constructor(private readonly aiActionsService: AiActionsService) {}

  @Get('sessions/:id/actions')
  @ApiOperation({ summary: 'List actions for an AI session' })
  listSessionActions(
    @Param('id') sessionId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.aiActionsService.listBySession(sessionId, userId);
  }

  @Post('actions/:id/execute')
  @ApiOperation({ summary: 'Execute a pending AI action' })
  execute(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiActionsService.execute(id, userId);
  }

  @Post('actions/:id/cancel')
  @ApiOperation({ summary: 'Cancel a pending AI action' })
  cancel(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.aiActionsService.cancel(id, userId);
  }
}
