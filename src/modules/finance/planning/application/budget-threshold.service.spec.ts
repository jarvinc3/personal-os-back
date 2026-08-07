import type { DomainEventPublisherPort } from '../../events/application/ports/domain-event-publisher.port';
import { BudgetThresholdService } from './budget-threshold.service';

describe('BudgetThresholdService', () => {
  it('enqueues threshold event with same tx client when alert is new', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisherPort;

    const tx = {
      finBudgetAlert: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'alert-1' }),
      },
    };

    const prisma = {
      finBudgetAlert: tx.finBudgetAlert,
    };

    const service = new BudgetThresholdService(prisma as never, events);
    await service.processThresholds(
      'user-1',
      [
        {
          budgetId: 'bud-1',
          amountSpent: 90,
          amountLimit: 100,
          alertThresholdPct: 80,
        },
      ],
      tx,
    );

    expect(enqueue).toHaveBeenCalled();
    expect(enqueue.mock.calls[0]?.[1]).toBe(tx);
  });

  it('skips enqueue when alert already exists', async () => {
    const enqueue = jest.fn();
    const events = { enqueue } as unknown as DomainEventPublisherPort;
    const tx = {
      finBudgetAlert: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
    };
    const service = new BudgetThresholdService({ finBudgetAlert: tx.finBudgetAlert } as never, events);
    await service.processThresholds(
      'user-1',
      [
        {
          budgetId: 'bud-1',
          amountSpent: 90,
          amountLimit: 100,
          alertThresholdPct: 80,
        },
      ],
      tx,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });
});
