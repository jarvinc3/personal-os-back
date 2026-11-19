import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AI_ACTION_POLICY_VERSION,
  AI_CAPABILITY_REGISTRY,
  AiCapabilityError,
  type AiActionPolicy,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type AiExecutionContext,
  type JsonObject,
  type JsonValue,
} from '@personal-os/contracts';
import { Inject } from '@nestjs/common';
import type { AiAction as StoredAiAction } from '@personal-os/database';
import { AiActionsRepository } from '../infrastructure/ai-actions.repository';
import { aiActionArgumentDigest } from './ai-action-argument-digest';
import { AiActionPolicyService } from './ai-action-policy.service';

export type AiActionResult = {
  outcome:
    | 'PENDING_CONFIRMATION'
    | 'EXECUTED'
    | 'ALREADY_EXECUTED'
    | 'ALREADY_CLAIMED'
    | 'FORBIDDEN'
    | 'FAILED'
    | 'CANCELLED';
  action: StoredAiAction;
};

@Injectable()
export class AiActionsService {
  constructor(
    private readonly actions: AiActionsRepository,
    private readonly policy: AiActionPolicyService,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
  ) {}

  async propose(
    ctx: AiExecutionContext,
    capability: AiCapabilityDescriptor,
    rawArguments: JsonObject,
    originReference: string,
  ): Promise<AiActionResult> {
    return this.createProposal({
      ctx,
      capability,
      rawArguments,
      origin: { type: 'AGENT_CONVERSATION', reference: originReference },
    });
  }

  /**
   * Propuesta originada en una sugerencia de vista. La acción sigue la misma
   * política AI-10 y nunca se aplica sin confirmación.
   */
  async proposeFromSuggestion({
    ctx,
    capability,
    rawArguments,
    suggestionId,
  }: {
    ctx: AiExecutionContext;
    capability: AiCapabilityDescriptor;
    rawArguments: JsonObject;
    suggestionId: string;
  }): Promise<AiActionResult> {
    return this.createProposal({
      ctx,
      capability,
      rawArguments,
      origin: { type: 'AGENT_SUGGESTION', reference: suggestionId },
    });
  }

  private async createProposal({
    ctx,
    capability,
    rawArguments,
    origin,
  }: {
    ctx: AiExecutionContext;
    capability: AiCapabilityDescriptor;
    rawArguments: JsonObject;
    origin: { type: string; reference: string };
  }): Promise<AiActionResult> {
    const decision = this.policy.decide(capability);
    let payload: JsonObject;
    try {
      payload = this.capabilities.validateInput(capability.id, rawArguments);
    } catch (error) {
      const action = await this.actions.create({
        originType: origin.type,
        originReference: origin.reference,
        userId: ctx.userId,
        actionType: capability.id,
        targetModule: capability.moduleSlug,
        payload: rawArguments,
        policy: decision,
        policyVersion: AI_ACTION_POLICY_VERSION,
        argumentDigest: aiActionArgumentDigest(rawArguments),
        status: 'FAILED',
        result: { ok: false, error: this.errorCode(error) },
      });
      return { outcome: 'FAILED', action };
    }

    const argumentDigest = aiActionArgumentDigest(payload);
    if (decision === 'FORBIDDEN') {
      const action = await this.actions.create({
        originType: origin.type,
        originReference: origin.reference,
        userId: ctx.userId,
        actionType: capability.id,
        targetModule: capability.moduleSlug,
        payload,
        policy: decision,
        policyVersion: AI_ACTION_POLICY_VERSION,
        argumentDigest,
        status: 'FAILED',
        result: { ok: false, error: 'ACTION_FORBIDDEN' },
      });
      return { outcome: 'FORBIDDEN', action };
    }

    const action = await this.actions.create({
      originType: origin.type,
      originReference: origin.reference,
      userId: ctx.userId,
      actionType: capability.id,
      targetModule: capability.moduleSlug,
      payload,
      policy: decision,
      policyVersion: AI_ACTION_POLICY_VERSION,
      argumentDigest,
      status: decision === 'AUTO_ALLOWED' ? 'RUNNING' : undefined,
    });

    if (decision === 'CONFIRM_REQUIRED') {
      return { outcome: 'PENDING_CONFIRMATION', action };
    }

    return this.executeClaimed(ctx.userId, action, 'AUTO_ALLOWED');
  }

  async listForUser(userId: string) {
    return this.actions.listForUser(userId);
  }

  async confirm(userId: string, actionId: string): Promise<AiActionResult> {
    const action = await this.actions.findById(actionId, userId);
    if (!action) {
      throw new NotFoundException('Acción no encontrada');
    }
    if (action.status === 'SUCCESS') {
      return { outcome: 'ALREADY_EXECUTED', action };
    }
    if (action.status === 'RUNNING') {
      return { outcome: 'ALREADY_CLAIMED', action };
    }
    if (action.status !== 'PENDING') {
      throw new ConflictException(`La acción está ${action.status}`);
    }
    if (action.policy !== 'CONFIRM_REQUIRED') {
      throw new ConflictException('La acción no requiere confirmación');
    }
    const claimed = await this.actions.claimForExecution(actionId, userId);
    if (!claimed) {
      const latest = await this.actions.findById(actionId, userId);
      if (!latest) {
        throw new NotFoundException('Acción no encontrada');
      }
      if (latest.status === 'SUCCESS') {
        return { outcome: 'ALREADY_EXECUTED', action: latest };
      }
      if (latest.status === 'RUNNING') {
        return { outcome: 'ALREADY_CLAIMED', action: latest };
      }
      throw new ConflictException(`La acción está ${latest.status}`);
    }
    return this.executeClaimed(userId, claimed, 'CONFIRM_REQUIRED');
  }

  async cancel(userId: string, actionId: string): Promise<AiActionResult> {
    const action = await this.actions.findById(actionId, userId);
    if (!action) {
      throw new NotFoundException('Acción no encontrada');
    }
    if (action.status === 'SUCCESS') {
      return { outcome: 'ALREADY_EXECUTED', action };
    }
    if (action.status === 'RUNNING') {
      return { outcome: 'ALREADY_CLAIMED', action };
    }
    if (action.status === 'CANCELLED') {
      return { outcome: 'CANCELLED', action };
    }
    if (action.status !== 'PENDING') {
      throw new ConflictException(`La acción está ${action.status}`);
    }
    if (action.policy !== 'CONFIRM_REQUIRED') {
      throw new ConflictException('La acción no puede cancelarse');
    }
    const cancelled = await this.actions.claimForCancel(actionId, userId);
    if (cancelled) {
      return { outcome: 'CANCELLED', action: cancelled };
    }
    const latest = await this.actions.findById(actionId, userId);
    if (!latest) {
      throw new NotFoundException('Acción no encontrada');
    }
    if (latest.status === 'SUCCESS') {
      return { outcome: 'ALREADY_EXECUTED', action: latest };
    }
    if (latest.status === 'RUNNING') {
      return { outcome: 'ALREADY_CLAIMED', action: latest };
    }
    throw new ConflictException(`La acción está ${latest.status}`);
  }

  private async executeClaimed(
    userId: string,
    claimed: StoredAiAction,
    expectedPolicy: Exclude<AiActionPolicy, 'FORBIDDEN'>,
  ): Promise<AiActionResult> {
    const descriptor = this.capabilities
      .discover()
      .find((candidate) => candidate.id === claimed.actionType);
    if (
      !descriptor ||
      descriptor.effect !== 'WRITE' ||
      descriptor.moduleSlug !== claimed.targetModule ||
      descriptor.actionPolicy !== expectedPolicy ||
      claimed.policy !== expectedPolicy ||
      claimed.policyVersion !== AI_ACTION_POLICY_VERSION
    ) {
      return this.failClaimed(claimed, 'ACTION_POLICY_CHANGED');
    }

    const payload = claimed.payload as JsonObject;
    const digest = aiActionArgumentDigest(payload);
    if (!claimed.argumentDigest || claimed.argumentDigest !== digest) {
      return this.failClaimed(claimed, 'ACTION_PAYLOAD_INTEGRITY_FAILED');
    }

    const ctx: AiExecutionContext = {
      userId,
      invocationId: claimed.id,
      correlationId: claimed.originReference ?? claimed.id,
      authorization: {
        actionId: claimed.id,
        capabilityId: claimed.actionType,
        argumentDigest: digest,
        policyVersion: claimed.policyVersion,
        decision: expectedPolicy,
      },
    };
    let result: JsonValue;
    try {
      result = await this.capabilities.execute(
        ctx,
        claimed.actionType,
        payload,
      );
    } catch (error) {
      return this.failClaimed(claimed, this.errorCode(error));
    }
    await this.actions.updateStatus(claimed.id, userId, 'SUCCESS', {
      ok: true,
      data: result,
    });
    const completed = await this.actions.findById(claimed.id, userId);
    if (!completed) {
      throw new NotFoundException('Acción no encontrada');
    }
    return { outcome: 'EXECUTED', action: completed };
  }

  private async failClaimed(
    action: StoredAiAction,
    code: string,
  ): Promise<AiActionResult> {
    await this.actions.updateStatus(action.id, action.userId, 'FAILED', {
      ok: false,
      error: code,
    });
    const failed = await this.actions.findById(action.id, action.userId);
    if (!failed) {
      throw new NotFoundException('Acción no encontrada');
    }
    return { outcome: 'FAILED', action: failed };
  }

  private errorCode(error: unknown): string {
    return error instanceof AiCapabilityError
      ? error.code
      : 'CAPABILITY_EXECUTION_FAILED';
  }
}
