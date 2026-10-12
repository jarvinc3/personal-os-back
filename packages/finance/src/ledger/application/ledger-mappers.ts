import type { LogoRow } from '@personal-os/logos';
import { decimalToString } from '../../shared/domain/mappers';
import {
  OPERATION_LEG_ROLE,
  OPERATION_TYPE,
  type OperationType,
} from '../../shared/domain/transfer';
import {
  transactionEditPolicy,
  type TransactionEditability,
} from '../../shared/domain/transaction-edit-policy';
import type { FinTransactionStatusValue } from '../../shared/domain/transaction-status';
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
  editable: TransactionEditability;
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
    editable: transactionEditPolicy(tx.status as FinTransactionStatusValue)
      .editable,
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

export type MappedOperationLeg = MappedTransaction & {
  legRole: string | null;
};

export type MappedOperation = MappedTransaction & {
  kind: 'OPERATION';
  operationType: OperationType;
  legs: MappedOperationLeg[];
};

function mapOperationLeg(
  leg: LedgerTransactionRow,
  logos?: PartyLogoResolver,
): MappedOperationLeg {
  return {
    ...mapLedgerTransaction(leg, logos),
    legRole: leg.legRole ?? null,
  };
}

/** One row per transfer operation, with every leg inside. */
export function mapOperation(
  legs: LedgerTransactionRow[],
  logos?: PartyLogoResolver,
): MappedOperation {
  const source =
    legs.find((leg) => leg.legRole === OPERATION_LEG_ROLE.SOURCE) ??
    legs.find((leg) => leg.type === 'DEBIT') ??
    legs[0];
  const destination =
    legs.find((leg) => leg.legRole === OPERATION_LEG_ROLE.DESTINATION) ??
    legs.find((leg) => leg.type === 'CREDIT') ??
    null;
  return {
    ...mapLogicalTransaction(source, destination, logos),
    kind: 'OPERATION',
    operationType: OPERATION_TYPE.TRANSFER,
    legs: legs.map((leg) => mapOperationLeg(leg, logos)),
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
    editable: transactionEditPolicy(from.status as FinTransactionStatusValue)
      .editable,
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
