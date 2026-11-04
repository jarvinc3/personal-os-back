import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  FINANCE_EVENT_VERSION,
  FinanceEvents,
  type FinanceDomainEvent,
} from './finance-events';
import type { FinanceNotificationAdapter } from './finance-notifications';
import type { FinanceSignalConsumerPort } from './finance-signal-consumer';

const repositoryRoot = resolve(__dirname, '../../../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('Finance boundary contracts', () => {
  it('publishes stable Finance-owned names and a semantic version', () => {
    expect(FINANCE_EVENT_VERSION).toBe(1);
    expect(FinanceEvents.TRANSACTION_CONFIRMED).toBe(
      'finance.transaction.confirmed',
    );
    expect(FinanceEvents.BALANCE_DRIFT_DETECTED).toBe(
      'finance.balance.drift_detected',
    );
  });

  it('allows a signal consumer double without email or Finance implementation types', async () => {
    const double: FinanceSignalConsumerPort = {
      domain: 'FINANCE',
      consume(signal) {
        expect(signal.signalType).toBe('FINANCE.TRANSACTION_DETECTED');
        return Promise.resolve({
          outcome: 'REVIEW_REQUIRED',
          domainReferences: [],
        });
      },
    };
    const result = await double.consume({
      signalId: 'signal-1',
      userId: 'user-1',
      signalType: 'FINANCE.TRANSACTION_DETECTED',
      schemaVersion: 1,
      occurredAt: '2026-11-03T00:00:00.000Z',
      sourceType: 'email',
      sourceId: 'source-1',
      payload: {},
    });
    expect(result.outcome).toBe('REVIEW_REQUIRED');
  });

  it('accepts generic notification intents from a Finance event adapter', () => {
    const event: FinanceDomainEvent<
      typeof FinanceEvents.BUDGET_THRESHOLD_CROSSED
    > = {
      eventId: 'event-1',
      eventName: FinanceEvents.BUDGET_THRESHOLD_CROSSED,
      version: FINANCE_EVENT_VERSION,
      occurredAt: '2026-11-03T00:00:00.000Z',
      userId: 'user-1',
      aggregateType: 'FinBudget',
      aggregateId: 'budget-1',
      payload: { budgetId: 'budget-1', percentageUsed: 90, alertId: 'alert-1' },
    };
    const adapter: FinanceNotificationAdapter = {
      toIntents: () => [
        {
          schemaVersion: 1,
          userId: 'user-1',
          sourceDomain: 'finance',
          type: FinanceEvents.BUDGET_THRESHOLD_CROSSED,
          title: 'Presupuesto',
          body: 'Límite alcanzado',
          requestedChannels: ['IN_APP'],
          deduplicationKey: 'budget:budget-1',
          occurredAt: event.occurredAt,
        },
      ],
    };
    expect(adapter.toIntents(event)[0].sourceDomain).toBe('finance');
  });

  it('keeps imports pointed through neutral contracts', () => {
    const aiFiles = sourceFiles(
      join(repositoryRoot, 'packages/intelligence/src'),
    );
    const financeFiles = sourceFiles(
      join(repositoryRoot, 'packages/finance/src'),
    ).filter((file) => !file.endsWith('.spec.ts'));

    for (const file of aiFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(
        /from\s+['"][^'"]*(?:@personal-os\/finance|packages\/finance)[^'"]*['"]/,
      );
    }

    for (const file of financeFiles) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/AppEvents\.FINANCE_[A-Z_]+/);
      expect(source).not.toMatch(
        /from\s+['"][^'"]*(?:googleapis|@google\/|gmail-(?:source|sync)|intelligence\/.*email|core\/ai\/chat-context)[^'"]*['"]/i,
      );
    }
  });

  it('keeps Finance event names and DTOs out of Core', () => {
    const coreEventsDirectory = join(
      repositoryRoot,
      'packages/core/src/events',
    );
    const constants = readFileSync(
      join(coreEventsDirectory, 'event.constants.ts'),
      'utf8',
    );
    const domainEvents = readFileSync(
      join(coreEventsDirectory, 'domain-events.ts'),
      'utf8',
    );

    expect(constants).not.toMatch(/FINANCE_[A-Z_]+|finance\./);
    expect(domainEvents).not.toMatch(
      /TransactionCreatedEvent|TransactionUpdatedEvent|BudgetThresholdReachedEvent|FinanceTransferCreatedEvent/,
    );
  });
});
