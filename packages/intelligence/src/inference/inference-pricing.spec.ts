import {
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS,
  inferenceCostUsd,
} from './inference-pricing';

describe('inferenceCostUsd', () => {
  it('usa la tarifa del modelo cuando está en la tabla', () => {
    expect(
      inferenceCostUsd({
        model: 'deepseek/deepseek-v4-flash',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(0.14 + 0.28, 6);
  });

  it('cobra el precio conservador por defecto a un modelo sin tarifa', () => {
    const cost = inferenceCostUsd({
      model: 'modelo-sin-tarifa',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(cost).toBeCloseTo(
      DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS.input +
        DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS.output,
      6,
    );
    expect(cost).toBeGreaterThan(0);
  });

  it('no inventa consumo cuando el proveedor no devuelve tokens', () => {
    expect(inferenceCostUsd({ model: 'modelo-sin-tarifa' })).toBe(0);
  });
});
