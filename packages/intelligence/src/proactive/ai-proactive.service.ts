import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  AI_CAPABILITY_REGISTRY,
  NOTIFICATION_INTENT_SINK,
  StructuredInferenceOutputError,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
  type NotificationIntentSink,
} from '@personal-os/contracts';
import { randomUUID } from 'node:crypto';
import { AiActionsService } from '../actions/application/ai-actions.service';
import { ViewSuggestionBudgetService } from '../suggestions/application/view-suggestion-budget.service';
import {
  ProactiveSuggestionGenerator,
  type GeneratedProactiveAction,
  type ProactiveReasoningInput,
} from './proactive-suggestion.generator';
import {
  ProactiveSuggestionStore,
  type ProactiveSuggestionRow,
} from './proactive.store';
import {
  consumptionReviewReason,
  isRelevantSignal,
  proactiveWindowStart,
} from './proactive-relevance';

export type ProactiveDecisionOutcome =
  'IGNORED' | 'DUPLICATE' | 'LIMITED' | 'SUGGESTED' | 'FAILED';

export type ProactiveDecision = { outcome: ProactiveDecisionOutcome };

export type ProactiveSuggestionView = {
  id: string;
  signalId: string;
  signalType: string;
  title: string;
  body: string;
  actionId: string | null;
  createdAt: string;
};

export type ProactiveSuggestionListView = {
  suggestions: ProactiveSuggestionView[];
  limits: {
    discarded: number;
    windowStartedAt: string | null;
  };
};

type ReasoningAttempt =
  | { outcome: 'GENERATED'; suggestion: GeneratedProactiveSuccess }
  | { outcome: 'FAILED'; knownCostUsd: number | null };

type GeneratedProactiveSuccess = Awaited<
  ReturnType<ProactiveSuggestionGenerator['generate']>
>;

const NOTIFICATION_TYPE = 'AI_PROACTIVE_SUGGESTION';
const NOTIFICATION_SOURCE_DOMAIN = 'INTELLIGENCE';
const FALLBACK_REVIEW_REASON = 'REVIEW_REQUIRED';

/**
 * Decide si un evento merece atención y, solo entonces, pide una sugerencia.
 * La relevancia es determinista: un evento sin relevancia no llega al modelo,
 * no gasta presupuesto y no notifica.
 */
@Injectable()
export class AiProactiveService {
  private readonly logger = new Logger(AiProactiveService.name);

  constructor(
    private readonly signals: ProactiveSuggestionStore,
    private readonly budget: ViewSuggestionBudgetService,
    private readonly generator: ProactiveSuggestionGenerator,
    private readonly actions: AiActionsService,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
    @Optional()
    @Inject(NOTIFICATION_INTENT_SINK)
    private readonly notifications?: NotificationIntentSink,
  ) {}

  /**
   * Procesa una señal ya enrutada. Repetir la misma señal no crea una segunda
   * sugerencia, y sin ritmo, cupo o presupuesto no se razona: se cuenta el
   * evento omitido.
   */
  async consider({
    userId,
    signalId,
  }: {
    userId: string;
    signalId: string;
  }): Promise<ProactiveDecision> {
    const signal = await this.signals.findSignal({ userId, signalId });
    if (!signal || !isRelevantSignal(signal)) {
      return { outcome: 'IGNORED' };
    }
    const existing = await this.signals.findSuggestion({ userId, signalId });
    if (existing) {
      return { outcome: 'DUPLICATE' };
    }
    const costDate = await this.budget.reserve(userId);
    if (!costDate) {
      await this.signals.recordDiscard({
        userId,
        windowStartedAt: proactiveWindowStart(new Date()),
      });
      return { outcome: 'LIMITED' };
    }
    const reasoning = await this.reason({
      userId,
      signalId,
      signalType: signal.type,
      reviewReason:
        consumptionReviewReason(signal.payload) ?? FALLBACK_REVIEW_REASON,
    });
    if (reasoning.outcome === 'FAILED') {
      await this.settleFailedReservation({ userId, costDate, reasoning });
      return { outcome: 'FAILED' };
    }
    await this.budget.settle({
      costDate,
      actualCostUsd: reasoning.suggestion.costUsd,
    });
    const suggestion = await this.signals.create({
      userId,
      signalId,
      signalType: signal.type,
      title: reasoning.suggestion.title,
      body: reasoning.suggestion.body,
    });
    if (!suggestion) {
      return { outcome: 'DUPLICATE' };
    }
    const actionId = await this.proposeAction({
      userId,
      suggestionId: suggestion.id,
      action: reasoning.suggestion.action,
    });
    if (actionId) {
      await this.signals.setActionId({
        userId,
        suggestionId: suggestion.id,
        actionId,
      });
    }
    await this.notify({ userId, signalId, suggestion, actionId });
    return { outcome: 'SUGGESTED' };
  }

  async listForUser(userId: string): Promise<ProactiveSuggestionListView> {
    const [suggestions, discard] = await Promise.all([
      this.signals.listForUser(userId),
      this.signals.findDiscard(userId),
    ]);
    const currentWindow = proactiveWindowStart(new Date()).getTime();
    const inWindow =
      discard && discard.windowStartedAt.getTime() === currentWindow
        ? discard
        : null;
    return {
      suggestions: suggestions.map(toSuggestionView),
      limits: {
        discarded: inWindow?.discarded ?? 0,
        windowStartedAt: inWindow?.windowStartedAt.toISOString() ?? null,
      },
    };
  }

  private async reason(
    input: ProactiveReasoningInput,
  ): Promise<ReasoningAttempt> {
    try {
      return {
        outcome: 'GENERATED',
        suggestion: await this.generator.generate(input),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Proactive suggestion failed: ${message}`);
      return {
        outcome: 'FAILED',
        knownCostUsd:
          error instanceof StructuredInferenceOutputError
            ? error.costUsd
            : null,
      };
    }
  }

  private async settleFailedReservation({
    userId,
    costDate,
    reasoning,
  }: {
    userId: string;
    costDate: Date;
    reasoning: Extract<ReasoningAttempt, { outcome: 'FAILED' }>;
  }): Promise<void> {
    await this.budget.settle({
      costDate,
      actualCostUsd: reasoning.knownCostUsd ?? 0,
    });
    if (reasoning.knownCostUsd === null) {
      await this.budget.releaseDailyCall(userId);
    }
  }

  /**
   * La acción propuesta nace de una capacidad `WRITE` con confirmación y pasa
   * por la política AI-10: nunca se aplica sola.
   */
  private async proposeAction({
    userId,
    suggestionId,
    action,
  }: {
    userId: string;
    suggestionId: string;
    action: GeneratedProactiveAction | undefined;
  }): Promise<string | null> {
    if (!action) {
      return null;
    }
    const descriptor = this.capabilities
      .discover()
      .find(
        (capability: AiCapabilityDescriptor) =>
          capability.id === action.actionType,
      );
    if (
      !descriptor ||
      descriptor.effect !== 'WRITE' ||
      descriptor.actionPolicy !== 'CONFIRM_REQUIRED'
    ) {
      this.logger.warn(
        `Discarded proactive action ${action.actionType}: not a confirmable write capability`,
      );
      return null;
    }
    try {
      this.capabilities.validateInput(descriptor.id, action.arguments);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Discarded proactive action ${action.actionType}: ${message}`,
      );
      return null;
    }
    const proposal = await this.actions.proposeFromSuggestion({
      ctx: {
        userId,
        invocationId: randomUUID(),
        correlationId: suggestionId,
      },
      capability: descriptor,
      rawArguments: action.arguments,
      suggestionId,
    });
    return proposal.outcome === 'PENDING_CONFIRMATION'
      ? proposal.action.id
      : null;
  }

  private async notify({
    userId,
    signalId,
    suggestion,
    actionId,
  }: {
    userId: string;
    signalId: string;
    suggestion: ProactiveSuggestionRow;
    actionId: string | null;
  }): Promise<void> {
    if (!this.notifications) {
      return;
    }
    try {
      await this.notifications.submit({
        schemaVersion: 1,
        userId,
        sourceDomain: NOTIFICATION_SOURCE_DOMAIN,
        type: NOTIFICATION_TYPE,
        title: suggestion.title,
        body: suggestion.body,
        ...(actionId ? { data: { actionId } } : {}),
        requestedChannels: ['IN_APP'],
        deduplicationKey: `ai-proactive:${userId}:${signalId}`,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Proactive suggestion notice failed: ${message}`);
    }
  }
}

function toSuggestionView(
  suggestion: ProactiveSuggestionRow,
): ProactiveSuggestionView {
  return {
    id: suggestion.id,
    signalId: suggestion.signalId,
    signalType: suggestion.signalType,
    title: suggestion.title,
    body: suggestion.body,
    actionId: suggestion.actionId,
    createdAt: suggestion.createdAt.toISOString(),
  };
}
