import type { LogoRow } from '../../../logos/domain/logo-row';
import { decimalToString } from '../../shared/domain/mappers';
import type { LedgerTransactionRow } from './ports/ledger.repository.port';

export type PartyLogoResolver = {
  resolveUrl(row?: LogoRow | null): string | null;
  networkLogoUrl(network: string | null | undefined): string | null;
};

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
  transferToAccountId: string | null;
  transferToAccountName: string | null;
  transferToCardId: string | null;
  transferToCardName: string | null;
  institutionLogoUrl: string | null;
  network: string | null;
  networkLogoUrl: string | null;
  transferToInstitutionLogoUrl: string | null;
  transferToNetwork: string | null;
  transferToNetworkLogoUrl: string | null;
  linkedTransactionId: string | null;
  aiMetadata: unknown;
  createdAt: string;
};

function party(
  row: LedgerTransactionRow | null | undefined,
  logos?: PartyLogoResolver,
): {
  accountId: string | null;
  accountName: string | null;
  cardId: string | null;
  cardName: string | null;
  institutionLogoUrl: string | null;
  network: string | null;
  networkLogoUrl: string | null;
} {
  const institution = row?.account?.institutionRef ?? row?.card?.institution;
  return {
    accountId: row?.accountId ?? null,
    accountName: row?.account?.name ?? null,
    cardId: row?.cardId ?? null,
    cardName: row?.card?.name ?? null,
    institutionLogoUrl: logos?.resolveUrl(institution) ?? null,
    network: row?.cardId ? (row.card?.network ?? null) : null,
    networkLogoUrl: row?.cardId
      ? (logos?.networkLogoUrl(row.card?.network) ?? null)
      : null,
  };
}

function mapPhysicalTransaction(
  tx: LedgerTransactionRow,
  logos?: PartyLogoResolver,
): MappedTransaction {
  const origin = party(tx, logos);
  return {
    id: tx.id,
    accountId: origin.accountId,
    accountName: origin.accountName,
    cardId: origin.cardId,
    cardName: origin.cardName,
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
    transferToAccountId: null,
    transferToAccountName: null,
    transferToCardId: null,
    transferToCardName: null,
    institutionLogoUrl: origin.institutionLogoUrl,
    network: origin.network,
    networkLogoUrl: origin.networkLogoUrl,
    transferToInstitutionLogoUrl: null,
    transferToNetwork: null,
    transferToNetworkLogoUrl: null,
    linkedTransactionId: tx.linkedTransactionId,
    aiMetadata: tx.aiMetadata,
    createdAt: tx.createdAt.toISOString(),
  };
}

export function mapLedgerTransaction(
  tx: LedgerTransactionRow,
  logos?: PartyLogoResolver,
): MappedTransaction {
  return mapPhysicalTransaction(tx, logos);
}

export function mapLogicalTransaction(
  tx: LedgerTransactionRow,
  counterpart: LedgerTransactionRow | null = tx.transferCounterpart ?? null,
  logos?: PartyLogoResolver,
): MappedTransaction {
  if (!tx.transferGroupId) {
    return mapPhysicalTransaction(tx, logos);
  }

  const from = tx.type === 'CREDIT' && counterpart ? counterpart : tx;
  const to = tx.type === 'DEBIT' ? counterpart : tx;
  const origin = party(from, logos);
  const destination = party(to, logos);

  return {
    id: tx.id,
    accountId: origin.accountId,
    accountName: origin.accountName,
    cardId: origin.cardId,
    cardName: origin.cardName,
    type: 'TRANSFER',
    amount: decimalToString(from.amount),
    ledgerAmount: decimalToString(from.ledgerAmount),
    amountBaseCurrency: decimalToString(from.amountBaseCurrency),
    currency: from.currency,
    ledgerCurrency: from.ledgerCurrency,
    exchangeRate: decimalToString(from.exchangeRate),
    merchant: from.merchant,
    description: from.description,
    transactionDate: from.transactionDate.toISOString(),
    status: from.status,
    source: from.source,
    categoryId: from.categoryId,
    notes: from.notes,
    transferGroupId: tx.transferGroupId,
    transferToAccountId: destination.accountId,
    transferToAccountName: destination.accountName,
    transferToCardId: destination.cardId,
    transferToCardName: destination.cardName,
    institutionLogoUrl: origin.institutionLogoUrl,
    network: origin.network,
    networkLogoUrl: origin.networkLogoUrl,
    transferToInstitutionLogoUrl: destination.institutionLogoUrl,
    transferToNetwork: destination.network,
    transferToNetworkLogoUrl: destination.networkLogoUrl,
    linkedTransactionId: tx.linkedTransactionId,
    aiMetadata: tx.aiMetadata,
    createdAt: from.createdAt.toISOString(),
  };
}
