import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';
import {
  GLOBAL_DAILY_COST_LIMIT_USD,
  startOfUtcDay,
  utcDayKey,
} from '../../inference/inference-cost';
import {
  MAX_VIEW_SUGGESTION_COST_USD,
  VIEW_SUGGESTIONS_PER_MINUTE,
} from './view-suggestion-limits';

const MINUTE_COUNTER_RETENTION_MS = 60 * 60_000;

type DailyCostReservation = { reserved: boolean };

/**
 * Freno de generación de sugerencias: ritmo y cupo propios del recurso y el
 * tope global de costo de 5 USD/día que comparte con el correo de #402.
 */
@Injectable()
export class ViewSuggestionBudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Null significa que no hay cupo, ritmo o presupuesto: la fila queda vacía. */
  async reserve(userId: string): Promise<Date | null> {
    if (!(await this.reserveMinuteSlot(userId))) {
      return null;
    }
    if (!(await this.claimDailyCall(userId))) {
      return null;
    }
    const costDate = await this.reserveDailyCost();
    if (!costDate) {
      await this.releaseDailyCall(userId);
      return null;
    }
    return costDate;
  }

  /** Ajusta la reserva al costo real medido; nunca deja saldo negativo. */
  async settle({
    costDate,
    actualCostUsd,
  }: {
    costDate: Date;
    actualCostUsd: number;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE ai_email_daily_costs
      SET cost_usd = GREATEST(
            0,
            cost_usd - ${MAX_VIEW_SUGGESTION_COST_USD}::numeric + ${actualCostUsd}::numeric
          ),
          updated_at = now()
      WHERE date = ${utcDayKey(costDate)}::date
    `;
  }

  private async reserveMinuteSlot(userId: string): Promise<boolean> {
    const reservations = await this.prisma.$queryRaw<Array<{ calls: number }>>`
      INSERT INTO ai_view_suggestion_minutes (user_id, minute, calls)
      VALUES (${userId}, date_trunc('minute', now()), 1)
      ON CONFLICT (user_id, minute) DO UPDATE
        SET calls = ai_view_suggestion_minutes.calls + 1,
            updated_at = now()
        WHERE ai_view_suggestion_minutes.calls < ${VIEW_SUGGESTIONS_PER_MINUTE}::int
      RETURNING calls
    `;
    const reservation = reservations[0];
    if (reservation?.calls === 1) {
      await this.pruneMinuteCounters(userId);
    }
    return Boolean(reservation);
  }

  private async pruneMinuteCounters(userId: string): Promise<void> {
    await this.prisma.aiViewSuggestionMinute.deleteMany({
      where: {
        userId,
        minute: { lt: new Date(Date.now() - MINUTE_COUNTER_RETENTION_MS) },
      },
    });
  }

  private async claimDailyCall(userId: string): Promise<boolean> {
    const today = startOfUtcDay(new Date());
    const dailyLimit = this.config.get(
      'AI_VIEW_SUGGESTION_DAILY_MODEL_BUDGET',
      {
        infer: true,
      },
    );
    await this.prisma.aiViewSuggestionBudget.upsert({
      where: { userId },
      create: { userId, budgetDate: today, calls: 0, dailyLimit },
      update: {},
    });
    await this.prisma.aiViewSuggestionBudget.updateMany({
      where: { userId, budgetDate: { lt: today } },
      data: { budgetDate: today, calls: 0, dailyLimit },
    });
    const claimed = await this.prisma.aiViewSuggestionBudget.updateMany({
      where: { userId, budgetDate: today, calls: { lt: dailyLimit } },
      data: { calls: { increment: 1 }, dailyLimit },
    });
    return claimed.count === 1;
  }

  private async releaseDailyCall(userId: string): Promise<void> {
    await this.prisma.aiViewSuggestionBudget.updateMany({
      where: { userId, calls: { gt: 0 } },
      data: { calls: { decrement: 1 } },
    });
  }

  private async reserveDailyCost(): Promise<Date | null> {
    const date = startOfUtcDay(new Date());
    await this.prisma.aiEmailDailyCost.upsert({
      where: { date },
      create: { date, costUsd: 0 },
      update: {},
    });
    const reservations = await this.prisma.$queryRaw<DailyCostReservation[]>`
      UPDATE ai_email_daily_costs
      SET cost_usd = cost_usd + ${MAX_VIEW_SUGGESTION_COST_USD}::numeric,
          updated_at = now()
      WHERE date = ${utcDayKey(date)}::date
        AND cost_usd + ${MAX_VIEW_SUGGESTION_COST_USD}::numeric <= ${GLOBAL_DAILY_COST_LIMIT_USD}::numeric
      RETURNING true AS reserved
    `;
    return reservations[0] ? date : null;
  }
}
