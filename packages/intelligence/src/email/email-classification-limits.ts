import {
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS,
  MODEL_PRICES_USD_PER_MILLION_TOKENS,
} from '../inference/inference-pricing';
import { matchesSenderFilter } from './gmail-import-scope';

/** Límites del piloto acordados en #395 y #402. */
export const CLASSIFICATIONS_PER_MINUTE = 20;
export const INITIAL_CLASSIFICATION_BUDGET = 500;
export const GLOBAL_DAILY_COST_LIMIT_USD = 5;
export const GLOBAL_COST_ALERT_RATIO = 0.8;

/** Contenido que se envía al modelo; el resto del correo no viaja. */
export const MAX_EMAIL_CONTENT_CHARS = 24_000;
/** Dos proveedores por el reintento de reparación de la salida. */
const MAX_PROVIDER_ATTEMPTS = 4;
/** Groq y OpenRouter limitan la salida a 4096 tokens por intento. */
const MAX_OUTPUT_TOKENS_PER_ATTEMPT = 4_096;
/** Prompt de sistema, esquema JSON y sobre del correo. */
const PROMPT_TOKEN_ALLOWANCE = 4_000;
/** Un carácter UTF-8 ocupa hasta 4 bytes y un token nunca supera un byte. */
const MAX_TOKENS_PER_CHAR = 4;

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
 * calcula desde los topes reales del flujo —caracteres de contenido, salida que
 * limitan los proveedores e intentos— al precio más alto de la tabla, para que
 * la reserva no dependa de una estimación de tokens. Al terminar, se ajusta al
 * costo real de los intentos, hacia arriba o hacia abajo.
 */
export const MAX_CLASSIFICATION_COST_USD =
  Math.ceil(
    (MAX_PROVIDER_ATTEMPTS *
      ((MAX_EMAIL_CONTENT_CHARS * MAX_TOKENS_PER_CHAR +
        PROMPT_TOKEN_ALLOWANCE) *
        TOP_INPUT_PRICE_USD_PER_MILLION_TOKENS +
        MAX_OUTPUT_TOKENS_PER_ATTEMPT *
          TOP_OUTPUT_PRICE_USD_PER_MILLION_TOKENS)) /
      1_000_000 /
      0.01,
  ) * 0.01;

/**
 * Dominios bancarios que pueden llegar a la IA. La lista es la semilla del
 * piloto; convertirla en configuración por entorno queda reportado en #402.
 */
export const BANK_SENDER_DOMAINS = [
  'bhd.com.do',
  'popular.com.do',
  'qik.do',
  'banreservas.com',
  'scotiabank.com.do',
  'bancosantacruz.com.do',
  'bancolopezdeharo.com',
  'vimenca.com',
  'bancocaribe.com.do',
  'promerica.com.do',
  'bdi.com.do',
  'alaver.com.do',
];

export function isBankSenderDomain(fromDomain: string): boolean {
  const domain = fromDomain.trim().toLowerCase();
  return BANK_SENDER_DOMAINS.some((bankDomain) =>
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
  limitUsd = GLOBAL_DAILY_COST_LIMIT_USD,
  alertRatio = GLOBAL_COST_ALERT_RATIO,
}: {
  costUsd: number;
  limitUsd?: number;
  alertRatio?: number;
}): GlobalCostStatus {
  if (costUsd >= limitUsd) {
    return 'PAUSED';
  }
  if (costUsd >= limitUsd * alertRatio) {
    return 'ALERT';
  }
  return 'OK';
}
