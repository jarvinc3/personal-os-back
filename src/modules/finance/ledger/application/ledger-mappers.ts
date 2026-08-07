import { decimalToString } from '../../shared/domain/mappers';
import type { LedgerTransactionRow } from './ports/ledger.repository.port';

export type MappedTransaction = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  cardId: string | null;
  cardName: string | null;
  type: string;
  amount: string;
  ledgerAmount: string;
  amountBaseCurrency: string;
  currency: string;
  ledgerCurrency: string | null | undefined;
  exchangeRate: string;
  merchant: string | null;
  description: string | null;
  transactionDate: string;
  status: string;
  source: string;
  categoryId: string | null;
  notes: string | null;
  transferGroupId: string | null;
  linkedTransactionId: string | null;
  aiMetadata: unknown;
  createdAt: string;
};

export function mapLedgerTransaction(tx: LedgerTransactionRow): MappedTransaction {
  return {
    id: tx.id,
    accountId: tx.accountId,
    accountName: tx.account?.name ?? null,
    cardId: tx.cardId,
    cardName: tx.card?.name ?? null,
    type: tx.type,
    amount: decimalToString(tx.amount),
    ledgerAmount: decimalToString(tx.ledgerAmount),
    amountBaseCurrency: decimalToString(tx.amountBaseCurrency),
    currency: tx.currency,
    ledgerCurrency: tx.ledgerCurrency,
    exchangeRate: decimalToString(tx.exchangeRate),
    merchant: tx.merchant,
    description: tx.description,
    transactionDate: tx.transactionDate.toISOString(),
    status: tx.status,
    source: tx.source,
    categoryId: tx.categoryId,
    notes: tx.notes,
    transferGroupId: tx.transferGroupId,
    linkedTransactionId: tx.linkedTransactionId,
    aiMetadata: tx.aiMetadata,
    createdAt: tx.createdAt.toISOString(),
  };
}
