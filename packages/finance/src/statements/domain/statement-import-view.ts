import type { StatementLineType } from './statement-line-matching';

export type StatementImportHeader = {
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  previousBalance: number | null;
  closingBalance: number | null;
  minimumPayment: number | null;
  dueDate: string | null;
};

export type StatementImportExtraMovement = {
  id: string;
  date: string;
  description: string | null;
  merchant: string | null;
  amount: number;
  currency: string;
  type: string;
};

export type StatementImportParsed = {
  header: StatementImportHeader;
  period: { from: string; to: string } | null;
  counts: { lines: number; matched: number; missing: number; extra: number };
  extra: StatementImportExtraMovement[];
  /** Present only when parsing failed; the human-readable cause. */
  failureReason?: string;
};

const EMPTY_PARSED: StatementImportParsed = {
  header: {
    currency: 'DOP',
    periodStart: null,
    periodEnd: null,
    previousBalance: null,
    closingBalance: null,
    minimumPayment: null,
    dueDate: null,
  },
  period: null,
  counts: { lines: 0, matched: 0, missing: 0, extra: 0 },
  extra: [],
};

/**
 * The column is untyped JSON. A freshly created import still holds `{}`, so
 * missing fields fall back to the empty shape; a value that is not an object
 * was never written by this code and is a real failure.
 */
export function readParsedStatement(parsed: unknown): StatementImportParsed {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Stored statement import payload is not a JSON object');
  }
  const candidate = parsed as Partial<StatementImportParsed>;
  return {
    header: { ...EMPTY_PARSED.header, ...candidate.header },
    period: candidate.period ?? null,
    counts: { ...EMPTY_PARSED.counts, ...candidate.counts },
    extra: Array.isArray(candidate.extra) ? candidate.extra : [],
    ...(candidate.failureReason === undefined
      ? {}
      : { failureReason: candidate.failureReason }),
  };
}

export function statementTypeMatchesCategory(
  lineType: StatementLineType,
  categoryType: string,
): boolean {
  return lineType === 'DEBIT'
    ? categoryType === 'EXPENSE'
    : categoryType === 'INCOME';
}
