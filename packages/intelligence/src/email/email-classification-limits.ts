import type { ConfigService } from '@nestjs/config';
import type { Env } from '@personal-os/config';
import {
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS,
  MODEL_PRICES_USD_PER_MILLION_TOKENS,
} from '../inference/inference-pricing';
import { matchesSenderFilter } from './gmail-import-scope';

/**
 * Límites del piloto de clasificación (#402). Salen del entorno
 * (`AI_EMAIL_*`) y se leen una vez por servicio; cambiar un tope no requiere
 * desplegar código. Los valores por defecto son los medidos en DEV y viven en
 * `packages/config/src/env.schema.ts`.
 */
export type EmailClassificationLimits = {
  classificationsPerMinute: number;
  initialBudget: number;
  dailyTokenBudget: number;
  dailyCostLimitUsd: number;
  costAlertRatio: number;
  maxContentChars: number;
  maxSubjectChars: number;
  maxSenderChars: number;
  bankSenderDomains: readonly string[];
};

export function readEmailClassificationLimits(
  config: ConfigService<Env, true>,
): EmailClassificationLimits {
  return {
    classificationsPerMinute: config.get(
      'AI_EMAIL_CLASSIFICATIONS_PER_MINUTE',
      { infer: true },
    ),
    initialBudget: config.get('AI_EMAIL_INITIAL_BUDGET', { infer: true }),
    dailyTokenBudget: config.get('AI_EMAIL_DAILY_TOKEN_BUDGET', {
      infer: true,
    }),
    dailyCostLimitUsd: config.get('AI_EMAIL_DAILY_COST_LIMIT_USD', {
      infer: true,
    }),
    costAlertRatio: config.get('AI_EMAIL_COST_ALERT_RATIO', { infer: true }),
    maxContentChars: config.get('AI_EMAIL_MAX_CONTENT_CHARS', { infer: true }),
    maxSubjectChars: config.get('AI_EMAIL_MAX_SUBJECT_CHARS', { infer: true }),
    maxSenderChars: config.get('AI_EMAIL_MAX_SENDER_CHARS', { infer: true }),
    bankSenderDomains: config.get('AI_EMAIL_BANK_SENDER_DOMAINS', {
      infer: true,
    }),
  };
}

/**
 * Prompt de sistema, esquema JSON, sobre del correo y la instrucción de
 * reparación. Hoy suman unos 5 100 caracteres; el margen cubre cambios menores.
 */
export const PROMPT_OVERHEAD_CHARS = 12_000;
/** Dos proveedores por el reintento de reparación de la salida. */
const MAX_PROVIDER_ATTEMPTS = 4;
/** Groq y OpenRouter limitan la salida a 4096 tokens por intento. */
const MAX_OUTPUT_TOKENS_PER_ATTEMPT = 4_096;
/** Un carácter UTF-8 ocupa hasta 4 bytes y un token nunca supera un byte. */
const MAX_BYTES_PER_CHAR = 4;
/**
 * Heurística para reservar tokens de entrada antes de la llamada: en texto
 * español un token ronda 3 caracteres, así que dividir por 3 sobreestima el
 * consumo y la reserva no se queda corta con contenido denso.
 */
const CHARS_PER_TOKEN = 3;

const TOP_INPUT_PRICE_USD_PER_MILLION_TOKENS = Math.max(
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS.input,
  ...Object.values(MODEL_PRICES_USD_PER_MILLION_TOKENS).map(
    (price) => price.input,
  ),
);
const TOP_OUTPUT_PRICE_USD_PER_MILLION_TOKENS = Math.max(
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS.output,
  ...Object.values(MODEL_PRICES_USD_PER_MILLION_TOKENS).map(
    (price) => price.output,
  ),
);

/**
 * Costo máximo que se reserva antes de cada clasificación con modelo. Se
 * calcula desde los topes configurados, que el código aplica al recortar:
 * contenido, asunto y remitente, más el sobre del prompt, en el peor caso
 * UTF-8, con los cuatro intentos posibles y la salida que limitan los
 * proveedores, al precio más alto de la tabla. La reserva cubre el costo real;
 * al terminar se ajusta hacia abajo.
 */
export function maxClassificationCostUsd(
  limits: EmailClassificationLimits,
): number {
  const promptChars =
    limits.maxContentChars +
    limits.maxSubjectChars +
    limits.maxSenderChars +
    PROMPT_OVERHEAD_CHARS;
  const worstCaseUsd =
    (MAX_PROVIDER_ATTEMPTS *
      (promptChars *
        MAX_BYTES_PER_CHAR *
        TOP_INPUT_PRICE_USD_PER_MILLION_TOKENS +
        MAX_OUTPUT_TOKENS_PER_ATTEMPT *
          TOP_OUTPUT_PRICE_USD_PER_MILLION_TOKENS)) /
    1_000_000;
  return Math.ceil(worstCaseUsd / 0.01) * 0.01;
}

/**
 * Tokens que se reservan antes de una llamada: la entrada estimada desde el
 * contenido que se enviará y la salida máxima por intento. Al terminar se
 * ajusta a los tokens reales de todos los intentos.
 */
export function estimateClassificationTokens({
  limits,
  contentChars,
}: {
  limits: EmailClassificationLimits;
  contentChars: number;
}): number {
  const promptChars =
    contentChars +
    limits.maxSubjectChars +
    limits.maxSenderChars +
    PROMPT_OVERHEAD_CHARS;
  return (
    Math.ceil(promptChars / CHARS_PER_TOKEN) + MAX_OUTPUT_TOKENS_PER_ATTEMPT
  );
}

export function isBankSenderDomain(
  fromDomain: string,
  bankSenderDomains: readonly string[],
): boolean {
  const domain = fromDomain.trim().toLowerCase();
  return bankSenderDomains.some((bankDomain) =>
    matchesSenderFilter({ fromDomain: domain, senderFilter: bankDomain }),
  );
}

export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Clave `AAAA-MM-DD` del día UTC, para SQL que compara la columna `date`. */
export function utcDayKey(now: Date): string {
  return startOfUtcDay(now).toISOString().slice(0, 10);
}

export type GlobalCostStatus = 'OK' | 'ALERT' | 'PAUSED';

export function globalCostStatus({
  costUsd,
  limits,
}: {
  costUsd: number;
  limits: Pick<
    EmailClassificationLimits,
    'dailyCostLimitUsd' | 'costAlertRatio'
  >;
}): GlobalCostStatus {
  if (costUsd >= limits.dailyCostLimitUsd) {
    return 'PAUSED';
  }
  if (costUsd >= limits.dailyCostLimitUsd * limits.costAlertRatio) {
    return 'ALERT';
  }
  return 'OK';
}
