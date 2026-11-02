export type HoldoutPrediction = {
  messageId: string;
  route: string;
  relevance: boolean;
  semanticType: string;
  decisionPath: string;
};

export type HoldoutTruth = {
  messageId: string;
  payload: unknown;
};

/** Metrics are calculated per message, so multiple routed products do not inflate counts. */
export function calculateHoldoutMetrics(
  predictions: HoldoutPrediction[],
  truths: HoldoutTruth[],
) {
  const predicted = new Map<string, HoldoutPrediction[]>();
  for (const item of predictions) {
    const list = predicted.get(item.messageId) ?? [];
    list.push(item);
    predicted.set(item.messageId, list);
  }
  const truthByMessage = new Map(
    truths.map((item) => [item.messageId, labels(item.payload)]),
  );
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let deterministic = 0;
  let modelFallback = 0;
  let unknown = 0;

  for (const [messageId, truth] of truthByMessage) {
    const rows = predicted.get(messageId) ?? [];
    const isPredictionUnknown = rows.length === 0;
    if (isPredictionUnknown) {
      unknown++;
    }
    if (rows.some((row) => row.decisionPath === 'DETERMINISTIC')) {
      deterministic++;
    }
    if (rows.some((row) => row.decisionPath === 'MODEL')) {
      modelFallback++;
    }

    const predictedPositive = rows.some(
      (row) => row.relevance && row.semanticType === 'FIN_TRANSACTION',
    );
    const actualPositive = truth.semanticType === 'FIN_TRANSACTION';
    if (predictedPositive && actualPositive) {
      truePositive++;
    } else if (predictedPositive) {
      falsePositive++;
    } else if (actualPositive) {
      falseNegative++;
    }
  }

  const evaluated = truthByMessage.size;
  const positiveTruth = truePositive + falseNegative;
  const predictedPositive = truePositive + falsePositive;
  return {
    holdoutMessages: evaluated,
    truePositive,
    falsePositive,
    falseNegative,
    transactionRecall: ratio(truePositive, positiveTruth),
    precision: ratio(truePositive, predictedPositive),
    deterministicCoverage: ratio(deterministic, evaluated),
    modelFallbackRate: ratio(modelFallback, evaluated),
    unknownRate: ratio(unknown, evaluated),
  };
}

function labels(payload: unknown): { semanticType?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const semanticType = (payload as Record<string, unknown>).semanticType;
  return typeof semanticType === 'string' ? { semanticType } : {};
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}
