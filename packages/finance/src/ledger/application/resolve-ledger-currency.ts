import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CARD_CURRENCY_UNDECLARED,
  CARD_CURRENCY_UNDECLARED_MESSAGE,
} from '../../shared/domain/ledger-rules';
import {
  ACCOUNT_NOT_FOUND,
  ACCOUNT_NOT_FOUND_MESSAGE,
  SAME_ACCOUNT,
  SAME_ACCOUNT_MESSAGE,
} from '../../shared/domain/transfer';
import type { LedgerRepositoryPort } from './ports/ledger.repository.port';

/**
 * Currency the movement hits in the ledger. An account keeps its own currency;
 * a card keeps the movement currency only when the card declares it, and
 * otherwise converts to the single currency the card already has.
 */
export async function resolveLedgerCurrencyForTarget(
  repo: LedgerRepositoryPort,
  userId: string,
  accountId: string | undefined,
  cardId: string | undefined,
  fallbackCurrency: string,
): Promise<string> {
  if (accountId) {
    const account = await requireOwnedAccount(repo, userId, accountId);
    return account.currency;
  }
  if (!cardId) {
    return fallbackCurrency;
  }
  const card = await repo.findCardLedgerContext(cardId, userId);
  if (!card) {
    return fallbackCurrency;
  }
  // A debit card spends from its account, so the account owns the ledger.
  if (card.cardType === 'DEBIT') {
    if (!card.accountId) {
      return fallbackCurrency;
    }
    const account = await requireOwnedAccount(repo, userId, card.accountId);
    return account.currency;
  }
  return cardLedgerCurrency(card.currencies, fallbackCurrency);
}

function cardLedgerCurrency(
  declaredCurrencies: readonly string[],
  movementCurrency: string,
): string {
  if (declaredCurrencies.includes(movementCurrency)) {
    return movementCurrency;
  }
  const onlyCurrency =
    declaredCurrencies.length === 1 ? declaredCurrencies[0] : undefined;
  if (onlyCurrency) {
    return onlyCurrency;
  }
  if (declaredCurrencies.length === 0) {
    return movementCurrency;
  }
  throw new BadRequestException({
    code: CARD_CURRENCY_UNDECLARED,
    message: CARD_CURRENCY_UNDECLARED_MESSAGE,
  });
}

export async function requireOwnedAccount(
  repo: LedgerRepositoryPort,
  userId: string,
  accountId: string,
): Promise<{ id: string; currency: string }> {
  const account = await repo.findAccountById(accountId, userId);
  if (!account) {
    throw new NotFoundException({
      code: ACCOUNT_NOT_FOUND,
      message: ACCOUNT_NOT_FOUND_MESSAGE,
    });
  }
  return account;
}

export function assertDifferentAccounts(
  fromAccountId: string,
  toAccountId: string,
): void {
  if (fromAccountId === toAccountId) {
    throw new BadRequestException({
      code: SAME_ACCOUNT,
      message: SAME_ACCOUNT_MESSAGE,
    });
  }
}
