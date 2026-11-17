import type { DomainEventPublisher } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import { BudgetThresholdService } from './budget-threshold.service';

describe('BudgetThresholdService', () => {
  const crossingSnapshot = {
    budgetId: 'bud-1',
    amountSpent: 90,
    amountLimit: 100,
    alertThresholdPct: 80,
  };

  it('enqueues threshold event with same tx client when alert is new', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const events = { enqueue } as unknown as DomainEventPublisher;

    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'alert-1' });
    const tx = {
      finBudgetAlert: {
        findUnique,
        create,
      },
    };

    const prisma = {
      finBudgetAlert: tx.finBudgetAlert,
    };

    const service = new BudgetThresholdService(prisma as never, events);
    await service.processThresholds('user-1', [crossingSnapshot], tx);

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        budgetId_type: { budgetId: 'bud-1', type: 'threshold_crossed' },
      },
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: FinanceEvents.BUDGET_THRESHOLD_CROSSED,
        aggregateType: 'FinBudget',
        aggregateId: 'bud-1',
        userId: 'user-1',
        payload: expect.objectContaining({
          budgetId: 'bud-1',
          percentageUsed: 90,
          alertId: 'alert-1',
        }),
      }),
      tx,
    );
    expect(enqueue.mock.calls[0]?.[1]).toBe(tx);
  });

  it('skips enqueue when alert already exists', async () => {
    const enqueue = jest.fn();
    const events = { enqueue } as unknown as DomainEventPublisher;
    const tx = {
      finBudgetAlert: {
        findUnique: jest.fn().mockResolvedValue({ id: 'existing' }),
        create: jest.fn(),
      },
    };
    const service = new BudgetThresholdService(
      { finBudgetAlert: tx.finBudgetAlert } as never,
      events,
    );
    await service.processThresholds('user-1', [crossingSnapshot], tx);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips enqueue when create races and alert row already exists', async () => {
    const enqueue = jest.fn();
    const events = { enqueue } as unknown as DomainEventPublisher;
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'raced-alert' });
    const create = jest.fn().mockRejectedValue(new Error('unique'));
    const tx = {
      finBudgetAlert: { findUnique, create },
    };
    const service = new BudgetThresholdService(
      { finBudgetAlert: tx.finBudgetAlert } as never,
      events,
    );

    await service.processThresholds('user-1', [crossingSnapshot], tx);

    expect(create).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips when percentage is below alert threshold', async () => {
    const enqueue = jest.fn();
    const events = { enqueue } as unknown as DomainEventPublisher;
    const findUnique = jest.fn();
    const create = jest.fn();
    const tx = {
      finBudgetAlert: { findUnique, create },
    };
    const service = new BudgetThresholdService(
      { finBudgetAlert: tx.finBudgetAlert } as never,
      events,
    );

    await service.processThresholds(
      'user-1',
      [
        {
          budgetId: 'bud-1',
          amountSpent: 50,
          amountLimit: 100,
          alertThresholdPct: 80,
        },
      ],
      tx,
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('skips when amountLimit is zero or negative', async () => {
    const enqueue = jest.fn();
    const events = { enqueue } as unknown as DomainEventPublisher;
    const findUnique = jest.fn();
    const create = jest.fn();
    const tx = {
      finBudgetAlert: { findUnique, create },
    };
    const service = new BudgetThresholdService(
      { finBudgetAlert: tx.finBudgetAlert } as never,
      events,
    );

    await service.processThresholds(
      'user-1',
      [
        {
          budgetId: 'bud-1',
          amountSpent: 10,
          amountLimit: 0,
          alertThresholdPct: 80,
        },
      ],
      tx,
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
