import { matchesSenderFilter } from './gmail-import-scope';

/** Límites del piloto acordados en #395 y #402. */
export const CLASSIFICATIONS_PER_MINUTE = 20;
export const INITIAL_CLASSIFICATION_BUDGET = 500;
export const GLOBAL_DAILY_COST_LIMIT_USD = 5;
export const GLOBAL_COST_ALERT_RATIO = 0.8;

/**
 * Costo máximo que se reserva antes de cada clasificación con modelo. Cubre el
 * contenido recortado a 24 000 caracteres (unos 8 000 tokens), la respuesta, el
 * reintento de reparación y el fallback de proveedor, al precio conservador por
 * defecto: 4 × (8 000 × 0.2 + 2 000 × 0.6) / 1 000 000 ≈ 0.011 USD. Con el tope
 * diario de 100 llamadas por usuario, la reserva completa nunca agota los 5 USD.
 */
export const MAX_CLASSIFICATION_COST_USD = 0.02;

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
