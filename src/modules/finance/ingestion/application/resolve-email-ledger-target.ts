import { digitsOnly } from '../../shared/domain/account-number';

export type LedgerInstrumentHint = 'ACCOUNT' | 'CARD';

export type EmailLedgerTargetMatch =
  | { kind: 'unique'; accountId?: string; cardId?: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidateCount: number };

export type EmailLedgerAccount = {
  id: string;
  accountNumber: string | null;
};

export type EmailLedgerCard = {
  id: string;
  lastFour: string | null;
};

export function accountMatchesHint(
  accountNumber: string | null,
  hint: string | null,
): boolean {
  const account = digitsOnly(accountNumber);
  const needle = digitsOnly(hint);
  if (!needle) return true;
  if (!account) return false;
  if (account === needle) return true;
  if (needle.length >= 4 && account.endsWith(needle)) return true;
  if (account.length >= 4 && needle.endsWith(account)) return true;
  return false;
}

export function resolveEmailLedgerTarget(params: {
  instrumentHint: LedgerInstrumentHint | null;
  lastFourHint: string | null;
  accountNumberHint: string | null;
  accounts: EmailLedgerAccount[];
  cards: EmailLedgerCard[];
}): EmailLedgerTargetMatch {
  const lastFour = digitsOnly(params.lastFourHint) || null;
  const accountHint = digitsOnly(params.accountNumberHint) || null;
  const cardsByFour = lastFour
    ? params.cards.filter((row) => row.lastFour === lastFour)
    : params.cards;

  if (params.instrumentHint === 'CARD') {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }

  if (params.instrumentHint === 'ACCOUNT') {
    return toMatch(matchAccounts(params.accounts, accountHint, lastFour));
  }

  if (accountHint) {
    return toMatch(matchAccounts(params.accounts, accountHint, null));
  }

  if (lastFour) {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }

  return toMatch([
    ...params.cards.map((row) => ({ cardId: row.id })),
    ...params.accounts.map((row) => ({ accountId: row.id })),
  ]);
}

function matchAccounts(
  accounts: EmailLedgerAccount[],
  accountHint: string | null,
  lastFourFallback: string | null,
): Array<{ accountId: string }> {
  const hint = accountHint ?? lastFourFallback;
  return accounts
    .filter((row) => accountMatchesHint(row.accountNumber, hint))
    .map((row) => ({ accountId: row.id }));
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
