import {
  isRelevantSignal,
  consumptionReviewReason,
  proactiveWindowStart,
} from './proactive-relevance';

const routedReview = {
  type: 'FINANCE.TRANSACTION_DETECTED',
  status: 'ROUTED',
  payload: {
    consumption: { outcome: 'REVIEW_REQUIRED', reason: 'NO_LEDGER_TARGET' },
  },
};

describe('proactive relevance', () => {
  it('marca relevante una señal enrutada que quedó en revisión', () => {
    expect(isRelevantSignal(routedReview)).toBe(true);
    expect(consumptionReviewReason(routedReview.payload)).toBe(
      'NO_LEDGER_TARGET',
    );
  });

  it('descarta una señal sin consumo en revisión', () => {
    expect(
      isRelevantSignal({
        ...routedReview,
        payload: { consumption: { outcome: 'APPLIED' } },
      }),
    ).toBe(false);
    expect(isRelevantSignal({ ...routedReview, payload: {} })).toBe(false);
  });

  it('descarta una señal que ya no está enrutada', () => {
    expect(isRelevantSignal({ ...routedReview, status: 'CONSUMED' })).toBe(
      false,
    );
    expect(isRelevantSignal({ ...routedReview, status: 'FAILED' })).toBe(false);
  });

  it('descarta un tipo de señal fuera de la lista', () => {
    expect(
      isRelevantSignal({ ...routedReview, type: 'FINANCE.UNKNOWN_EVENT' }),
    ).toBe(false);
  });

  it('tolera payloads que no son objetos', () => {
    expect(isRelevantSignal({ ...routedReview, payload: null })).toBe(false);
    expect(isRelevantSignal({ ...routedReview, payload: ['x'] })).toBe(false);
    expect(isRelevantSignal({ ...routedReview, payload: 'text' })).toBe(false);
  });

  it('alinea la ventana de ritmo al minuto', () => {
    expect(
      proactiveWindowStart(new Date('2026-11-19T18:03:27.456Z')).toISOString(),
    ).toBe('2026-11-19T18:03:00.000Z');
  });
});
