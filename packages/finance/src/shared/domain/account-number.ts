export const ACCOUNT_NUMBER_MIN_DIGITS = 4;
export const ACCOUNT_NUMBER_MAX_DIGITS = 34;

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function normalizeAccountNumber(
  value: string | null | undefined,
): string | null {
  const digits = digitsOnly(value);
  return digits.length ? digits : null;
}

export function isBankAccountType(type: string): boolean {
  return type !== 'CASH';
}
