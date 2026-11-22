import { z } from 'zod';
import { parseStrictEnvBoolean } from './parse-env-boolean';

export const optionalApiKey = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.startsWith('YOUR_')) {
      return undefined;
    }
    return trimmed;
  });

/** Positive integer env value; a blank string falls back to the default. */
export const defaultedPositiveInt = (defaultValue: number) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce.number().int().positive().default(defaultValue),
  );

function strictBooleanTransform(fieldName: string) {
  return (value: unknown, ctx: z.RefinementCtx) => {
    try {
      return parseStrictEnvBoolean(value, fieldName);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? error.message
            : 'Invalid boolean environment value',
      });
      return z.NEVER;
    }
  };
}

/** true/false/1/0 only — never treat the string "false" as true. */
export const optionalStrictBoolean = z
  .unknown()
  .optional()
  .transform(strictBooleanTransform('DATABASE_SSL_REJECT_UNAUTHORIZED'));

/** Strict boolean that falls back to `defaultValue` when unset. */
export const defaultedStrictBoolean = (
  fieldName: string,
  defaultValue: boolean,
) =>
  z
    .unknown()
    .optional()
    .transform(
      (value, ctx) =>
        strictBooleanTransform(fieldName)(value, ctx) ?? defaultValue,
    );

/**
 * Dominios bancarios que el piloto deja llegar al modelo. Son el valor por
 * defecto de `AI_EMAIL_BANK_SENDER_DOMAINS`; los subdominios se aceptan.
 *
 * Popular envía desde `popularenlinea.com` (no desde `popular.com.do`) y Qik
 * desde `mail.qik.com.do`, que cuelga de `qik.com.do`.
 */
export const DEFAULT_BANK_SENDER_DOMAINS = [
  'bhd.com.do',
  'popular.com.do',
  'popularenlinea.com',
  'qik.do',
  'qik.com.do',
  'banreservas.com',
  'scotiabank.com.do',
  'bancosantacruz.com.do',
  'bancolopezdeharo.com',
  'vimenca.com',
  'bancocaribe.com.do',
  'promerica.com.do',
  'bdi.com.do',
  'alaver.com.do',
].join(',');
