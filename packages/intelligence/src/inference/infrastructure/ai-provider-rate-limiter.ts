import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import { PrismaService } from '@personal-os/database';

/** Tarea de clasificación de correo: es la única que espera turno. */
const EMAIL_CLASSIFICATION_TASK = 'EMAIL_CLASSIFICATION';
/** El piloto se queda en el 80 % del RPM contratado. */
const CONTRACTED_RATE_SHARE = 0.8;
const MINUTE_MS = 60_000;
/** Margen para que el siguiente minuto ya esté abierto al despertar. */
const MINUTE_MARGIN_MS = 50;
/** Tope total de espera por turno en una tarea por lote. */
const MAX_BATCH_WAIT_MS = 5 * MINUTE_MS;
const MINUTE_RETENTION_MS = 60 * MINUTE_MS;

/** Nombre con el que el cliente reporta al proveedor → variable de su RPM. */
const PROVIDER_RPM_ENV: Record<
  string,
  'AI_PROVIDER_RPM_GROQ' | 'AI_PROVIDER_RPM_OPENROUTER'
> = {
  groq: 'AI_PROVIDER_RPM_GROQ',
  openrouter: 'AI_PROVIDER_RPM_OPENROUTER',
};

export const PROVIDER_RATE_LIMIT_WAIT = Symbol('PROVIDER_RATE_LIMIT_WAIT');
export type ProviderRateLimitWait = (ms: number) => Promise<void>;

const defaultWait: ProviderRateLimitWait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Ritmo de llamadas por proveedor y minuto. El RPM pertenece a la cuenta del
 * proveedor, así que el contador vive en PostgreSQL y lo comparten todas las
 * réplicas y todas las tareas. La tarea de correo espera al siguiente minuto en
 * vez de recibir un 429; el resto falla rápido para no bloquear una respuesta
 * interactiva detrás del lote.
 */
@Injectable()
export class AiProviderRateLimiter {
  private readonly logger = new Logger(AiProviderRateLimiter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Optional()
    @Inject(PROVIDER_RATE_LIMIT_WAIT)
    private readonly wait: ProviderRateLimitWait = defaultWait,
  ) {}

  async acquire({
    providerName,
    task,
  }: {
    providerName: string;
    task: string;
  }): Promise<boolean> {
    const limit = this.limitFor(providerName);
    if (limit === null) {
      return true;
    }
    if (await this.reserve({ providerName, limit })) {
      return true;
    }
    if (task !== EMAIL_CLASSIFICATION_TASK) {
      this.logger.warn(
        `Provider ${providerName} reached its minute share (${limit} calls); ${task} fails fast`,
      );
      return false;
    }
    return this.waitForNextSlot({ providerName, limit });
  }

  /** 80 % del RPM contratado; null si el proveedor no declara límite. */
  limitFor(providerName: string): number | null {
    const envKey = PROVIDER_RPM_ENV[providerName.trim().toLowerCase()];
    if (!envKey) {
      return null;
    }
    const contractedPerMinute = this.config.get(envKey, { infer: true });
    return Math.max(1, Math.floor(contractedPerMinute * CONTRACTED_RATE_SHARE));
  }

  private async waitForNextSlot({
    providerName,
    limit,
  }: {
    providerName: string;
    limit: number;
  }): Promise<boolean> {
    let waitedMs = 0;
    while (waitedMs < MAX_BATCH_WAIT_MS) {
      const delayMs = msUntilNextMinute(new Date());
      await this.wait(delayMs);
      waitedMs += delayMs;
      if (await this.reserve({ providerName, limit })) {
        return true;
      }
    }
    this.logger.warn(
      `Provider ${providerName} stayed saturated after ${waitedMs} ms of waiting`,
    );
    return false;
  }

  private async reserve({
    providerName,
    limit,
  }: {
    providerName: string;
    limit: number;
  }): Promise<boolean> {
    const reserved = await this.prisma.$queryRaw<Array<{ calls: number }>>`
      INSERT INTO ai_provider_minutes (provider, minute, calls)
      VALUES (${providerName}, date_trunc('minute', now()), 1)
      ON CONFLICT (provider, minute) DO UPDATE
        SET calls = ai_provider_minutes.calls + 1,
            updated_at = now()
        WHERE ai_provider_minutes.calls < ${limit}::int
      RETURNING calls
    `;
    const reservation = reserved[0];
    if (reservation?.calls === 1) {
      await this.pruneOldMinutes(providerName);
    }
    return Boolean(reservation);
  }

  /** Solo importa el minuto en curso; las filas viejas se descartan. */
  private async pruneOldMinutes(providerName: string): Promise<void> {
    await this.prisma.aiProviderMinute.deleteMany({
      where: {
        provider: providerName,
        minute: { lt: new Date(Date.now() - MINUTE_RETENTION_MS) },
      },
    });
  }
}

export function msUntilNextMinute(now: Date): number {
  return MINUTE_MS - (now.getTime() % MINUTE_MS) + MINUTE_MARGIN_MS;
}
