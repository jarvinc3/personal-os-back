import type { StatementLineType } from '../../domain/statement-line-matching';

export type StatementCategoryOption = {
  name: string;
  type: 'EXPENSE' | 'INCOME' | (string & {});
};

export type ExtractedStatementLine = {
  date: string;
  description: string;
  amount: number;
  currency: string;
  type: StatementLineType;
  reference: string | null;
  categoryNameHint: string | null;
};

export type ExtractedStatementHeader = {
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  previousBalance: number | null;
  closingBalance: number | null;
  minimumPayment: number | null;
  dueDate: string | null;
};

export type ExtractedStatement = {
  header: ExtractedStatementHeader;
  lines: ExtractedStatementLine[];
};

export type StatementExtractionResult =
  | {
      ok: true;
      statement: ExtractedStatement;
      provider: string;
      model: string;
    }
  | { ok: false; reason: string; retryable: boolean };

export type StatementExtractionInput = {
  text: string;
  categories?: StatementCategoryOption[];
  /** Header the upload already knows (target currency, card due day). */
  knownCurrency?: string;
};

export interface StatementExtractorPort {
  extract(input: StatementExtractionInput): Promise<StatementExtractionResult>;
}

export const STATEMENT_EXTRACTOR = Symbol('STATEMENT_EXTRACTOR');
