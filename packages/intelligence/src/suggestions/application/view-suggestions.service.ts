import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  AI_CAPABILITY_REGISTRY,
  type AiCapabilityDescriptor,
  type AiCapabilityRegistryPort,
} from '@personal-os/contracts';
import { randomUUID } from 'node:crypto';
import { AiActionsService } from '../../actions/application/ai-actions.service';
import { ViewSuggestionBudgetService } from './view-suggestion-budget.service';
import {
  ViewSuggestionGenerator,
  type GeneratedSuggestion,
  type GeneratedSuggestionAction,
  type GeneratedSuggestions,
} from './view-suggestion.generator';
import {
  resolveViewSuggestionScope,
  viewSuggestionKey,
  type ViewSuggestionScope,
} from './view-suggestion-scope';
import {
  MAX_VIEW_SUGGESTIONS,
  MAX_TRACKED_DISMISSAL_KEYS,
} from './view-suggestion-limits';
import {
  ViewSuggestionStore,
  type StoredViewSuggestion,
  type StoredViewSuggestionAction,
} from '../infrastructure/view-suggestion.store';

export type ViewSuggestionActionView = {
  id: string;
  actionType: string;
  targetModule: string;
  policy: StoredViewSuggestionAction['policy'];
  status: StoredViewSuggestionAction['status'];
  payload: unknown;
};

export type ViewSuggestionView = {
  id: string;
  label: string;
  prompt: string;
  action: ViewSuggestionActionView | null;
};

type PendingSuggestion = GeneratedSuggestion & { suggestionKey: string };

/**
 * Lista las sugerencias activas de una vista. Si la caché venció, pide al
 * modelo; sin cupo, ritmo o presupuesto devuelve una fila vacía sin error.
 */
@Injectable()
export class ViewSuggestionsService {
  private readonly logger = new Logger(ViewSuggestionsService.name);

  constructor(
    private readonly suggestions: ViewSuggestionStore,
    private readonly budget: ViewSuggestionBudgetService,
    private readonly generator: ViewSuggestionGenerator,
    private readonly actions: AiActionsService,
    @Inject(AI_CAPABILITY_REGISTRY)
    private readonly capabilities: AiCapabilityRegistryPort,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Devuelve la caché vigente de la vista o la genera y la guarda: el GET solo
   * escribe cuando no hay sugerencias activas.
   */
  async resolveForView({
    userId,
    route,
    view,
    sheet,
  }: {
    userId: string;
    route: string;
    view?: string;
    sheet?: string;
  }): Promise<ViewSuggestionView[]> {
    const scope = resolveViewSuggestionScope({ route, view, sheet });
    const now = new Date();
    const cached = await this.suggestions.findActive({
      userId,
      ...scope,
      now,
      limit: MAX_VIEW_SUGGESTIONS,
    });
    if (cached.length) {
      return this.withActions(userId, cached);
    }

    const costDate = await this.budget.reserve(userId);
    if (!costDate) {
      return [];
    }
    const generated = await this.requestGeneration({ userId, scope });
    if (!generated) {
      // Sin consumo conocido se libera la reserva completa y el cupo diario.
      await this.budget.settle({ costDate, actualCostUsd: 0 });
      await this.budget.releaseDailyCall(userId);
      return [];
    }
    await this.budget.settle({
      costDate,
      actualCostUsd: generated.costUsd,
    });
    return this.persist({
      userId,
      scope,
      candidates: generated.suggestions,
      now,
    });
  }

  async dismiss({
    userId,
    suggestionId,
  }: {
    userId: string;
    suggestionId: string;
  }): Promise<void> {
    const suggestion = await this.suggestions.findOwned({
      userId,
      suggestionId,
    });
    if (!suggestion) {
      throw new NotFoundException('Sugerencia no encontrada');
    }
    if (suggestion.status === 'DISMISSED') {
      return;
    }
    const dismissed = await this.suggestions.dismiss({ userId, suggestionId });
    if (!dismissed) {
      throw new NotFoundException('Sugerencia no encontrada');
    }
    await this.cancelAction(userId, suggestion.actionId);
  }

  private async requestGeneration({
    userId,
    scope,
  }: {
    userId: string;
    scope: ViewSuggestionScope;
  }): Promise<GeneratedSuggestions | null> {
    try {
      return await this.generator.generate({ userId, ...scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`View suggestion generation failed: ${message}`);
      return null;
    }
  }

  private async persist({
    userId,
    scope,
    candidates,
    now,
  }: {
    userId: string;
    scope: ViewSuggestionScope;
    candidates: GeneratedSuggestion[];
    now: Date;
  }): Promise<ViewSuggestionView[]> {
    await this.expireCached({ userId, scope, now });
    const knownKeys = new Set(
      await this.suggestions.findKnownKeys({
        userId,
        ...scope,
        limit: MAX_TRACKED_DISMISSAL_KEYS,
      }),
    );
    const pending = this.selectNewSuggestions({ candidates, knownKeys });
    if (pending.length) {
      await this.storeSuggestions({
        userId,
        scope,
        pending,
        expiresAt: this.expiresAt(now),
      });
    }
    const active = await this.suggestions.findActive({
      userId,
      ...scope,
      now,
      limit: MAX_VIEW_SUGGESTIONS,
    });
    return this.withActions(userId, active);
  }

  /** Descarta las claves ya vistas y los repetidos del lote, y aplica el tope. */
  private selectNewSuggestions({
    candidates,
    knownKeys,
  }: {
    candidates: GeneratedSuggestion[];
    knownKeys: ReadonlySet<string>;
  }): PendingSuggestion[] {
    const takenKeys = new Set(knownKeys);
    const selected: PendingSuggestion[] = [];
    for (const candidate of candidates) {
      if (selected.length >= MAX_VIEW_SUGGESTIONS) {
        break;
      }
      const suggestionKey = viewSuggestionKey(candidate.label);
      if (takenKeys.has(suggestionKey)) {
        continue;
      }
      takenKeys.add(suggestionKey);
      selected.push({ ...candidate, suggestionKey });
    }
    return selected;
  }

  /** Guarda el lote y deja la acción propuesta de cada fila nueva. */
  private async storeSuggestions({
    userId,
    scope,
    pending,
    expiresAt,
  }: {
    userId: string;
    scope: ViewSuggestionScope;
    pending: PendingSuggestion[];
    expiresAt: Date;
  }): Promise<void> {
    const created = await this.suggestions.createMany({
      userId,
      ...scope,
      suggestions: pending.map(({ suggestionKey, label, prompt }) => ({
        suggestionKey,
        label,
        prompt,
      })),
      expiresAt,
    });
    const candidateByKey = new Map(
      pending.map((candidate) => [candidate.suggestionKey, candidate]),
    );
    for (const suggestion of created) {
      const candidate = candidateByKey.get(suggestion.suggestionKey);
      if (!candidate) {
        continue;
      }
      const actionId = await this.proposeAction({
        userId,
        suggestionId: suggestion.id,
        action: candidate.action,
      });
      if (actionId) {
        await this.suggestions.setActionId({
          userId,
          suggestionId: suggestion.id,
          actionId,
        });
      }
    }
  }

  private expiresAt(now: Date): Date {
    return new Date(
      now.getTime() +
        this.config.get('AI_VIEW_SUGGESTION_TTL_MINUTES', { infer: true }) *
          60_000,
    );
  }

  private async proposeAction({
    userId,
    suggestionId,
    action,
  }: {
    userId: string;
    suggestionId: string;
    action: GeneratedSuggestionAction | undefined;
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
        `Discarded suggestion action ${action.actionType}: not a confirmable write capability`,
      );
      return null;
    }
    try {
      this.capabilities.validateInput(descriptor.id, action.arguments);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Discarded suggestion action ${action.actionType}: ${message}`,
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

  private async expireCached({
    userId,
    scope,
    now,
  }: {
    userId: string;
    scope: ViewSuggestionScope;
    now: Date;
  }): Promise<void> {
    const expired = await this.suggestions.findExpiredActive({
      userId,
      ...scope,
      now,
    });
    if (!expired.length) {
      return;
    }
    for (const suggestion of expired) {
      await this.cancelAction(userId, suggestion.actionId);
    }
    await this.suggestions.deleteByIds({
      userId,
      suggestionIds: expired.map((suggestion) => suggestion.id),
    });
  }

  private async cancelAction(
    userId: string,
    actionId: string | null,
  ): Promise<void> {
    if (!actionId) {
      return;
    }
    try {
      await this.actions.cancel(userId, actionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Could not cancel suggestion action ${actionId}: ${message}`,
      );
    }
  }

  private async withActions(
    userId: string,
    suggestions: StoredViewSuggestion[],
  ): Promise<ViewSuggestionView[]> {
    const actionIds = suggestions.flatMap((suggestion) =>
      suggestion.actionId ? [suggestion.actionId] : [],
    );
    const actions = actionIds.length
      ? await this.suggestions.findActions({ userId, actionIds })
      : [];
    const actionById = new Map(actions.map((action) => [action.id, action]));
    return suggestions.map((suggestion) => {
      const action = suggestion.actionId
        ? actionById.get(suggestion.actionId)
        : undefined;
      return {
        id: suggestion.id,
        label: suggestion.label,
        prompt: suggestion.prompt,
        action: action
          ? {
              id: action.id,
              actionType: action.actionType,
              targetModule: action.targetModule,
              policy: action.policy,
              status: action.status,
              payload: action.payload,
            }
          : null,
      };
    });
  }
}
