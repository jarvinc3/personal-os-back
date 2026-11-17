import type { DomainEventPublisher } from '@personal-os/contracts';
import { DOMAIN_EVENT_PUBLISHER } from '@personal-os/contracts';
import { FinanceEvents } from '../../contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@personal-os/database';
import { PrismaService } from '@personal-os/database';
import type { BudgetThresholdPort } from '../../shared/application/budget-threshold.port';
import type { BudgetSpendSnapshot } from '../../shared/domain/budget-snapshot';

@Injectable()
export class BudgetThresholdService implements BudgetThresholdPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly events: DomainEventPublisher,
  ) {}

  async processThresholds(
    userId: string,
    snapshots: BudgetSpendSnapshot[],
    tx?: unknown,
  ): Promise<void> {
    for (const snap of snapshots) {
      if (snap.amountLimit <= 0) {
        continue;
      }
      const pct = (snap.amountSpent / snap.amountLimit) * 100;
      if (pct < Number(snap.alertThresholdPct)) {
        continue;
      }

      const alert = await this.recordAlert(
        snap.budgetId,
        'threshold_crossed',
        pct,
        tx,
      );
      if (!alert?.created) {
        continue;
      }

      await this.events.enqueue(
        {
          eventName: FinanceEvents.BUDGET_THRESHOLD_CROSSED,
          aggregateType: 'FinBudget',
          aggregateId: snap.budgetId,
          userId,
          payload: {
            budgetId: snap.budgetId,
            percentageUsed: pct,
            alertId: alert.id,
          },
        },
        tx,
      );
    }
  }

  private async recordAlert(
    budgetId: string,
    type: string,
    pctUsed: number,
    tx?: unknown,
  ): Promise<{ id: string; created: boolean } | null> {
    const client = (tx as Prisma.TransactionClient | undefined) ?? this.prisma;
    const existing = await client.finBudgetAlert.findUnique({
      where: { budgetId_type: { budgetId, type } },
    });
    if (existing) {
      return { id: existing.id, created: false };
    }
    try {
      const created = await client.finBudgetAlert.create({
        data: {
          budgetId,
          type,
          pctUsed,
          wasNotified: false,
        },
      });
      return { id: created.id, created: true };
    } catch {
      const raced = await client.finBudgetAlert.findUnique({
        where: { budgetId_type: { budgetId, type } },
      });
      return raced ? { id: raced.id, created: false } : null;
    }
  }
}
