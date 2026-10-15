import type {
  ChatBlock,
  ChatChartPoint,
  ChatNextInstallment,
  ChatTransactionSnapshot,
  ToolExecutionResult,
} from './ai.types';

export type ChatToolResult = {
  toolName: string;
  result: ToolExecutionResult;
};

export type BuildChatBlocksInput = {
  toolResults: ChatToolResult[];
  userText: string;
  baseCurrency: string;
};

const TRANSACTION_LIST_LIMIT = 5;
const BUDGET_BLOCK_LIMIT = 3;
const CHART_SERIES_LIMIT = 6;
const TRANSACTIONS_HREF = '/finance/transactions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toTransactionSnapshot(raw: unknown): ChatTransactionSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const type = asString(raw.type);
  const amount = asString(raw.amount);
  const currency = asString(raw.currency);
  const transactionDate = asString(raw.transactionDate);
  const status = asString(raw.status);
  if (!id || !type || !amount || !currency || !transactionDate || !status) {
    return null;
  }
  return {
    id,
    type,
    amount,
    currency,
    transactionDate,
    merchant: asNullableString(raw.merchant),
    description: asNullableString(raw.description),
    accountName: asNullableString(raw.accountName),
    cardName: asNullableString(raw.cardName),
    status,
  };
}

function transactionCardBlocks(payload: unknown): ChatBlock[] {
  const snapshot = toTransactionSnapshot(payload);
  if (!snapshot) {
    return [];
  }
  return [{ type: 'transaction_card', transactionId: snapshot.id, snapshot }];
}

function transactionListBlocks(payload: unknown): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const items = asArray(payload.items)
    .map(toTransactionSnapshot)
    .filter(isPresent)
    .slice(0, TRANSACTION_LIST_LIMIT);
  if (items.length === 0) {
    return [];
  }
  return [{ type: 'transaction_list', items, moreHref: TRANSACTIONS_HREF }];
}

type BudgetView = {
  id: string;
  name: string | null;
  color: string | null;
  icon: string | null;
  spent: string;
  limit: string;
  pctUsed: number;
};

function toBudgetView(raw: unknown): BudgetView | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  const spent = asString(raw.amountSpent);
  const limit = asString(raw.amountLimit);
  if (!id || !spent || !limit) {
    return null;
  }
  const limitNumber = Number(limit);
  const spentNumber = Number(spent);
  const pctUsed =
    asNumber(raw.pctUsed) ??
    (limitNumber > 0 ? (spentNumber / limitNumber) * 100 : 0);
  return {
    id,
    name: asNullableString(raw.category) ?? asNullableString(raw.name),
    color: asNullableString(raw.color),
    icon: asNullableString(raw.icon),
    spent,
    limit,
    pctUsed,
  };
}

function selectBudgets(budgets: BudgetView[], userText: string): BudgetView[] {
  const normalizedText = normalizeText(userText);
  const matching = budgets.filter(
    (budget) =>
      budget.name !== null &&
      normalizedText.includes(normalizeText(budget.name)),
  );
  const pool =
    matching.length > 0
      ? matching
      : [...budgets].sort((a, b) => b.pctUsed - a.pctUsed);
  return pool.slice(0, BUDGET_BLOCK_LIMIT);
}

function budgetProgressBlocks(
  payload: unknown,
  userText: string,
  baseCurrency: string,
): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const budgets = asArray(payload.items).map(toBudgetView).filter(isPresent);
  return selectBudgets(budgets, userText).map((budget) => ({
    type: 'budget_progress' as const,
    budgetId: budget.id,
    spent: budget.spent,
    limit: budget.limit,
    currency: baseCurrency,
    ...(budget.name !== null ? { name: budget.name } : {}),
    pctUsed: budget.pctUsed,
    color: budget.color,
    icon: budget.icon,
  }));
}

function toNextInstallment(
  raw: Record<string, unknown>,
  currency: string,
): ChatNextInstallment | undefined {
  const amount = asString(raw.installmentAmount);
  const dueDate = asString(raw.nextDueDate);
  const paidInstallments = asNumber(raw.paidInstallments);
  if (!amount || !dueDate || paidInstallments === null) {
    return undefined;
  }
  return {
    amount,
    currency,
    dueDate,
    installmentNo: paidInstallments + 1,
  };
}

function loanSummaryBlocks(payload: unknown): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const blocks: ChatBlock[] = [];
  for (const raw of asArray(payload.items)) {
    if (!isRecord(raw)) {
      continue;
    }
    const loanId = asString(raw.id);
    const balance = asString(raw.currentBalance);
    const currency = asString(raw.currency);
    if (!loanId || !balance || !currency) {
      continue;
    }
    const name = asNullableString(raw.lenderName);
    const nextInstallment = toNextInstallment(raw, currency);
    blocks.push({
      type: 'loan_summary',
      loanId,
      balance,
      currency,
      ...(name !== null ? { name } : {}),
      ...(nextInstallment ? { nextInstallment } : {}),
    });
  }
  return blocks;
}

function toChartPoint(raw: unknown): ChatChartPoint | null {
  if (!isRecord(raw)) {
    return null;
  }
  const label = asNullableString(raw.name) ?? asString(raw.date);
  const value = asString(raw.total);
  if (!label || !value) {
    return null;
  }
  return { label, value, color: asNullableString(raw.color) };
}

function spendingCategoryBlocks(
  payload: unknown,
  baseCurrency: string,
): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const series = asArray(payload.items)
    .map(toChartPoint)
    .filter(isPresent)
    .filter((point) => Number(point.value) > 0)
    .slice(0, CHART_SERIES_LIMIT);
  if (series.length === 0) {
    return [];
  }
  return [
    {
      type: 'chart',
      kind: 'donut',
      series,
      title: 'Gasto por categoría',
      currency: baseCurrency,
    },
  ];
}

function spendingOverTimeBlocks(
  payload: unknown,
  baseCurrency: string,
): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const series = asArray(payload.points)
    .map((raw) => {
      if (!isRecord(raw)) {
        return null;
      }
      const label = asString(raw.date);
      const value = asString(raw.expenses);
      return label && value ? { label, value } : null;
    })
    .filter(isPresent);
  if (series.length === 0) {
    return [];
  }
  return [
    {
      type: 'chart',
      kind: 'line',
      series,
      title: 'Gasto en el tiempo',
      currency: baseCurrency,
    },
  ];
}

function blocksForTool({
  toolName,
  payload,
  userText,
  baseCurrency,
}: {
  toolName: string;
  payload: unknown;
  userText: string;
  baseCurrency: string;
}): ChatBlock[] {
  switch (toolName) {
    case 'get_transaction':
      return transactionCardBlocks(payload);
    case 'list_transactions':
      return transactionListBlocks(payload);
    case 'get_budget_status':
      return budgetProgressBlocks(payload, userText, baseCurrency);
    case 'list_loans':
      return loanSummaryBlocks(payload);
    case 'get_spending_by_category':
      return spendingCategoryBlocks(payload, baseCurrency);
    case 'get_spending_over_time':
      return spendingOverTimeBlocks(payload, baseCurrency);
    default:
      return [];
  }
}

/** Turns read-tool payloads into native finance blocks. The LLM never shapes them. */
export function buildChatBlocks({
  toolResults,
  userText,
  baseCurrency,
}: BuildChatBlocksInput): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const seen = new Set<string>();

  for (const { toolName, result } of toolResults) {
    if (!result.success) {
      continue;
    }
    const toolBlocks = blocksForTool({
      toolName,
      payload: result.data,
      userText,
      baseCurrency,
    });
    for (const block of toolBlocks) {
      const key = JSON.stringify(block);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blocks.push(block);
    }
  }

  return blocks;
}
