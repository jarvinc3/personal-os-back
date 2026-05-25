import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import type { AiActionSummary, SideEffectDescriptor } from './utils/ai.types';
import { getActionLabel, getToolDefinition } from './tools/tool.registry';
import { ToolExecutorService } from './tools/tool-executor.service';
import { AiActionsRepository } from './ai-actions.repository';

@Injectable()
export class AiActionsService {
  constructor(
    private readonly actionsRepo: AiActionsRepository,
    private readonly toolExecutor: ToolExecutorService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  toSummary(action: {
    id: string;
    actionType: string;
    targetModule: string;
    payload: unknown;
    status: string;
  }): AiActionSummary {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    return {
      id: action.id,
      actionType: action.actionType,
      targetModule: action.targetModule,
      payload,
      status: action.status,
      label: getActionLabel(action.actionType, payload),
    };
  }

  async listBySession(sessionId: string, userId: string) {
    const actions = await this.actionsRepo.findBySession(sessionId, userId);
    return actions.map((a) => this.toSummary(a));
  }

  async execute(
    actionId: string,
    userId: string,
  ): Promise<{ action: AiActionSummary; sideEffects: SideEffectDescriptor[] }> {
    const action = await this.actionsRepo.findById(actionId, userId);
    if (!action) {
      throw new NotFoundException('Action not found');
    }
    if (action.status !== 'PENDING') {
      throw new BadRequestException(`Action is ${action.status}, not PENDING`);
    }

    await this.actionsRepo.updateStatus(actionId, 'RUNNING');

    const payload = action.payload as Record<string, unknown>;
    const result = await this.toolExecutor.execute(
      {
        userId,
        sessionId: action.sessionId,
        moduleSlug: null,
        confirmBeforeActions: false,
      },
      action.actionType,
      payload,
    );

    const status = result.success ? 'SUCCESS' : 'FAILED';
    await this.actionsRepo.updateStatus(actionId, status, {
      message: result.message,
      data: result.data,
    });

    const updated = await this.actionsRepo.findById(actionId, userId);
    if (!updated) {
      throw new NotFoundException('Action not found');
    }

    const summary = this.toSummary(updated);
    const sideEffects = result.sideEffects ?? [];
    this.emitActionUpdated(userId, summary, sideEffects);

    return {
      action: summary,
      sideEffects,
    };
  }

  private emitActionUpdated(
    userId: string,
    action: AiActionSummary,
    sideEffects: SideEffectDescriptor[],
  ) {
    this.notificationsGateway.emitToUser(userId, 'ai.response', {
      type: 'action.updated',
      actions: [action],
      sideEffects,
    });
  }

  async cancel(actionId: string, userId: string): Promise<AiActionSummary> {
    const action = await this.actionsRepo.findById(actionId, userId);
    if (!action) {
      throw new NotFoundException('Action not found');
    }
    if (action.status !== 'PENDING') {
      throw new BadRequestException(`Action is ${action.status}, not PENDING`);
    }

    await this.actionsRepo.updateStatus(actionId, 'CANCELLED');
    const updated = await this.actionsRepo.findById(actionId, userId);
    if (!updated) {
      throw new NotFoundException('Action not found');
    }
    return this.toSummary(updated);
  }

  async createPendingAction(data: {
    sessionId: string;
    messageId?: string;
    actionType: string;
    payload: Record<string, unknown>;
  }) {
    const tool = getToolDefinition(data.actionType);
    return this.actionsRepo.create({
      sessionId: data.sessionId,
      messageId: data.messageId,
      actionType: data.actionType,
      targetModule: tool?.targetModule ?? 'core',
      payload: data.payload,
      status: 'PENDING',
    });
  }
}
