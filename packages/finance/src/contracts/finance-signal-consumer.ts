import type { RoutedSignal, SignalConsumer } from '@personal-os/contracts';

/** Stable Finance boundary for routed intelligence signals. */
export interface FinanceSignalConsumerPort extends SignalConsumer {
  readonly domain: 'FINANCE';
  consume(signal: RoutedSignal): Promise<{
    outcome: 'APPLIED' | 'ALREADY_APPLIED' | 'REVIEW_REQUIRED' | 'REJECTED';
    domainReferences: readonly { type: string; id: string }[];
    reason?: string;
  }>;
}
