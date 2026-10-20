import { digitsOnly } from '../../shared/domain/account-number';

export type LedgerInstrumentHint = 'ACCOUNT' | 'CARD';

export type EmailLedgerTargetMatch =
  | { kind: 'unique'; accountId?: string; cardId?: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidateCount: number };

export type EmailLedgerAccount = {
  id: string;
  accountNumberLast4: string | null;
  isDefaultForInstitution?: boolean;
};

export type EmailLedgerCard = {
  id: string;
  lastFour: string | null;
};

export function accountMatchesHint(
  accountNumberLast4: string | null,
  hint: string | null,
): boolean {
  const account = digitsOnly(accountNumberLast4);
  const needle = digitsOnly(hint);
  if (!needle) {
    return true;
  }
  if (!account) {
    return false;
  }
  if (account === needle) {
    return true;
  }
  if (account.endsWith(needle)) {
    return true;
  }
  return needle.endsWith(account);
}

export function resolveEmailLedgerTarget(params: {
  instrumentHint: LedgerInstrumentHint | null;
  lastFourHint: string | null;
  accountNumberHint: string | null;
  accounts: EmailLedgerAccount[];
  cards: EmailLedgerCard[];
  /** Only when the email has no account/card digits and the movement is not a transfer. */
  allowDefaultAccount?: boolean;
}): EmailLedgerTargetMatch {
  const lastFour = digitsOnly(params.lastFourHint) || null;
  const accountHint = digitsOnly(params.accountNumberHint) || null;
  const hasDigits = Boolean(accountHint || lastFour);
  const cardsByFour = lastFour
    ? params.cards.filter((row) => row.lastFour === lastFour)
    : params.cards;

  if (params.instrumentHint === 'CARD') {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }

  if (params.instrumentHint === 'ACCOUNT') {
    const matched = toMatch(
      matchAccounts(params.accounts, accountHint, lastFour),
    );
    return maybeDefaultAccount(matched, params, hasDigits);
  }

  if (accountHint) {
    return toMatch(matchAccounts(params.accounts, accountHint, null));
  }

  if (lastFour) {
    return toMatch(cardsByFour.map((row) => ({ cardId: row.id })));
  }

  const all = toMatch([
    ...params.cards.map((row) => ({ cardId: row.id })),
    ...params.accounts.map((row) => ({ accountId: row.id })),
  ]);
  return maybeDefaultAccount(all, params, hasDigits);
}

function maybeDefaultAccount(
  match: EmailLedgerTargetMatch,
  params: {
    accounts: EmailLedgerAccount[];
    allowDefaultAccount?: boolean;
  },
  hasDigits: boolean,
): EmailLedgerTargetMatch {
  if (match.kind === 'unique') {
    return match;
  }
  if (hasDigits) {
    return match;
  }
  if (!params.allowDefaultAccount) {
    return match;
  }
  const defaults = params.accounts.filter((row) => row.isDefaultForInstitution);
  if (defaults.length === 1) {
    return { kind: 'unique', accountId: defaults[0].id };
  }
  return match;
}

function matchAccounts(
  accounts: EmailLedgerAccount[],
  accountHint: string | null,
  lastFourFallback: string | null,
): Array<{ accountId: string }> {
  const hint = accountHint ?? lastFourFallback;
  return accounts
    .filter((row) => accountMatchesHint(row.accountNumberLast4, hint))
    .map((row) => ({ accountId: row.id }));
}

function toMatch(
  hits: Array<{ accountId?: string; cardId?: string }>,
): EmailLedgerTargetMatch {
  if (hits.length === 0) {
    return { kind: 'none' };
  }
  if (hits.length === 1) {
    return { kind: 'unique', ...hits[0] };
  }
  return { kind: 'ambiguous', candidateCount: hits.length };
}
