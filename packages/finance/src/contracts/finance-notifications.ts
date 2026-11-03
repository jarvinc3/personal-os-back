import type { IntentProducer } from '@personal-os/contracts';
import type { FinanceDomainEvent } from './finance-events';

/** Adapts Finance facts to generic intents; delivery policy belongs to Notifications. */
export type FinanceNotificationAdapter = IntentProducer<FinanceDomainEvent>;
