const ANGLE_EMAIL = /<([^>]+)>/;

export function extractEmailAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const angled = trimmed.match(ANGLE_EMAIL)?.[1]?.trim();
  const candidate = (angled ?? trimmed).toLowerCase();
  const at = candidate.lastIndexOf('@');
  if (at <= 0 || at === candidate.length - 1) {
    return null;
  }
  if (candidate.includes(' ')) {
    return null;
  }
  return candidate;
}

export function extractEmailDomain(email: string): string {
  const address = extractEmailAddress(email);
  if (!address) {
    throw new Error('Invalid email address');
  }
  return address.slice(address.lastIndexOf('@') + 1);
}

export function normalizeBankSenderEmails(input: {
  bankSenderEmail?: string | null;
  bankSenderEmails?: string[] | null;
}): string[] {
  const fromList = (input.bankSenderEmails ?? [])
    .map((value) => extractEmailAddress(value))
    .filter((value): value is string => Boolean(value));
  const single = input.bankSenderEmail
    ? extractEmailAddress(input.bankSenderEmail)
    : null;
  return [...new Set([...(single ? [single] : []), ...fromList])];
}

export function buildGmailFromQuery(source: {
  bankSenderEmail?: string | null;
  bankSenderEmails?: string[] | null;
  bankDomain: string;
}): string {
  const senders = normalizeBankSenderEmails(source);
  if (senders.length === 0) {
    return `from:${source.bankDomain}`;
  }
  if (senders.length === 1) {
    return `from:${senders[0]}`;
  }
  return `from:(${senders.join(' OR ')})`;
}
