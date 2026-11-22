import type { IsoInstant, JsonObject } from './primitives';

// A signal remains an intelligence record, not a domain event or intent.
export interface RoutedSignal<T extends JsonObject = JsonObject> {
  signalId: string;
  userId: string;
  signalType: string;
  schemaVersion: number;
  occurredAt: IsoInstant;
  sourceType: string;
  sourceId: string;
  payload: T;
}
/**
 * Lo que un consumidor haría con una señal, sin escribir nada. Lo usan las
 * vistas previas: el resultado sale del mismo paso de decisión que la escritura.
 */
export interface SignalImportPreview {
  outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
  reason?: string;
  /** Every applicable review code, ordered from highest to lowest severity. */
  reviewReasons?: readonly string[];
  domainReferences?: readonly { type: string; id: string }[];
  cardPayment?: {
    sourceAccountId: string;
    cardId: string;
    amount: number;
    currency: string;
    status: string;
    transactionDate: string;
    description: string;
    externalReference: string | null;
    importReference: string;
  };
  movement?: {
    accountId: string | null;
    cardId: string | null;
    amount: number;
    currency: string;
    type: string;
    status: string;
    transactionDate: string;
    description: string;
    categoryId: string | null;
    legRole: string | null;
    externalReference: string | null;
    importReference: string;
  };
}

export interface SignalConsumer<T extends JsonObject = JsonObject> {
  readonly domain: string;
  consume(signal: RoutedSignal<T>): Promise<{
    outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
    domainReferences: readonly { type: string; id: string }[];
    reason?: string;
  }>;
  /** Opcional: solo los consumidores que pueden decidir sin escribir. */
  preview?(signal: RoutedSignal<T>): Promise<SignalImportPreview>;
}
