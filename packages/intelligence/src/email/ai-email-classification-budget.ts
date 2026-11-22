import type { PrismaService } from '@personal-os/database';
import type { ModelBudget } from './ai-email-classification.types';
import type { EmailClassificationDailyLimits } from './ai-email-classification-daily-limits';
import type { EmailClassificationNotices } from './ai-email-classification-notices';
import type { EmailClassificationLimits } from './email-classification-limits';

const MINUTE_COUNTER_RETENTION_MS = 60 * 60_000;

/** Cupo de carga inicial reclamado para una conexión de Gmail. */
type InitialBudgetClaim = { completedInitialBudget: boolean };

/** Cupo concedido para clasificar; `costDate` es el día del costo reservado. */
export type ModelBudgetGrant = {
  costDate: Date;
  /** Tokens reservados del día; null cuando la llamada sale de la carga inicial. */
  reservedTokens: number | null;
};

type EmailClassificationBudgetDependencies = {
  prisma: PrismaService;
  limits: EmailClassificationLimits;
  dailyLimits: EmailClassificationDailyLimits;
  notices: EmailClassificationNotices;
};

/**
 * El cupo de clasificación por usuario: ritmo por minuto, carga inicial de la
 * conexión y la reserva completa de una llamada al modelo. Lo que se reserva se
 * devuelve cuando la llamada no llega a correr.
 */
export class EmailClassificationBudget {
  private readonly prisma: PrismaService;
  private readonly limits: EmailClassificationLimits;
  private readonly dailyLimits: EmailClassificationDailyLimits;
  private readonly notices: EmailClassificationNotices;

  constructor({
    prisma,
    limits,
    dailyLimits,
    notices,
  }: EmailClassificationBudgetDependencies) {
    this.prisma = prisma;
    this.limits = limits;
    this.dailyLimits = dailyLimits;
    this.notices = notices;
  }

  /**
   * Reserva el costo máximo de la llamada. La clasificación normal además ocupa
   * el cupo del usuario; la vista previa solo paga el costo. Un modelo nunca se
   * llama sin reserva. Null significa que no hay presupuesto.
   */
  async acquireModelBudget({
    userId,
    modelBudget,
    contentChars,
  }: {
    userId: string;
    modelBudget: ModelBudget;
    contentChars: number;
  }): Promise<ModelBudgetGrant | null> {
    if (modelBudget === 'reserve') {
      return this.reserveModelCall({ userId, contentChars });
    }
    if (!(await this.hasModelBudget())) {
      return null;
    }
    const costDate = await this.dailyLimits.reserveCost(userId);
    return costDate ? { costDate, reservedTokens: null } : null;
  }

  /**
   * Reserva atómica de una clasificación en la ventana del minuto. La fila vive
   * en la base y la comparten todas las réplicas: el INSERT solo deja pasar
   * mientras la cuenta no llegue al límite.
   */
  async reserveClassificationSlot(userId: string): Promise<boolean> {
    const reserved = await this.prisma.$queryRaw<Array<{ calls: number }>>`
      INSERT INTO ai_email_classification_minutes (user_id, minute, calls)
      VALUES (${userId}, date_trunc('minute', now()), 1)
      ON CONFLICT (user_id, minute) DO UPDATE
        SET calls = ai_email_classification_minutes.calls + 1,
            updated_at = now()
        WHERE ai_email_classification_minutes.calls < ${this.limits.classificationsPerMinute}::int
      RETURNING calls
    `;
    const reservation = reserved[0];
    if (reservation?.calls === 1) {
      await this.pruneClassificationMinutes(userId);
    }
    return Boolean(reservation);
  }

  /**
   * Reserva el cupo del usuario y el costo máximo del día. Toda clasificación
   * con modelo, también la de la carga inicial, ocupa el tope diario de tokens;
   * la carga inicial solo limita cuántas clasificaciones de bienvenida quedan.
   * Si el costo global no cabe, lo reservado vuelve y la clasificación no corre.
   */
  private async reserveModelCall({
    userId,
    contentChars,
  }: {
    userId: string;
    contentChars: number;
  }): Promise<ModelBudgetGrant | null> {
    const initialClaim = await this.claimInitialCall(userId);
    const reservedTokens = await this.dailyLimits.reserveTokens({
      userId,
      contentChars,
    });
    if (reservedTokens === false) {
      await this.releaseInitialCall({ userId, claim: initialClaim });
      await this.notices.dailyBudgetExhausted(userId);
      return null;
    }
    const costDate = await this.dailyLimits.reserveCost(userId);
    if (!costDate) {
      await this.releaseBudget({ userId, initialClaim, reservedTokens });
      return null;
    }
    if (initialClaim?.completedInitialBudget) {
      await this.notices.initialBudgetDepleted(userId);
    }
    return { costDate, reservedTokens };
  }

  /** La vista previa solo respeta el freno global: no consume el cupo diario. */
  private async hasModelBudget(): Promise<boolean> {
    return !(await this.dailyLimits.isPaused());
  }

  /** La ventana solo importa al minuto en curso; las filas viejas se descartan. */
  private async pruneClassificationMinutes(userId: string): Promise<void> {
    await this.prisma.aiEmailClassificationMinute.deleteMany({
      where: {
        userId,
        minute: { lt: new Date(Date.now() - MINUTE_COUNTER_RETENTION_MS) },
      },
    });
  }

  /** Reclama una clasificación de la carga inicial de la conexión. */
  private async claimInitialCall(
    userId: string,
  ): Promise<InitialBudgetClaim | null> {
    const connection = await this.prisma.aiEmailConnection.findUnique({
      where: { userId },
      select: { initialBudgetRemaining: true },
    });
    const initialRemaining = connection?.initialBudgetRemaining ?? 0;
    if (initialRemaining <= 0) {
      return null;
    }
    const claimed = await this.prisma.aiEmailConnection.updateMany({
      where: { userId, initialBudgetRemaining: { gt: 0 } },
      data: { initialBudgetRemaining: { decrement: 1 } },
    });
    return claimed.count === 1
      ? { completedInitialBudget: initialRemaining === 1 }
      : null;
  }

  /** Devuelve la bienvenida y los tokens cuando la llamada no llega a correr. */
  private async releaseBudget({
    userId,
    initialClaim,
    reservedTokens,
  }: {
    userId: string;
    initialClaim: InitialBudgetClaim | null;
    reservedTokens: number | null;
  }): Promise<void> {
    await this.releaseInitialCall({ userId, claim: initialClaim });
    if (reservedTokens) {
      await this.dailyLimits.releaseTokens({ userId, tokens: reservedTokens });
    }
  }

  private async releaseInitialCall({
    userId,
    claim,
  }: {
    userId: string;
    claim: InitialBudgetClaim | null;
  }): Promise<void> {
    if (!claim) {
      return;
    }
    await this.prisma.aiEmailConnection.updateMany({
      where: { userId },
      data: { initialBudgetRemaining: { increment: 1 } },
    });
  }
}
