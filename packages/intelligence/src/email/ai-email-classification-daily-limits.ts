import type { Prisma, PrismaService } from '@personal-os/database';
import type { EmailClassificationNotices } from './ai-email-classification-notices';
import {
  estimateClassificationTokens,
  globalCostStatus,
  maxClassificationCostUsd,
  startOfUtcDay,
  utcDayKey,
  type EmailClassificationLimits,
} from './email-classification-limits';

/** Fila devuelta por la reserva atómica del costo global del día. */
type DailyCostReservation = {
  cost_usd: Prisma.Decimal;
  alerted_at: Date | null;
};

type EmailClassificationDailyLimitsDependencies = {
  prisma: PrismaService;
  limits: EmailClassificationLimits;
  notices: EmailClassificationNotices;
};

/**
 * El tope diario de la clasificación: tokens del día y costo global, incluido
 * el estado de pausa y alerta de la fila del día.
 */
export class EmailClassificationDailyLimits {
  private readonly prisma: PrismaService;
  private readonly limits: EmailClassificationLimits;
  private readonly notices: EmailClassificationNotices;

  constructor({
    prisma,
    limits,
    notices,
  }: EmailClassificationDailyLimitsDependencies) {
    this.prisma = prisma;
    this.limits = limits;
    this.notices = notices;
  }

  /**
   * Reserva tokens del día con un UPDATE condicionado: la fila se bloquea y
   * solo suma si la reserva todavía cabe, así que dos clasificaciones
   * concurrentes no pueden pasar el tope juntas. `false` significa que no cabe.
   */
  async reserveTokens({
    userId,
    contentChars,
  }: {
    userId: string;
    contentChars: number;
  }): Promise<number | false> {
    const date = startOfUtcDay(new Date());
    const tokenLimit = this.limits.dailyTokenBudget;
    const reservedTokens = estimateClassificationTokens({
      limits: this.limits,
      contentChars,
    });
    await this.prisma.aiEmailTokenBudget.upsert({
      where: { userId },
      create: { userId, budgetDate: date, tokens: 0, tokenLimit },
      update: {},
    });
    await this.prisma.aiEmailTokenBudget.updateMany({
      where: { userId, budgetDate: { lt: date } },
      data: { budgetDate: date, tokens: 0, tokenLimit },
    });
    const reserved = await this.prisma.aiEmailTokenBudget.updateMany({
      where: {
        userId,
        budgetDate: date,
        tokens: { lte: tokenLimit - reservedTokens },
      },
      data: { tokens: { increment: reservedTokens }, tokenLimit },
    });
    return reserved.count === 1 ? reservedTokens : false;
  }

  async releaseTokens({
    userId,
    tokens,
  }: {
    userId: string;
    tokens: number;
  }): Promise<void> {
    await this.prisma.aiEmailTokenBudget.updateMany({
      where: {
        userId,
        budgetDate: startOfUtcDay(new Date()),
        tokens: { gte: tokens },
      },
      data: { tokens: { decrement: tokens } },
    });
  }

  /**
   * Ajusta la reserva a los tokens reales de la inferencia contra el día que la
   * reservó. Si el proveedor no reporta tokens, la reserva se queda completa.
   */
  async settleTokens({
    userId,
    date,
    reservedTokens,
    usedTokens,
  }: {
    userId: string;
    date: Date;
    reservedTokens: number;
    usedTokens: number;
  }): Promise<void> {
    const adjustment = reservedTokens - usedTokens;
    if (adjustment === 0) {
      return;
    }
    await this.prisma.aiEmailTokenBudget.updateMany({
      where: { userId, budgetDate: date },
      data: {
        tokens:
          adjustment > 0
            ? { decrement: adjustment }
            : { increment: -adjustment },
      },
    });
  }

  async isPaused(): Promise<boolean> {
    const dailyCost = await this.prisma.aiEmailDailyCost.findUnique({
      where: { date: startOfUtcDay(new Date()) },
      select: { costUsd: true },
    });
    return Boolean(
      dailyCost &&
      globalCostStatus({
        costUsd: Number(dailyCost.costUsd),
        limitUsd: this.limits.dailyCostLimitUsd,
        alertRatio: this.limits.costAlertRatio,
      }) === 'PAUSED',
    );
  }

  /**
   * Reserva el costo máximo de la clasificación con un UPDATE condicionado: la
   * fila del día se bloquea y solo suma si todavía cabe bajo el tope, así que dos
   * clasificaciones concurrentes no pueden pasarlo a la vez.
   */
  async reserveCost(userId: string): Promise<Date | null> {
    const date = startOfUtcDay(new Date());
    const maxCostUsd = maxClassificationCostUsd(this.limits);
    await this.prisma.aiEmailDailyCost.upsert({
      where: { date },
      create: { date, costUsd: 0 },
      update: {},
    });
    const reservations = await this.prisma.$queryRaw<DailyCostReservation[]>`
      UPDATE ai_email_daily_costs
      SET cost_usd = cost_usd + ${maxCostUsd}::numeric,
          updated_at = now()
      WHERE date = ${utcDayKey(date)}::date
        AND cost_usd + ${maxCostUsd}::numeric <= ${this.limits.dailyCostLimitUsd}::numeric
      RETURNING cost_usd, alerted_at
    `;
    const reservation = reservations[0];
    if (!reservation) {
      await this.pauseDailyCost({ userId, date });
      return null;
    }
    await this.alertDailyCost({
      userId,
      date,
      costUsd: Number(reservation.cost_usd),
      alertedAt: reservation.alerted_at,
    });
    return date;
  }

  /**
   * Ajusta la reserva al costo real de la inferencia contra el día que la
   * reservó. El costo suma cada intento con la tarifa de su modelo —también el
   * rechazado cuando hubo reparación— y no supera la reserva, que cubre los
   * topes de entrada y salida, así que el ajuste no puede pasar el freno diario.
   * Si la fila del día ya no existe, el ajuste no hace nada.
   */
  async settleCost({
    date,
    costUsd,
  }: {
    date: Date;
    costUsd: number;
  }): Promise<void> {
    const adjustmentUsd = Number(
      (maxClassificationCostUsd(this.limits) - costUsd).toFixed(6),
    );
    if (adjustmentUsd === 0) {
      return;
    }
    await this.prisma.aiEmailDailyCost.updateMany({
      where: { date },
      data: {
        costUsd:
          adjustmentUsd > 0
            ? { decrement: adjustmentUsd }
            : { increment: -adjustmentUsd },
      },
    });
  }

  private async pauseDailyCost({
    userId,
    date,
  }: {
    userId: string;
    date: Date;
  }): Promise<void> {
    const paused = await this.prisma.aiEmailDailyCost.updateMany({
      where: { date, pausedAt: null },
      data: { pausedAt: new Date() },
    });
    if (paused.count === 0) {
      return;
    }
    await this.notices.costPaused(userId);
  }

  private async alertDailyCost({
    userId,
    date,
    costUsd,
    alertedAt,
  }: {
    userId: string;
    date: Date;
    costUsd: number;
    alertedAt: Date | null;
  }): Promise<void> {
    if (
      alertedAt ||
      globalCostStatus({
        costUsd,
        limitUsd: this.limits.dailyCostLimitUsd,
        alertRatio: this.limits.costAlertRatio,
      }) !== 'ALERT'
    ) {
      return;
    }
    const alerted = await this.prisma.aiEmailDailyCost.updateMany({
      where: { date, alertedAt: null },
      data: { alertedAt: new Date() },
    });
    if (alerted.count === 0) {
      return;
    }
    await this.notices.costAlert(userId);
  }
}
