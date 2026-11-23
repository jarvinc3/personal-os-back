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

/** How far a due date is from today, in the copy's words. */
function dueInLabel(daysUntil: number): string {
  if (daysUntil <= 0) {
    return 'hoy';
  }
  if (daysUntil === 1) {
    return 'mañana';
  }
  return `en ${daysUntil} días`;
}

export function cardStatementReminderCopy(): NotificationCopy {
  return {
    title: 'Carga el corte de tu tarjeta',
    body: 'El banco te recuerda pagar tu tarjeta. Sube el corte a mano para programar el pago.',
  };
}

export function cardPaymentDueCopy(fields: {
  cardName: string;
  remainingLabel: string;
  daysUntil: number;
}): NotificationCopy {
  const when = dueInLabel(fields.daysUntil);
  return {
    title: 'Pago de tarjeta próximo',
    body: `El corte de ${fields.cardName} vence ${when}. Falta por pagar ${fields.remainingLabel}.`,
  };
}

export type WeeklySummaryNotificationFields = {
  amountLabel: string;
  averageLabel: string;
  topCategories: string[];
  budgetsAtRisk: number;
  upcoming: number;
  pendingEmails: number;
};

export function weeklySummaryCopy(
  fields: WeeklySummaryNotificationFields,
): NotificationCopy {
  const details = joinDetails([
    fields.averageLabel ? `promedio ${fields.averageLabel}` : null,
    fields.topCategories.length > 0
      ? `Top: ${fields.topCategories.join(', ')}`
      : null,
    fields.budgetsAtRisk > 0
      ? `${fields.budgetsAtRisk} presupuestos en riesgo`
      : null,
    fields.upcoming > 0 ? `${fields.upcoming} cuotas próximas` : null,
    fields.pendingEmails > 0
      ? `${fields.pendingEmails} correos por revisar`
      : null,
  ]);
  return {
    title: 'Resumen semanal',
    body: details
      ? `Gastaste ${fields.amountLabel} · ${details}`
      : `Gastaste ${fields.amountLabel}`,
  };
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

/** A transfer has two legs, so it notifies once instead of once per leg. */
export function transferRecordedCopy(
  fields: TransactionNotificationFields,
): NotificationCopy {
  const details = joinDetails([fields.accountName]);
  return {
    title: 'Transferencia registrada',
    body: details ? `${fields.amountLabel} · ${details}` : fields.amountLabel,
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

export type RecurringNotificationFields = {
  merchant: string;
  amountLabel: string;
};

export function recurringPriceChangedCopy(input: {
  merchant: string;
  previousLabel: string;
  newLabel: string;
}): NotificationCopy {
  return {
    title: 'Subió el precio',
    body: `${input.merchant} pasó de ${input.previousLabel} a ${input.newLabel}.`,
  };
}

export function recurringMissedCopy(
  fields: RecurringNotificationFields,
): NotificationCopy {
  return {
    title: 'No llegó el cobro',
    body: `El cobro de ${fields.merchant} (${fields.amountLabel}) no llegó en la fecha esperada.`,
  };
}

export function recurringUpcomingCopy(
  fields: RecurringNotificationFields & { daysUntil: number },
): NotificationCopy {
  const when = dueInLabel(fields.daysUntil);
  return {
    title: 'Próximo cobro',
    body: `${fields.merchant} cobra ${fields.amountLabel} ${when}.`,
  };
}

export function subscriptionRenewalDueCopy(
  fields: RecurringNotificationFields & { daysUntil: number },
): NotificationCopy {
  const when = dueInLabel(fields.daysUntil);
  return {
    title: 'Renovación próxima',
    body: `Tu suscripción ${fields.merchant} se renueva ${when} por ${fields.amountLabel}.`,
  };
}

export function balanceDriftCopy(fields: {
  name: string;
  differenceLabel: string;
}): NotificationCopy {
  return {
    title: 'Saldo descuadrado',
    body: `El saldo de ${fields.name} no coincide con sus movimientos (${fields.differenceLabel}).`,
  };
}
