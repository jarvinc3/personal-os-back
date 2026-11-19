/**
 * Tope global de costo de inferencia por día UTC, compartido por los productos
 * de IA. La tabla `ai_email_daily_costs` nació con el piloto de correo y sigue
 * siendo la fuente única del freno.
 */
export const GLOBAL_DAILY_COST_LIMIT_USD = 5;
export const GLOBAL_COST_ALERT_RATIO = 0.8;

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
