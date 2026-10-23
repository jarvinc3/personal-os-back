import type {
  ChatBlock,
  ChatChartPoint,
  ChatEntityRef,
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
const BUDGETS_HREF = '/finance/budgets';
const LOANS_HREF = '/finance/loans';

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

function toRef(
  type: ChatEntityRef['type'],
  raw: unknown,
): ChatEntityRef | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = asString(raw.id);
  return id ? { type, id } : null;
}

/**
 * The block keeps only the reference: the client asks for the current entity,
 * so the chat card never shows a stale copy.
 */
function entityCardBlocks(type: ChatEntityRef['type'], payload: unknown) {
  const ref = toRef(type, payload);
  if (!ref) {
    return [];
  }
  return [{ type: 'entity_card' as const, ref }];
}

function entityListBlock(
  refs: ChatEntityRef[],
  moreHref?: string,
): ChatBlock[] {
  if (refs.length === 0) {
    return [];
  }
  return [{ type: 'entity_list', refs, ...(moreHref ? { moreHref } : {}) }];
}

function transactionListBlocks(payload: unknown): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const refs = asArray(payload.items)
    .map((item) => toRef('transaction', item))
    .filter(isPresent)
    .slice(0, TRANSACTION_LIST_LIMIT);
  return entityListBlock(refs, TRANSACTIONS_HREF);
}

type BudgetCandidate = {
  ref: ChatEntityRef;
  name: string | null;
  pctUsed: number;
};

function toBudgetCandidate(raw: unknown): BudgetCandidate | null {
  if (!isRecord(raw)) {
    return null;
  }
  const ref = toRef('budget', raw);
  if (!ref) {
    return null;
  }
  const limit = asNumber(raw.amountLimit) ?? 0;
  const spent = asNumber(raw.amountSpent) ?? 0;
  return {
    ref,
    name: asNullableString(raw.category) ?? asNullableString(raw.name),
    pctUsed: asNumber(raw.pctUsed) ?? (limit > 0 ? (spent / limit) * 100 : 0),
  };
}

function selectBudgets(
  budgets: BudgetCandidate[],
  userText: string,
): BudgetCandidate[] {
  const normalizedText = normalizeText(userText);
  const matching = budgets.filter(
    (budget) =>
      budget.name !== null &&
      normalizedText.includes(normalizeText(budget.name)),
  );
  const pool =
    matching.length > 0
      ? matching
      : [...budgets].sort((left, right) => right.pctUsed - left.pctUsed);
  return pool.slice(0, BUDGET_BLOCK_LIMIT);
}

function budgetBlocks(payload: unknown, userText: string): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const budgets = asArray(payload.items)
    .map(toBudgetCandidate)
    .filter(isPresent);
  return entityListBlock(
    selectBudgets(budgets, userText).map((budget) => budget.ref),
    BUDGETS_HREF,
  );
}

function loanBlocks(payload: unknown): ChatBlock[] {
  if (!isRecord(payload)) {
    return [];
  }
  const refs = asArray(payload.items)
    .map((item) => toRef('loan', item))
    .filter(isPresent);
  return entityListBlock(refs, LOANS_HREF);
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
      return entityCardBlocks('transaction', payload);
    case 'list_transactions':
      return transactionListBlocks(payload);
    case 'get_budget_status':
      return budgetBlocks(payload, userText);
    case 'list_loans':
      return loanBlocks(payload);
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
