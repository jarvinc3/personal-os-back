import { calculateHoldoutMetrics } from './holdout-metrics.util';

describe('calculateHoldoutMetrics', () => {
  it('counts per message, deduplicates routes and reports unknowns and decision paths', () => {
    expect(
      calculateHoldoutMetrics(
        [
          {
            messageId: 'm1',
            route: 'FINANCE',
            relevance: true,
            semanticType: 'FIN_TRANSACTION',
            decisionPath: 'DETERMINISTIC',
          },
          {
            messageId: 'm1',
            route: 'SHOPPING',
            relevance: true,
            semanticType: 'PURCHASE_RECEIPT',
            decisionPath: 'DETERMINISTIC',
          },
          {
            messageId: 'm2',
            route: 'FINANCE',
            relevance: true,
            semanticType: 'FIN_TRANSACTION',
            decisionPath: 'MODEL',
          },
        ],
        [
          { messageId: 'm1', payload: { semanticType: 'FIN_TRANSACTION' } },
          { messageId: 'm2', payload: { semanticType: 'MARKETING' } },
          { messageId: 'm3', payload: { semanticType: 'FIN_TRANSACTION' } },
        ],
      ),
    ).toEqual({
      holdoutMessages: 3,
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 1,
      transactionRecall: 0.5,
      precision: 0.5,
      deterministicCoverage: 1 / 3,
      modelFallbackRate: 1 / 3,
      unknownRate: 1 / 3,
    });
  });

  it('returns null for metrics with an empty denominator', () => {
    expect(calculateHoldoutMetrics([], [])).toEqual({
      holdoutMessages: 0,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      transactionRecall: null,
      precision: null,
      deterministicCoverage: null,
      modelFallbackRate: null,
      unknownRate: null,
    });
  });
});
