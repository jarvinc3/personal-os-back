import { Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@personal-os/core';
import { AiActionsService } from '../application/ai-actions.service';
import { AiActionDto, AiActionResultDto } from './ai-actions.dto';

@ApiTags('ai-agent')
@ApiBearerAuth('access-token')
@Controller('ai/actions')
export class AiActionsController {
  constructor(private readonly actions: AiActionsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar acciones propias del agente' })
  @ApiOkResponse({ type: [AiActionDto] })
  async list(@CurrentUser('sub') userId: string) {
    return (await this.actions.listForUser(userId)).map((action) =>
      this.toDto(action),
    );
  }

  @Post(':actionId/confirm')
  @ApiOperation({ summary: 'Confirmar una acción pendiente del agente' })
  @ApiOkResponse({ type: AiActionResultDto })
  async confirm(
    @CurrentUser('sub') userId: string,
    @Param('actionId') actionId: string,
  ) {
    const result = await this.actions.confirm(userId, actionId);
    return { outcome: result.outcome, action: this.toDto(result.action) };
  }

  @Post(':actionId/cancel')
  @ApiOperation({ summary: 'Cancelar una acción pendiente del agente' })
  @ApiOkResponse({ type: AiActionResultDto })
  async cancel(
    @CurrentUser('sub') userId: string,
    @Param('actionId') actionId: string,
  ) {
    const result = await this.actions.cancel(userId, actionId);
    return { outcome: result.outcome, action: this.toDto(result.action) };
  }

  private toDto(action: {
    id: string;
    actionType: string;
    targetModule: string;
    policy: AiActionDto['policy'];
    status: string;
    payload: unknown;
    result: unknown;
    createdAt: Date;
    executedAt: Date | null;
  }): AiActionDto {
    return {
      id: action.id,
      actionType: action.actionType,
      targetModule: action.targetModule,
      policy: action.policy,
      status: action.status,
      payload: action.payload as Record<string, unknown>,
      result: action.result as Record<string, unknown> | null,
      createdAt: action.createdAt,
      executedAt: action.executedAt,
    };
  }
}
