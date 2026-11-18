import { matchesSenderFilter } from './gmail-import-scope';

/** Límites del piloto acordados en #395 y #402. */
export const CLASSIFICATIONS_PER_MINUTE = 20;
export const INITIAL_CLASSIFICATION_BUDGET = 500;
export const GLOBAL_DAILY_COST_LIMIT_USD = 5;
export const GLOBAL_COST_ALERT_RATIO = 0.8;

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

/** Ventana deslizante de un minuto para el ritmo por usuario. */
export function recentClassificationTimestamps({
  timestamps,
  now,
}: {
  timestamps: readonly number[];
  now: Date;
}): number[] {
  const windowStart = now.getTime() - 60_000;
  return timestamps.filter((timestamp) => timestamp > windowStart);
}
