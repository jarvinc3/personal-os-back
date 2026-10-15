export type StatementLineType = 'DEBIT' | 'CREDIT';

export type StatementLineInput = {
  id: string;
  date: Date;
  description: string;
  amount: number;
  currency: string;
  type: StatementLineType;
  reference: string | null;
};

export type LedgerMovementType =
  'DEBIT' | 'CREDIT' | 'TRANSFER' | 'ADJUSTMENT' | 'CARD_PAYMENT';

export type LedgerLegRole = 'SOURCE' | 'DESTINATION' | 'FEE' | null;

export type LedgerMovementInput = {
  id: string;
  transactionDate: Date;
  description: string | null;
  merchant: string | null;
  amount: number;
  currency: string;
  type: LedgerMovementType;
  legRole: LedgerLegRole;
  externalReference: string | null;
};

export const STATEMENT_MATCH_LIMITS = {
  MAX_DAY_GAP: 3,
  MIN_DESCRIPTION_SIMILARITY: 0.8,
  AMOUNT_TOLERANCE: 0.005,
} as const;

export type StatementLineMatch = {
  lineId: string;
  transactionId: string;
  similarity: number;
};

export type StatementMatchResult = {
  matches: StatementLineMatch[];
  missingLineIds: string[];
  extraTransactionIds: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Token Dice coefficient; 1 means the same tokens, 0 means no overlap. */
export function descriptionSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const remaining = new Map<string, number>();
  for (const token of leftTokens) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }
  let shared = 0;
  for (const token of rightTokens) {
    const count = remaining.get(token) ?? 0;
    if (count > 0) {
      shared += 1;
      remaining.set(token, count - 1);
    }
  }
  return (2 * shared) / (leftTokens.length + rightTokens.length);
}

function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

function sameAmount(left: number, right: number): boolean {
  return Math.abs(left - right) < STATEMENT_MATCH_LIMITS.AMOUNT_TOLERANCE;
}

function movementDirection(
  movement: LedgerMovementInput,
): StatementLineType | null {
  if (movement.type === 'DEBIT') {
    return 'DEBIT';
  }
  if (movement.type === 'CREDIT' || movement.type === 'CARD_PAYMENT') {
    return 'CREDIT';
  }
  if (movement.type === 'TRANSFER') {
    if (movement.legRole === 'SOURCE') {
      return 'DEBIT';
    }
    if (movement.legRole === 'DESTINATION') {
      return 'CREDIT';
    }
    return null;
  }
  // An adjustment has no inherent direction; let amount, date and text decide.
  return null;
}

function movementTypesMatch(
  line: StatementLineInput,
  movement: LedgerMovementInput,
): boolean {
  const direction = movementDirection(movement);
  return direction === null || direction === line.type;
}

function movementText(movement: LedgerMovementInput): string {
  return [movement.description, movement.merchant]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function dayGap(line: StatementLineInput, movement: LedgerMovementInput) {
  return (
    Math.abs(line.date.getTime() - movement.transactionDate.getTime()) / DAY_MS
  );
}

function referenceCandidate(
  line: StatementLineInput,
  movements: readonly LedgerMovementInput[],
): LedgerMovementInput | null {
  if (!line.reference) {
    return null;
  }
  const reference = normalizeReference(line.reference);
  return (
    movements.find(
      (movement) =>
        movement.externalReference !== null &&
        normalizeReference(movement.externalReference) === reference &&
        movement.currency === line.currency,
    ) ?? null
  );
}

function fuzzyCandidate(
  line: StatementLineInput,
  movements: readonly LedgerMovementInput[],
): { movement: LedgerMovementInput; similarity: number } | null {
  let best: { movement: LedgerMovementInput; similarity: number } | null = null;
  let bestDayGap = Number.POSITIVE_INFINITY;
  for (const movement of movements) {
    if (
      movement.currency !== line.currency ||
      !sameAmount(movement.amount, line.amount) ||
      !movementTypesMatch(line, movement)
    ) {
      continue;
    }
    const gap = dayGap(line, movement);
    if (gap > STATEMENT_MATCH_LIMITS.MAX_DAY_GAP) {
      continue;
    }
    const similarity = descriptionSimilarity(
      line.description,
      movementText(movement),
    );
    if (similarity < STATEMENT_MATCH_LIMITS.MIN_DESCRIPTION_SIMILARITY) {
      continue;
    }
    if (
      best === null ||
      similarity > best.similarity ||
      (similarity === best.similarity && gap < bestDayGap)
    ) {
      best = { movement, similarity };
      bestDayGap = gap;
    }
  }
  return best;
}

/**
 * Pairs each statement line with at most one ledger movement. A bank reference
 * wins over amount+date+text so re-sent notices still land on the same row.
 */
export function matchStatementLines({
  lines,
  movements,
}: {
  lines: readonly StatementLineInput[];
  movements: readonly LedgerMovementInput[];
}): StatementMatchResult {
  const used = new Set<string>();
  const matches: StatementLineMatch[] = [];
  const missingLineIds: string[] = [];

  for (const line of lines) {
    const available = movements.filter((movement) => !used.has(movement.id));
    const byReference = referenceCandidate(line, available);
    if (byReference) {
      used.add(byReference.id);
      matches.push({
        lineId: line.id,
        transactionId: byReference.id,
        similarity: 1,
      });
      continue;
    }
    const fuzzy = fuzzyCandidate(line, available);
    if (!fuzzy) {
      missingLineIds.push(line.id);
      continue;
    }
    used.add(fuzzy.movement.id);
    matches.push({
      lineId: line.id,
      transactionId: fuzzy.movement.id,
      similarity: fuzzy.similarity,
    });
  }

  return {
    matches,
    missingLineIds,
    extraTransactionIds: movements
      .filter((movement) => !used.has(movement.id))
      .map((movement) => movement.id),
  };
}
