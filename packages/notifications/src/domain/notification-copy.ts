const AMOUNT_LOCALE = 'en-US';

const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  DEBIT: 'Gasto',
  CREDIT: 'Ingreso',
  TRANSFER: 'Transferencia',
};

export type TransactionNotificationFields = {
  type: string;
  amountLabel: string;
  merchant: string | null;
  categoryName: string | null;
  accountName: string | null;
  cardName: string | null;
};

export type NotificationCopy = {
  title: string;
  body: string;
};

function narrowCurrencySymbol(currency: string): string | null {
  const parts = new Intl.NumberFormat(AMOUNT_LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? null;
}

export function formatNotificationAmount(
  amount: number,
  currency: string,
): string {
  const code = currency.trim().toUpperCase();
  const formatted = new Intl.NumberFormat(AMOUNT_LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  if (!code) {
    return formatted;
  }

  const symbol = narrowCurrencySymbol(code);
  const sign = amount < 0 ? '-' : '';
  if (!symbol) {
    return `${code} ${sign}${formatted}`;
  }
  return `${code} ${sign}${symbol}${formatted}`;
}

function joinDetails(parts: Array<string | null>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

export function transactionRecordedCopy(
  fields: TransactionNotificationFields,
): NotificationCopy {
  const kind = TRANSACTION_TYPE_LABEL[fields.type] ?? 'Movimiento';
  const details = joinDetails([
    fields.merchant,
    fields.categoryName,
    fields.cardName ?? fields.accountName,
  ]);
  return {
    title: `${kind} registrado`,
    body: details ? `${fields.amountLabel} · ${details}` : fields.amountLabel,
  };
}

export function transactionPendingCopy(
  fields: TransactionNotificationFields,
): NotificationCopy {
  const details = joinDetails([fields.merchant, fields.categoryName]);
  const suffix = details ? ` · ${details}` : '';
  return {
    title: 'Movimiento por confirmar',
    body: `Detectamos ${fields.amountLabel}${suffix} en un correo. Revísalo para confirmarlo.`,
  };
}

export function transactionUpdatedCopy(
  fields: TransactionNotificationFields,
): NotificationCopy {
  const details = joinDetails([fields.merchant, fields.categoryName]);
  const suffix = details ? ` · ${details}` : '';
  return {
    title: 'Movimiento actualizado',
    body: `Se actualizó ${fields.amountLabel}${suffix}.`,
  };
}

export function budgetThresholdCopy(percentageUsed: number): NotificationCopy {
  const rounded = Math.round(percentageUsed);
  return {
    title: `Presupuesto al ${rounded}%`,
    body: `Un presupuesto alcanzó el ${rounded}% de su límite.`,
  };
}
