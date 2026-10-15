import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsGateway } from '@personal-os/notifications';
import { AiActionsRepository } from '../infrastructure/ai-actions.repository';
import { validateMutatingToolArgs } from '../../tools/tool-arg-schemas';
import { ToolExecutorService } from '../../tools/tool-executor.service';
import { getActionLabel, getToolDefinition } from '../../tools/tool.registry';
import type {
  AiActionSummary,
  SideEffectDescriptor,
} from '../../shared/ai.types';

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
    const existing = await this.actionsRepo.findById(actionId, userId);
    if (!existing) {
      throw new NotFoundException('Acción no encontrada');
    }
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(
        `La acción está en ${existing.status}, no PENDING`,
      );
    }

    const action = await this.actionsRepo.claimForExecution(actionId, userId);
    if (!action) {
      // Lost race to concurrent execute/cancel.
      const raced = await this.actionsRepo.findById(actionId, userId);
      if (!raced) {
        throw new NotFoundException('Acción no encontrada');
      }
      throw new ConflictException(
        `La acción está en ${raced.status}, no PENDING`,
      );
    }

    const payload = action.payload as Record<string, unknown>;
    let result: Awaited<ReturnType<ToolExecutorService['execute']>>;
    try {
      result = await this.toolExecutor.execute(
        {
          userId,
          sessionId: action.sessionId,
          moduleSlug: null,
          confirmBeforeActions: false,
        },
        action.actionType,
        payload,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.actionsRepo.updateStatus(actionId, 'FAILED', {
        message: `Unexpected execution error: ${message}`,
      });
      const failed = await this.actionsRepo.findById(actionId, userId);
      if (!failed) {
        throw new NotFoundException('Acción no encontrada');
      }
      const summary = this.toSummary(failed);
      this.emitActionUpdated(userId, summary, []);
      return { action: summary, sideEffects: [] };
    }

    const status = result.success ? 'SUCCESS' : 'FAILED';
    await this.actionsRepo.updateStatus(actionId, status, {
      message: result.message,
      data: result.data,
    });

    const updated = await this.actionsRepo.findById(actionId, userId);
    if (!updated) {
      throw new NotFoundException('Acción no encontrada');
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
    const existing = await this.actionsRepo.findById(actionId, userId);
    if (!existing) {
      throw new NotFoundException('Acción no encontrada');
    }
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(
        `La acción está en ${existing.status}, no PENDING`,
      );
    }

    const updated = await this.actionsRepo.claimForCancel(actionId, userId);
    if (!updated) {
      const raced = await this.actionsRepo.findById(actionId, userId);
      if (!raced) {
        throw new NotFoundException('Acción no encontrada');
      }
      throw new ConflictException(
        `La acción está en ${raced.status}, no PENDING`,
      );
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
    if (!tool) {
      throw new BadRequestException(
        `Tipo de acción desconocido: ${data.actionType}`,
      );
    }
    if (!tool.mutating) {
      throw new BadRequestException(
        `El tipo de acción ${data.actionType} no es una mutación confirmable`,
      );
    }

    const validation = validateMutatingToolArgs(data.actionType, data.payload);
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    return this.actionsRepo.create({
      sessionId: data.sessionId,
      messageId: data.messageId,
      actionType: data.actionType,
      targetModule: tool.targetModule,
      payload: validation.data,
      status: 'PENDING',
    });
  }
}
