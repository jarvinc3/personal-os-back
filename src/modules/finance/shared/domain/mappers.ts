import { AppEvents } from '../../../../core/events/event.constants';

export function transactionCreatedEventName(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return AppEvents.FINANCE_TRANSACTION_CONFIRMED;
    case 'DECLINED':
      return AppEvents.FINANCE_TRANSACTION_DECLINED;
    case 'CANCELLED':
      return AppEvents.FINANCE_TRANSACTION_CANCELLED;
    case 'REVERSED':
      return AppEvents.FINANCE_TRANSACTION_REVERSED;
    default:
      return AppEvents.FINANCE_TRANSACTION_IMPORTED;
  }
}

export function decimalToString(
  value: { toString(): string } | number | null | undefined,
): string {
  if (value === null || value === undefined) return '0';
  return value.toString();
}

export function decimalToNullableString(
  value: { toString(): string } | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}
