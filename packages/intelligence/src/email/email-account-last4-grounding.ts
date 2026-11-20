import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';

const MASKED_ACCOUNT_PATTERN = /\*+[\s._-]*(\d{4})(?!\d)/g;
const EXCLUDED_CONTEXT_PATTERN =
  /\b(?:beneficiari[oa]s?|ordenantes?|tarjetas?|cards?|c[eé]dulas?|identificaci[oó]n|documentos?|tel[eé]fonos?|referencias?|confirmaci[oó]n)\b/i;
const CONTEXT_BEFORE_CHARS = 120;

/**
 * Lee el último 4 de una cuenta enmascarada (`****1234`, `******_0024`,
 * `*2581`). Descarta tarjeta, cédula, teléfono, referencia y contraparte. Si
 * hay más de una cuenta distinta, no elige: devuelve null.
 */
export function extractMaskedAccountLast4(text: string): string | null {
  const candidates = readMaskedAccountLast4Candidates(text);
  if (new Set(candidates).size !== 1) {
    return null;
  }
  return candidates[0] ?? null;
}

function readMaskedAccountLast4Candidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(MASKED_ACCOUNT_PATTERN)) {
    const last4 = match[1];
    if (!last4) {
      continue;
    }
    const index = match.index ?? 0;
    const context = text.slice(
      Math.max(0, index - CONTEXT_BEFORE_CHARS),
      index,
    );
    if (EXCLUDED_CONTEXT_PATTERN.test(context)) {
      continue;
    }
    candidates.push(last4);
  }
  return candidates;
}

/**
 * Aplica el último 4 que declara el texto sobre una clasificación del modelo.
 * Sin una máscara única de cuenta conserva el valor que trajo el modelo.
 */
export function groundAccountLast4FromText({
  classification,
  subject,
  body,
}: {
  classification: EmailClassification;
  subject: string;
  body: string;
}): EmailClassification {
  if (!classification.transaction) {
    return classification;
  }
  const last4 = extractMaskedAccountLast4(`${subject}\n${body}`);
  if (!last4 || classification.transaction.accountNumberLast4 === last4) {
    return classification;
  }
  return validateEmailClassification({
    ...classification,
    transaction: {
      ...classification.transaction,
      accountNumberLast4: last4,
    },
  });
}
