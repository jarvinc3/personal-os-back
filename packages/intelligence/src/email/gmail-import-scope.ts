/**
 * Alcance de la importación de Gmail elegido al conectar: desde qué fecha se
 * trae correo y, opcionalmente, de qué remitente. El período se resuelve a una
 * fecha UTC para que el bootstrap, el incremental y la recuperación compartan
 * el mismo corte.
 */
export const GMAIL_IMPORT_PERIODS = [
  'TODAY',
  'LAST_MONTH',
  'LAST_3_MONTHS',
] as const;

export type GmailImportPeriod = (typeof GMAIL_IMPORT_PERIODS)[number];

const MONTHS_BY_PERIOD: Record<Exclude<GmailImportPeriod, 'TODAY'>, number> = {
  LAST_MONTH: 1,
  LAST_3_MONTHS: 3,
};

/** Dominio del remitente, sin `@` ni espacios; admite subdominios. */
export const GMAIL_SENDER_FILTER_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function resolveImportStartAt({
  period,
  now,
}: {
  period: GmailImportPeriod;
  now: Date;
}): Date {
  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  if (period === 'TODAY') {
    return startOfToday;
  }
  return subtractUtcMonths({
    date: startOfToday,
    months: MONTHS_BY_PERIOD[period],
  });
}

export function normalizeSenderFilter(
  senderFilter: string | null | undefined,
): string | null {
  const normalized = senderFilter?.trim().toLowerCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function isSenderFilter(value: string): boolean {
  return GMAIL_SENDER_FILTER_PATTERN.test(value);
}

/** `bhd.com.do` cubre el dominio y sus subdominios, no dominios parecidos. */
export function matchesSenderFilter({
  fromDomain,
  senderFilter,
}: {
  fromDomain: string;
  senderFilter: string;
}): boolean {
  const domain = fromDomain.trim().toLowerCase();
  return domain === senderFilter || domain.endsWith(`.${senderFilter}`);
}

function subtractUtcMonths({
  date,
  months,
}: {
  date: Date;
  months: number;
}): Date {
  const firstOfTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth(),
      Math.min(date.getUTCDate(), lastDayOfTargetMonth),
    ),
  );
}
