/**
 * Precio por millón de tokens de los modelos que usa el gateway. Groq y
 * OpenRouter publican la tabla por modelo; estos valores son la referencia
 * conservadora para el piloto y quedan pendientes de medir en DEV. Si un
 * modelo no está en la tabla, no se estima costo (null) en vez de inventarlo.
 */
export const MODEL_PRICES_USD_PER_MILLION_TOKENS: Record<
  string,
  { input: number; output: number }
> = {
  // Groq: modelo Qwen de la familia 27B.
  'qwen/qwen3.8-27b': { input: 0.2, output: 0.6 },
  // OpenRouter: DeepSeek Flash.
  'deepseek/deepseek-v4-flash': { input: 0.14, output: 0.28 },
};

export function inferenceCostUsd({
  model,
  inputTokens,
  outputTokens,
}: {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): number | null {
  const price = MODEL_PRICES_USD_PER_MILLION_TOKENS[model];
  if (!price) {
    return null;
  }
  const input = Math.max(0, inputTokens ?? 0);
  const output = Math.max(0, outputTokens ?? 0);
  return (
    (input / 1_000_000) * price.input + (output / 1_000_000) * price.output
  );
}
