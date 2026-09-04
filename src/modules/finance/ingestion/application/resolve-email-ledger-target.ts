export type LedgerInstrumentHint = 'ACCOUNT' | 'CARD';

export type EmailLedgerTargetMatch =
  | { kind: 'unique'; accountId?: string; cardId?: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidateCount: number };

export type EmailLedgerAccount = {
  id: string;
};

export type EmailLedgerCard = {
  id: string;
  lastFour: string | null;
};

export function resolveEmailLedgerTarget(params: {
  instrumentHint: LedgerInstrumentHint | null;
  lastFourHint: string | null;
  accounts: EmailLedgerAccount[];
  cards: EmailLedgerCard[];
}): EmailLedgerTargetMatch {
  const lastFour = params.lastFourHint?.trim() || null;
  const cardsByFour = lastFour
    ? params.cards.filter((row) => row.lastFour === lastFour)
    : params.cards;

  if (params.instrumentHint === 'CARD') {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }
  if (params.instrumentHint === 'ACCOUNT') {
    return toMatch(params.accounts.map((row) => ({ accountId: row.id })));
  }
  if (lastFour) {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }
  return toMatch([
    ...params.cards.map((row) => ({ cardId: row.id })),
    ...params.accounts.map((row) => ({ accountId: row.id })),
  ]);
}

function toMatch(
  hits: Array<{ accountId?: string; cardId?: string }>,
): EmailLedgerTargetMatch {
  if (hits.length === 0) return { kind: 'none' };
  if (hits.length === 1) {
    return { kind: 'unique', ...hits[0] };
  }
  return { kind: 'ambiguous', candidateCount: hits.length };
}
