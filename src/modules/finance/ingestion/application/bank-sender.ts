const ANGLE_EMAIL = /<([^>]+)>/;

export function extractEmailAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const angled = trimmed.match(ANGLE_EMAIL)?.[1]?.trim();
  const candidate = (angled ?? trimmed).toLowerCase();
  const at = candidate.lastIndexOf('@');
  if (at <= 0 || at === candidate.length - 1) return null;
  if (candidate.includes(' ')) return null;
  return candidate;
}

export function extractEmailDomain(email: string): string {
  const address = extractEmailAddress(email);
  if (!address) {
    throw new Error('Invalid email address');
  }
  return address.slice(address.lastIndexOf('@') + 1);
}

export function buildGmailFromQuery(source: {
  bankSenderEmail?: string | null;
  bankDomain: string;
}): string {
  const sender = source.bankSenderEmail
    ? extractEmailAddress(source.bankSenderEmail)
    : null;
  return `from:${sender ?? source.bankDomain}`;
}
