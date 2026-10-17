import type { ReceivableStatus } from '../../planning/application/resolve-receivable-payment';
import { localDateIso } from '../../shared/domain/local-day';
import { decimalToString } from '../../shared/domain/mappers';
import { sumMoney, toMoney, type MoneyLike } from '../../shared/domain/money';
import { receivableShareItemRef } from './receivable-share-token';

/** Spanish month abbreviations for the concept fallback. */
const MONTH_ABBREVIATIONS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** Closed receivables no longer represent debt, so the public page hides them. */
const HIDDEN_RECEIVABLE_STATUSES: readonly ReceivableStatus[] = [
  'CANCELLED',
  'WRITTEN_OFF',
];

type PublicSharePaymentRow = {
  paidAt: Date;
  amount: MoneyLike;
};

type PublicShareReceivableRow = {
  id: string;
  description: string | null;
  notes: string | null;
  amount: MoneyLike;
  paidAmount: MoneyLike;
  currency: string;
  status: ReceivableStatus;
  dueDate: Date | null;
  createdAt: Date;
  payments: readonly PublicSharePaymentRow[];
};

export type PublicReceivableShareRow = {
  id: string;
  debtorName: string;
  updatedAt: Date;
  user: { fullName: string; timezone: string | null };
  items: readonly { receivable: PublicShareReceivableRow }[];
};

export type PublicReceivableShareCurrencyTotal = {
  currency: string;
  amount: string;
  paid: string;
  pending: string;
};

export type PublicReceivableShare = {
  ownerFirstName: string;
  debtorName: string;
  updatedAt: Date;
  totalsByCurrency: PublicReceivableShareCurrencyTotal[];
  items: {
    ref: string;
    concept: string;
    createdAt: Date;
    dueDate: Date | null;
    amount: string;
    paid: string;
    pending: string;
    currency: string;
    status: ReceivableStatus;
    note: string | null;
    payments: { paidAt: Date; amount: string }[];
  }[];
};

/** Drops deleted (gone by cascade) and closed receivables, then maps the rest. */
export function mapPublicReceivableShare(
  share: PublicReceivableShareRow,
): PublicReceivableShare {
  const receivables = share.items
    .map((item) => item.receivable)
    .filter(
      (receivable) => !HIDDEN_RECEIVABLE_STATUSES.includes(receivable.status),
    )
    .sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );

  return {
    ownerFirstName: firstName(share.user.fullName),
    debtorName: share.debtorName,
    updatedAt: share.updatedAt,
    totalsByCurrency: totalsByCurrency(receivables),
    items: receivables.map((receivable) =>
      publicItem({
        shareId: share.id,
        receivable,
        timezone: share.user.timezone,
      }),
    ),
  };
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? '';
}

/** One line per currency: amounts are never converted across currencies. */
function totalsByCurrency(
  receivables: readonly PublicShareReceivableRow[],
): PublicReceivableShareCurrencyTotal[] {
  const currencies = [
    ...new Set(receivables.map((receivable) => receivable.currency)),
  ].sort();
  return currencies.map((currency) => {
    const rows = receivables.filter(
      (receivable) => receivable.currency === currency,
    );
    const amount = sumMoney(rows.map((receivable) => receivable.amount));
    const paid = sumMoney(rows.map((receivable) => receivable.paidAmount));
    return {
      currency,
      amount: decimalToString(amount),
      paid: decimalToString(paid),
      pending: decimalToString(amount.minus(paid)),
    };
  });
}

function publicItem(input: {
  shareId: string;
  receivable: PublicShareReceivableRow;
  timezone: string | null;
}) {
  const { shareId, receivable, timezone } = input;
  const amount = toMoney(receivable.amount);
  const paid = toMoney(receivable.paidAmount);
  return {
    ref: receivableShareItemRef(shareId, receivable.id),
    concept: conceptFor(receivable, timezone),
    createdAt: receivable.createdAt,
    dueDate: receivable.dueDate,
    amount: decimalToString(amount),
    paid: decimalToString(paid),
    pending: decimalToString(amount.minus(paid)),
    currency: receivable.currency,
    status: receivable.status,
    note: receivable.notes,
    payments: receivable.payments.map((payment) => ({
      paidAt: payment.paidAt,
      amount: decimalToString(payment.amount),
    })),
  };
}

/** The stored description, or `Cobro del <d MMM>` built from the creation day. */
function conceptFor(
  receivable: PublicShareReceivableRow,
  timezone: string | null,
): string {
  if (receivable.description) {
    return receivable.description;
  }
  const [, month, day] = localDateIso(timezone, receivable.createdAt).split(
    '-',
  );
  return `Cobro del ${Number(day)} ${MONTH_ABBREVIATIONS[Number(month) - 1]}`;
}
