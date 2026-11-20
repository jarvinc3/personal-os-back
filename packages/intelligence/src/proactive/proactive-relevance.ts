/**
 * Reglas deterministas de relevancia: solo las señales de un tipo conocido que
 * el consumidor de su dominio dejó en revisión merecen razonamiento. El resto
 * se descarta sin llamar al modelo ni notificar.
 */
export const RELEVANT_SIGNAL_TYPES = ['FINANCE.TRANSACTION_DETECTED'] as const;

/** Ventana del ritmo: la misma que usan los topes de sugerencias por vista. */
export const PROACTIVE_RHYTHM_WINDOW_MS = 60_000;

const SIGNAL_STATUS_ROUTED = 'ROUTED';
const CONSUMPTION_REVIEW_REQUIRED = 'REVIEW_REQUIRED';

export type ProactiveSignalSnapshot = {
  type: string;
  status: string;
  payload: unknown;
};

export function isRelevantSignal(signal: ProactiveSignalSnapshot): boolean {
  if (signal.status !== SIGNAL_STATUS_ROUTED) {
    return false;
  }
  if (!(RELEVANT_SIGNAL_TYPES as readonly string[]).includes(signal.type)) {
    return false;
  }
  return consumptionReviewReason(signal.payload) !== null;
}

/** Motivo de revisión que dejó el consumidor, sin datos del correo. */
export function consumptionReviewReason(payload: unknown): string | null {
  const consumption = readObject(payload, 'consumption');
  if (!consumption) {
    return null;
  }
  if (consumption.outcome !== CONSUMPTION_REVIEW_REQUIRED) {
    return null;
  }
  return typeof consumption.reason === 'string' ? consumption.reason : null;
}

/** Inicio de la ventana de ritmo vigente, alineada al minuto. */
export function proactiveWindowStart(now: Date): Date {
  return new Date(
    Math.floor(now.getTime() / PROACTIVE_RHYTHM_WINDOW_MS) *
      PROACTIVE_RHYTHM_WINDOW_MS,
  );
}

function readObject(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return null;
  }
  return nested as Record<string, unknown>;
}
