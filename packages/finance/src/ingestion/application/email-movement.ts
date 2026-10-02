import { EMAIL_MESSAGE_OUTCOME } from './email-message-outcome';

export const EMAIL_MOVEMENT_CLASSES = [
  'PURCHASE',
  'INCOME',
  'PAYROLL',
  'ATM_WITHDRAWAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'FEE',
  'REFUND',
  'OTHER',
] as const;

export type EmailMovementClass = (typeof EMAIL_MOVEMENT_CLASSES)[number];

const PAYROLL_RE =
  /n[oó]mina|payroll|salario|dep[oó]sito de n[oó]mina|pago de (?:su |tu )?n[oó]mina/i;
const ATM_RE =
  /cajero|atm\b|retiro en cajero|retiro de efectivo|cash withdrawal/i;
const TRANSFER_OUT_RE =
  /transferencia (?:enviada|saliente|realizada)|enviaste|transferiste|enviaste\b|se debit[oó].{0,40}transfer|outgoing transfer|enviaste dinero|transferencia a/i;
const TRANSFER_IN_RE =
  /transferencia (?:recibida|entrante|acreditada)|recibiste|te enviaron|incoming transfer|recibiste dinero|se acredit[oó].{0,40}transfer/i;
const TRANSFER_GENERIC_RE =
  /transferencia|transferiste|ach\b|p2p|entre (?:tus )?cuentas|a tu cuenta|desde tu cuenta/i;
const AMOUNT_RE =
  /(?:rd\$|dop|usd|€|us\$)\s*[\d.,]+|\$\s*[\d.,]{1,}|[\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/;
const ACCOUNT_HINT_RE =
  /(?:cuenta(?:\s+\w+){0,4}|terminad[ao]s?)\s+(?:en\s+)?[*x]{0,8}\s*(\d{4,})/i;
const CEDULA_CONTEXT_RE =
  /c[eé]dula|identificaci[oó]n|no\.\s*de identificaci[oó]n/i;

export function combinedEmailText(
  parts: Array<string | null | undefined>,
): string {
  return parts.filter(Boolean).join('\n');
}

export function looksLikePayrollWithoutAmount(
  subject: string,
  body: string,
): boolean {
  const text = combinedEmailText([subject, body]);
  if (!PAYROLL_RE.test(text)) {
    return false;
  }
  return !AMOUNT_RE.test(text);
}

export function accountHintFromTerminatedIn(text: string): string | null {
  const match = text.match(ACCOUNT_HINT_RE);
  const digits = match?.[1]?.replace(/\D/g, '') ?? '';
  if (digits.length < 4) {
    return null;
  }
  return digits;
}

export function sanitizeAccountNumberHint(
  text: string,
  hint: string | null | undefined,
): string | null {
  if (!hint) {
    return null;
  }
  const digits = hint.replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 34) {
    return null;
  }

  const escaped = digits.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nearId = new RegExp(
    `(?:c[eé]dula|identificaci[oó]n|no\\.\\s*de identificaci[oó]n)[^\\d]{0,48}${escaped}`,
    'i',
  );
  const nearAccount = new RegExp(
    `(?:cuenta|terminad[ao]s?\\s+en)[^\\d*]{0,24}[*x]{0,8}\\s*${escaped}`,
    'i',
  );
  if (nearId.test(text) && !nearAccount.test(text)) {
    return null;
  }
  if (
    CEDULA_CONTEXT_RE.test(text) &&
    !nearAccount.test(text) &&
    !ACCOUNT_HINT_RE.test(text)
  ) {
    return null;
  }
  return digits;
}

export function isTransferMovementClass(
  movementClass: EmailMovementClass | null | undefined,
): boolean {
  return movementClass === 'TRANSFER_OUT' || movementClass === 'TRANSFER_IN';
}

export function isAtmMovementClass(
  movementClass: EmailMovementClass | null | undefined,
): boolean {
  return movementClass === 'ATM_WITHDRAWAL';
}

export function classifyMovementFromText(params: {
  subject?: string | null;
  description?: string | null;
  merchant?: string | null;
  notes?: string | null;
  type?: 'DEBIT' | 'CREDIT' | null;
  movementClass?: EmailMovementClass | null;
}): EmailMovementClass {
  if (
    params.movementClass &&
    (EMAIL_MOVEMENT_CLASSES as readonly string[]).includes(params.movementClass)
  ) {
    return params.movementClass;
  }

  const text = combinedEmailText([
    params.subject,
    params.description,
    params.merchant,
    params.notes,
  ]);

  if (ATM_RE.test(text) && params.type !== 'CREDIT') {
    return 'ATM_WITHDRAWAL';
  }
  if (PAYROLL_RE.test(text)) {
    return 'PAYROLL';
  }
  if (
    TRANSFER_OUT_RE.test(text) ||
    (TRANSFER_GENERIC_RE.test(text) && params.type === 'DEBIT')
  ) {
    return 'TRANSFER_OUT';
  }
  if (
    TRANSFER_IN_RE.test(text) ||
    (TRANSFER_GENERIC_RE.test(text) && params.type === 'CREDIT')
  ) {
    return 'TRANSFER_IN';
  }
  if (params.type === 'CREDIT') {
    return 'INCOME';
  }
  if (params.type === 'DEBIT') {
    return 'PURCHASE';
  }
  return 'OTHER';
}

export function shouldReopenSkippedPayroll(params: {
  outcome: string;
  reason?: string | null;
}): boolean {
  if (params.outcome !== EMAIL_MESSAGE_OUTCOME.SKIPPED_NOT_TX) {
    return false;
  }
  return /n[oó]mina|payroll|dep[oó]sito|amount|monto|salario/i.test(
    params.reason ?? '',
  );
}
