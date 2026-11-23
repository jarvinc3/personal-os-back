import type { $Enums } from '@personal-os/database';
import type { StatementImportParsed } from '../domain/statement-import-view';
import type { StatementImportContext } from '../infrastructure/statement-imports.repository';

export type StatementImportTargetView = {
  kind: 'CARD' | 'ACCOUNT';
  id: string;
  name: string;
  currency: string;
};

export type StatementImportLineView = {
  id: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
  type: $Enums.FinStatementLineType;
  reference: string | null;
  decision: $Enums.FinStatementLineDecision;
  categoryId: string | null;
  categoryName: string | null;
  transactionId: string | null;
};

export type StatementImportMoneyHeader = {
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  previousBalance: string | null;
  closingBalance: string | null;
  minimumPayment: string | null;
};

export type StatementImportView = {
  id: string;
  status: $Enums.FinStatementImportStatus;
  error: string | null;
  failureReason: string | null;
  target: StatementImportTargetView;
  header: StatementImportMoneyHeader;
  period: { from: string; to: string } | null;
  counts: StatementImportParsed['counts'];
  lines: StatementImportLineView[];
  extra: Array<
    Omit<StatementImportParsed['extra'][number], 'amount'> & {
      amount: string;
    }
  >;
  difference: string | null;
  adjustment: { amount: string; currency: string } | null;
  createdAt: string;
  appliedAt: string | null;
};

function money(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function targetView(
  context: StatementImportContext,
  parsed: StatementImportParsed,
): StatementImportTargetView {
  if (context.card) {
    return {
      kind: 'CARD',
      id: context.card.id,
      name: context.card.name,
      currency: context.card.balances[0]?.currency ?? parsed.header.currency,
    };
  }
  return {
    kind: 'ACCOUNT',
    id: context.account?.id ?? '',
    name: context.account?.name ?? '',
    currency: context.account?.currency ?? parsed.header.currency,
  };
}

function lineView(
  line: StatementImportContext['lines'][number],
  categoryNames: Map<string, string>,
): StatementImportLineView {
  return {
    id: line.id,
    date: line.date.toISOString().slice(0, 10),
    description: line.description,
    amount: line.amount.toFixed(2),
    currency: line.currency,
    type: line.type,
    reference: line.reference,
    decision: line.decision,
    categoryId: line.categoryId,
    categoryName: line.categoryId
      ? (categoryNames.get(line.categoryId) ?? null)
      : null,
    transactionId: line.transactionId,
  };
}

function adjustmentView(
  difference: number | null,
  currency: string,
): { amount: string; currency: string } | null {
  if (difference === null || Math.abs(difference) < 0.005) {
    return null;
  }
  return { amount: difference.toFixed(2), currency };
}

export function mapStatementImport({
  context,
  parsed,
  difference,
  categories,
}: {
  context: StatementImportContext;
  parsed: StatementImportParsed;
  difference: number | null;
  categories: readonly { id: string; name: string }[];
}): StatementImportView {
  const target = targetView(context, parsed);
  const categoryNames = new Map(
    categories.map((category) => [category.id, category.name]),
  );

  return {
    id: context.id,
    status: context.status,
    error: context.error,
    failureReason: parsed.failureReason ?? null,
    target,
    header: {
      currency: parsed.header.currency,
      periodStart: parsed.header.periodStart,
      periodEnd: parsed.header.periodEnd,
      dueDate: parsed.header.dueDate,
      previousBalance: money(parsed.header.previousBalance),
      closingBalance: money(parsed.header.closingBalance),
      minimumPayment: money(parsed.header.minimumPayment),
    },
    period: parsed.period,
    counts: parsed.counts,
    lines: context.lines.map((line) => lineView(line, categoryNames)),
    extra: parsed.extra.map((movement) => ({
      ...movement,
      amount: movement.amount.toFixed(2),
    })),
    difference: money(difference),
    adjustment: adjustmentView(difference, parsed.header.currency),
    createdAt: context.createdAt.toISOString(),
    appliedAt: context.appliedAt?.toISOString() ?? null,
  };
}
