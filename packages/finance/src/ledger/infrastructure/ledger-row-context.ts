type LedgerAmountRow = {
  amount: { toString(): string } | number;
  currency: string;
  ledgerAmount?: { toString(): string } | number | null;
  ledgerCurrency?: string | null;
};

/** Amount and currency a row moves in the ledger, already normalised. */
export function ledgerFields(row: LedgerAmountRow) {
  return {
    amount: Number(row.ledgerAmount ?? row.amount),
    currency: row.ledgerCurrency ?? row.currency,
  };
}

type CardContextClient = {
  finCard: {
    findFirst: (args: { where: { id: string; userId: string } }) => Promise<{
      type: 'CREDIT' | 'DEBIT';
      accountId: string | null;
    } | null>;
  };
};

type LoadCardContextInput = {
  tx: CardContextClient;
  userId: string;
  cardId: string | null | undefined;
};

/** Card type and the account a debit card charges, for balance movements. */
export async function loadCardContext({
  tx,
  userId,
  cardId,
}: LoadCardContextInput) {
  if (!cardId) {
    return {
      cardType: null as 'CREDIT' | 'DEBIT' | null,
      derivedAccountId: null as string | null,
    };
  }
  const card = await tx.finCard.findFirst({ where: { id: cardId, userId } });
  if (!card) {
    return { cardType: null, derivedAccountId: null };
  }
  return {
    cardType: card.type,
    derivedAccountId: card.type === 'DEBIT' ? card.accountId : null,
  };
}
