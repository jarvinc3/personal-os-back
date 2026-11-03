import type {
  AiCapabilityProvider,
  AiExecutionContext,
  JsonObject,
} from '@personal-os/contracts';
import type {
  FinanceEntityRef,
  FinanceEntityType,
} from '../entities/domain/entity-reference';

/** Finance's AI adapter contract, implemented and owned by the Finance module. */
export interface FinanceAiCapabilitiesPort extends AiCapabilityProvider {
  readonly moduleSlug: 'finance';
}

export interface FinanceEntityContext extends JsonObject {
  type: FinanceEntityType;
  id: string;
  name: string;
  summary: string;
}

export type FinanceAiContext = JsonObject;

/** Entity resolution stays in Finance and exposes no chat-specific types. */
export interface FinanceAiContextProvider {
  readonly moduleSlug: 'finance';
  resolveEntity(
    ctx: AiExecutionContext,
    ref: FinanceEntityRef,
  ): Promise<FinanceEntityContext | null>;
  readContext(ctx: AiExecutionContext): Promise<FinanceAiContext>;
}
