import {
  validateEmailClassification,
  type EmailClassification,
} from './email-classification.util';

const BHD_DOMAIN = 'bhd.com.do';
/** República Dominicana no cambia de horario: la hora del banco es UTC-4. */
const BHD_UTC_OFFSET_HOURS = 4;
const BHD_MAX_TRANSACTION_AGE_MS = 31 * 24 * 60 * 60 * 1_000;
const BHD_MAX_FUTURE_MS = 24 * 60 * 60 * 1_000;
const CURRENCY_CONTEXT_CHARS = 40;

const AM_PM_PATTERN = String.raw`(a\.?\s*m\.?|p\.?\s*m\.?)`;
const DATE_TIME_PATTERN = String.raw`(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:[-|]|a\s+las)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*${AM_PM_PATTERN}`;
const CONTEXTUAL_DATE_PATTERN = new RegExp(
  String.raw`fecha(?:\s+y\s+hora)?(?:\s+de\s+la\s+transacci[oó]n)?\s*:?\s*${DATE_TIME_PATTERN}`,
  'gi',
);
const ANY_DATE_PATTERN = new RegExp(DATE_TIME_PATTERN, 'gi');

type BhdDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type BhdCurrency = {
  code: 'DOP' | 'USD';
  marker: string;
};

type BhdReversal = {
  status: 'REVERSED' | 'REFUNDED' | 'CHARGEBACK';
};

const CURRENCY_MARKERS = [
  { code: 'DOP', marker: 'RD$', pattern: /\bRD\s*\$/gi },
  { code: 'DOP', marker: 'DOP', pattern: /\bDOP\b/gi },
  { code: 'DOP', marker: 'RD', pattern: /\bRD\b/gi },
  { code: 'USD', marker: 'US$', pattern: /\bUS\s*\$/gi },
  { code: 'USD', marker: 'USD', pattern: /\bUSD\b/gi },
  { code: 'USD', marker: 'US', pattern: /\bUS\b/gi },
] as const;

const REVERSAL_PATTERNS = [
  {
    status: 'CHARGEBACK',
    pattern: /\b(?:chargebacks?|contracargos?)\b/i,
  },
  {
    status: 'REFUNDED',
    pattern: /\b(?:refunds?|reembolsos?|devoluci[oó]n(?:es)?)\b/i,
  },
  {
    status: 'REVERSED',
    pattern: /\b(?:reversos?|reversi[oó]n(?:es)?|reversad[oa]s?)\b/i,
  },
] as const satisfies readonly {
  status: BhdReversal['status'];
  pattern: RegExp;
}[];

const NOT_APPLIED_PATTERN =
  /\b(?:no\s+(?:pudo|se\s+pudo|fue\s+posible)|no\s+aplicad[oa]s?|rechazad[oa]s?|fondos\s+insuficientes|balance\s+de\s+la\s+cuenta\s+no\s+es\s+suficiente|declinad[oa]s?)\b/i;

export function isBhdEmail(fromDomain: string | null | undefined): boolean {
  if (!fromDomain) {
    return false;
  }
  const normalized = fromDomain.trim().toLowerCase();
  return normalized === BHD_DOMAIN || normalized.endsWith(`.${BHD_DOMAIN}`);
}

/**
 * Reemplaza los datos que el modelo no puede garantizar por los que el texto
 * BHD declara. No completa datos ausentes: si la fecha no se puede verificar,
 * la deja sin `transactionDate` para que el flujo la mande a revisión.
 */
export function groundBhdClassification({
  classification,
  fromDomain,
  subject,
  body,
  receivedAt,
}: {
  classification: EmailClassification;
  fromDomain: string | null | undefined;
  subject: string;
  body: string;
  receivedAt: Date;
}): EmailClassification {
  if (!isBhdEmail(fromDomain) || !classification.transaction) {
    return classification;
  }
  const text = `${subject}\n${body}`;
  const transaction = groundBhdTransaction({
    transaction: classification.transaction,
    transactionDate: extractBhdTransactionDate(text, receivedAt),
    currency: extractBhdCurrency(text, classification.transaction.amount),
    reversal: detectBhdReversal(text),
  });

  return validateEmailClassification({ ...classification, transaction });
}

type BhdTransaction = NonNullable<EmailClassification['transaction']>;

function groundBhdTransaction({
  transaction,
  transactionDate,
  currency,
  reversal,
}: {
  transaction: BhdTransaction;
  transactionDate: Date | null;
  currency: BhdCurrency | null;
  reversal: BhdReversal | null;
}): BhdTransaction {
  let grounded = transactionDate
    ? { ...transaction, transactionDate: transactionDate.toISOString() }
    : withoutField(transaction, 'transactionDate');
  grounded = currency
    ? withBhdCurrency({ transaction: grounded, currency })
    : withoutField(grounded, 'currency');
  if (reversal) {
    grounded = {
      ...grounded,
      kind: 'TRANSACTION',
      movementClass: 'REFUND',
      direction: 'CREDIT',
      bankStatusNormalized: reversal.status,
    };
  }
  return grounded;
}

function withBhdCurrency({
  transaction,
  currency,
}: {
  transaction: BhdTransaction;
  currency: BhdCurrency;
}): BhdTransaction {
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

function extractBhdTransactionDate(
  text: string,
  receivedAt: Date,
): Date | null {
  const normalized = text.replace(/\u00a0/g, ' ');
  const contextual = [...normalized.matchAll(CONTEXTUAL_DATE_PATTERN)];
  const matches = contextual.length
    ? contextual
    : [...normalized.matchAll(ANY_DATE_PATTERN)];
  if (matches.length !== 1) {
    return null;
  }
  const parts = bhdDateParts(matches[0]);
  if (!parts) {
    return null;
  }
  return bhdLocalDateToUtc(parts, receivedAt);
}

function bhdDateParts(match: RegExpMatchArray): BhdDateParts | null {
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour12 = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour12) ||
    !Number.isInteger(minute) ||
    !Number.isInteger(second) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12 ||
    year < 2000 ||
    year > 2100 ||
    hour12 < 1 ||
    hour12 > 12 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  if (!isValidCalendarDate({ year, month, day })) {
    return null;
  }
  const meridiem = (match[7] ?? '').replace(/[.\s]/g, '').toLowerCase();
  if (meridiem !== 'am' && meridiem !== 'pm') {
    return null;
  }
  const hour = (hour12 % 12) + (meridiem === 'pm' ? 12 : 0);
  return { year, month, day, hour, minute, second };
}

function isValidCalendarDate({
  year,
  month,
  day,
}: {
  year: number;
  month: number;
  day: number;
}): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function bhdLocalDateToUtc(parts: BhdDateParts, receivedAt: Date): Date | null {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const utc = new Date(localAsUtc + BHD_UTC_OFFSET_HOURS * 60 * 60 * 1_000);
  const distance = utc.getTime() - receivedAt.getTime();
  if (distance > BHD_MAX_FUTURE_MS || distance < -BHD_MAX_TRANSACTION_AGE_MS) {
    return null;
  }
  return utc;
}

function extractBhdCurrency(
  text: string,
  amount: number | undefined,
): BhdCurrency | null {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
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
  if (marker !== 'RD' && marker !== 'US') {
    return true;
  }
  return (
    amountIndex !== null &&
    Math.abs(index - amountIndex) <= CURRENCY_CONTEXT_CHARS
  );
}

function detectBhdReversal(text: string): BhdReversal | null {
  if (NOT_APPLIED_PATTERN.test(text)) {
    return null;
  }
  return REVERSAL_PATTERNS.find(({ pattern }) => pattern.test(text)) ?? null;
}
