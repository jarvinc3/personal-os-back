import {
  DEFAULT_MODEL_PRICE_USD_PER_MILLION_TOKENS,
  MODEL_PRICES_USD_PER_MILLION_TOKENS,
} from '../../inference/inference-pricing';

/** Ritmo y cupo propios de sugerencias, separados del piloto de correo de #402. */
export const VIEW_SUGGESTIONS_PER_MINUTE = 20;
export const MAX_VIEW_SUGGESTIONS = 3;
/** Techo de claves descartadas que se consultan por vista; el índice único las cubre. */
export const MAX_TRACKED_DISMISSAL_KEYS = 1_000;
export const MAX_SUGGESTION_LABEL_CHARS = 80;
export const MAX_SUGGESTION_PROMPT_CHARS = 500;

/** Cotas del prompt para reservar el costo máximo antes de llamar al modelo. */
const MAX_ROUTE_CHARS = 300;
const MAX_VIEW_CHARS = 100;
const MAX_PROMPT_OVERHEAD_CHARS = 8_000;
const MAX_PROVIDER_ATTEMPTS = 4;
const MAX_OUTPUT_TOKENS_PER_ATTEMPT = 4_096;
const MAX_BYTES_PER_CHAR = 4;

/** Las acciones propuestas viajan como JSON; si no caben, el prompt va sin ellas. */
export const MAX_ACTIONS_PROMPT_CHARS = 4_000;

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
 * Reserva conservadora por generación: entrada en el peor caso UTF-8, los
 * cuatro intentos del gateway y la salida que limitan los proveedores, al
 * precio más alto de la tabla. Al terminar se ajusta al costo real medido.
 */
export const MAX_VIEW_SUGGESTION_COST_USD =
  Math.ceil(
    (MAX_PROVIDER_ATTEMPTS *
      ((MAX_ROUTE_CHARS + MAX_VIEW_CHARS + MAX_PROMPT_OVERHEAD_CHARS) *
        MAX_BYTES_PER_CHAR *
        TOP_INPUT_PRICE_USD_PER_MILLION_TOKENS +
        MAX_OUTPUT_TOKENS_PER_ATTEMPT *
          TOP_OUTPUT_PRICE_USD_PER_MILLION_TOKENS)) /
      1_000_000 /
      0.01,
  ) * 0.01;
