/**
 * Anclaje de la moneda de una clasificación. El texto del correo decide; el
 * modelo solo propone. Se aplica a cualquier remitente con transacción, después
 * del anclaje específico del banco.
 */
import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';

const CURRENCY_CONTEXT_CHARS = 40;

export type CurrencyMatch = {
  code: 'DOP' | 'USD';
  marker: string;
};

const CURRENCY_MARKERS = [
  { code: 'DOP', marker: 'RD$', pattern: /\bRD\s*\$/gi },
  { code: 'DOP', marker: 'DOP', pattern: /\bDOP\b/gi },
  { code: 'DOP', marker: 'RD', pattern: /\bRD\b/gi },
  { code: 'USD', marker: 'US$', pattern: /\bUS\s*\$/gi },
  { code: 'USD', marker: 'USD', pattern: /\bUSD\b/gi },
  { code: 'USD', marker: 'US', pattern: /\bUS\b/gi },
] as const;

/**
 * Reemplaza la moneda del modelo por la que declara el texto. Si no hay un
 * marcador usable, quita la moneda para que la importación vaya a revisión.
 */
export function groundClassificationCurrency({
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

  const currency = extractCurrencyFromText(
    `${subject}\n${body}`,
    classification.transaction.amount,
  );
  const transaction = groundTransactionCurrency({
    transaction: classification.transaction,
    currency,
  });

  return validateEmailClassification({ ...classification, transaction });
}

export function extractCurrencyFromText(
  text: string,
  amount: number | undefined,
): CurrencyMatch | null {
  const normalized = collapseWhitespace(text);
  const amountIndex = findAmountIndex(normalized, amount);
  const candidates = CURRENCY_MARKERS.flatMap(({ code, marker, pattern }) =>
    [...normalized.matchAll(pattern)]
      .map((match) => ({
        code,
        marker,
        index: match.index ?? 0,
      }))
      .filter(({ index }) =>
        isUsableCurrencyMarker({ marker, index, amountIndex }),
      ),
  );

  if (!candidates.length) {
    return null;
  }

  if (amountIndex === null) {
    const codes = new Set(candidates.map(({ code }) => code));
    return codes.size === 1
      ? { code: candidates[0].code, marker: candidates[0].marker }
      : null;
  }

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.index - amountIndex),
    }))
    .sort((left, right) => left.distance - right.distance);
  const best = ranked[0];

  if (
    ranked.some(
      ({ code, distance }) => code !== best.code && distance === best.distance,
    )
  ) {
    return null;
  }

  return { code: best.code, marker: best.marker };
}

type GroundedTransaction = NonNullable<EmailClassification['transaction']>;

function groundTransactionCurrency({
  transaction,
  currency,
}: {
  transaction: GroundedTransaction;
  currency: CurrencyMatch | null;
}): GroundedTransaction {
  if (!currency) {
    return withoutField(
      withoutField(transaction, 'currency'),
      'currencyEvidence',
    );
  }

  const modelCurrency = transaction.currency;

  return {
    ...transaction,
    currency: currency.code,
    ...(modelCurrency && modelCurrency !== currency.code
      ? {
          currencyEvidence: `El texto indica ${currency.code} (${currency.marker}); el modelo propuso ${modelCurrency}.`,
        }
      : {}),
  };
}

function withoutField<T extends object>(value: T, field: keyof T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== field),
  ) as T;
}

function findAmountIndex(
  text: string,
  amount: number | undefined,
): number | null {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  for (const variant of amountVariants(amount)) {
    const index = text.indexOf(variant);

    if (index >= 0) {
      return index;
    }
  }

  return null;
}

function amountVariants(amount: number): string[] {
  const fixed = amount.toFixed(2);
  const [whole, decimals] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return [fixed, `${grouped}.${decimals}`, whole, grouped];
}

function isUsableCurrencyMarker({
  marker,
  index,
  amountIndex,
}: {
  marker: string;
  index: number;
  amountIndex: number | null;
}): boolean {
  const isShortMarker = marker === 'RD' || marker === 'US';

  if (amountIndex === null) {
    return !isShortMarker;
  }

  return Math.abs(index - amountIndex) <= CURRENCY_CONTEXT_CHARS;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}
